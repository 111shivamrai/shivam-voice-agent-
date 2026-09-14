import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import type { WebSocket } from 'ws';
import { CallsService } from './calls.service.js';
import { VoiceSessionService } from './voice-session.service.js';
import {
  decodeMuLawToPcm16,
  encodePcm16ToMuLaw,
  wrapPcmInWav,
  calculateRmsEnergy,
} from './audio-codec.util.js';

export interface MediaStreamSession {
  streamId: string; // Twilio streamSid or Telnyx stream_id
  callControlId: string; // Twilio callSid or Telnyx call_control_id
  clientId: string;
  ws?: WebSocket;
  pcmChunks: Buffer[];
  isSpeaking: boolean;
  speechFrames: number;
  silenceFrames: number;
  lastActiveAt: number;
}

export interface TwilioMediaStreamMessage {
  event: 'connected' | 'start' | 'media' | 'stop' | 'mark';
  sequenceNumber?: string | number;
  sequence_number?: string | number;
  streamSid?: string;
  stream_id?: string;
  callSid?: string;
  call_control_id?: string;
  start?: {
    streamSid?: string;
    stream_id?: string;
    callSid?: string;
    call_control_id?: string;
    accountSid?: string;
    tracks?: string[];
    customParameters?: Record<string, string>;
    mediaFormat?: {
      encoding?: string;
      sampleRate?: number;
      channels?: number;
    };
    media_format?: {
      encoding?: string;
      sample_rate?: number;
      channels?: number;
    };
  };
  media?: {
    track?: string;
    chunk?: string | number;
    timestamp?: string | number;
    payload?: string; // base64 encoded G.711 mu-law audio
  };
  stop?: {
    callSid?: string;
    call_control_id?: string;
  };
  mark?: {
    name?: string;
  };
}

@Injectable()
export class MediaStreamService {
  private readonly logger = new Logger(MediaStreamService.name);

  // Active stream sessions keyed by streamId (streamSid)
  private readonly streamSessions = new Map<string, MediaStreamSession>();
  // Mapping of callControlId (callSid) -> streamId (streamSid)
  private readonly callToStreamMap = new Map<string, string>();

  // VAD and utterance segmentation thresholds
  // 20ms per frame (160 bytes of 8kHz mu-law -> 320 bytes of 8kHz 16-bit PCM)
  private readonly energyThreshold = 350; // RMS energy threshold for speech detection
  private readonly minSpeechFrames = 10; // ~200ms minimum speech to avoid noise triggers
  private readonly silenceFramesThreshold = 30; // ~600ms trailing silence to finalize utterance
  private readonly maxSpeechFrames = 300; // ~6000ms max utterance before auto-flushing

  constructor(
    @Inject(forwardRef(() => CallsService))
    private readonly callsService: CallsService,
    private readonly voiceSessionService: VoiceSessionService,
  ) {}

  /**
   * Handles incoming WebSocket raw messages from Twilio Media Streams.
   */
  public async handleWebSocketMessage(
    ws: WebSocket,
    rawMessage: string | Buffer,
    urlCallControlId?: string,
  ): Promise<void> {
    try {
      const msgStr = typeof rawMessage === 'string' ? rawMessage : rawMessage.toString('utf-8');
      const payload: TwilioMediaStreamMessage = JSON.parse(msgStr);

      switch (payload.event) {
        case 'connected':
          this.logger.log('Twilio Media Stream WebSocket handshake connected');
          break;

        case 'start':
          await this.handleStartEvent(ws, payload, urlCallControlId);
          break;

        case 'media':
          await this.handleMediaEvent(ws, payload, urlCallControlId);
          break;

        case 'mark':
          this.logger.debug?.(`Received Twilio media mark: ${payload.mark?.name ?? 'unknown'}`);
          break;

        case 'stop':
          await this.handleStopEvent(ws, payload, urlCallControlId);
          break;

        default:
          this.logger.debug?.(`Unhandled media stream event: ${(payload as any).event}`);
          break;
      }
    } catch (err: unknown) {
      this.logger.warn(`Failed to process WebSocket media message: ${err}`);
    }
  }

  /**
   * Initializes a media stream session when Twilio sends 'start'.
   */
  public async handleStartEvent(
    ws: WebSocket,
    payload: TwilioMediaStreamMessage,
    urlCallControlId?: string,
  ): Promise<boolean> {
    const streamId =
      payload.streamSid ??
      payload.stream_id ??
      payload.start?.streamSid ??
      payload.start?.stream_id ??
      `stream-${Date.now()}`;

    const callControlId =
      payload.start?.callSid ??
      payload.callSid ??
      payload.start?.customParameters?.call_control_id ??
      payload.call_control_id ??
      payload.start?.call_control_id ??
      urlCallControlId;

    if (!callControlId) {
      this.logger.warn(`Media stream start rejected: Missing callSid / callControlId (stream: ${streamId})`);
      return false;
    }

    // Verify call is active in CallsService
    const activeCall = this.callsService.getActiveCall(callControlId);
    if (!activeCall) {
      this.logger.warn(
        `Media stream start rejected: Call ${callControlId} is not active in CallsService`,
      );
      return false;
    }

    const session: MediaStreamSession = {
      streamId,
      callControlId,
      clientId: activeCall.clientId,
      ws,
      pcmChunks: [],
      isSpeaking: false,
      speechFrames: 0,
      silenceFrames: 0,
      lastActiveAt: Date.now(),
    };

    this.streamSessions.set(streamId, session);
    this.callToStreamMap.set(callControlId, streamId);

    this.voiceSessionService.updateActivity(callControlId);
    this.logger.log(
      `Twilio media stream session established for call ${callControlId} (client: ${activeCall.clientId}, stream: ${streamId})`,
    );

    // Trigger greeting to speak immediately upon stream start
    if (this.callsService && typeof this.callsService.handleCallAnswered === 'function') {
      setTimeout(() => {
        try {
          this.callsService
            .handleCallAnswered({ call_control_id: callControlId, CallSid: callControlId })
            ?.catch?.((err: unknown) => {
              this.logger.error(`Error playing greeting on media stream start: ${err}`);
            });
        } catch (err: unknown) {
          this.logger.error(`Error executing handleCallAnswered on stream start: ${err}`);
        }
      }, 200);
    }

    return true;
  }

  /**
   * Processes incoming audio chunks ('media' event).
   * Performs VAD, utterance buffering, and dispatches complete caller speech to processCallerUtterance.
   */
  public async handleMediaEvent(
    _ws: WebSocket,
    payload: TwilioMediaStreamMessage,
    urlCallControlId?: string,
  ): Promise<void> {
    const streamId =
      payload.streamSid ??
      payload.stream_id ??
      (urlCallControlId ? this.callToStreamMap.get(urlCallControlId) : undefined);

    let session = streamId ? this.streamSessions.get(streamId) : undefined;

    // Fallback: If start event was delayed or URL param was provided
    if (!session && urlCallControlId) {
      const activeCall = this.callsService.getActiveCall(urlCallControlId);
      if (activeCall) {
        const autoStreamId = streamId ?? `stream-auto-${Date.now()}`;
        session = {
          streamId: autoStreamId,
          callControlId: urlCallControlId,
          clientId: activeCall.clientId,
          pcmChunks: [],
          isSpeaking: false,
          speechFrames: 0,
          silenceFrames: 0,
          lastActiveAt: Date.now(),
        };
        this.streamSessions.set(autoStreamId, session);
        this.callToStreamMap.set(urlCallControlId, autoStreamId);
      }
    }

    if (!session) {
      return;
    }

    // Verify call is still active
    const activeCall = this.callsService.getActiveCall(session.callControlId);
    if (!activeCall) {
      // Call ended; clean up and drop frame
      this.cleanupSession(session.streamId);
      return;
    }

    const base64Audio = payload.media?.payload;
    if (!base64Audio || typeof base64Audio !== 'string') {
      return;
    }

    session.lastActiveAt = Date.now();
    this.voiceSessionService.updateActivity(session.callControlId);

    // Decode base64 mu-law audio chunk
    const rawBuffer = Buffer.from(base64Audio, 'base64');
    if (rawBuffer.length === 0) {
      return;
    }

    // Convert 8000Hz G.711 mu-law chunk to 16-bit Linear PCM
    const pcmChunk = decodeMuLawToPcm16(rawBuffer);
    const rms = calculateRmsEnergy(pcmChunk);

    if (rms >= this.energyThreshold) {
      // Caller is speaking
      session.isSpeaking = true;
      session.speechFrames++;
      session.silenceFrames = 0;
      session.pcmChunks.push(pcmChunk);

      // Guard: If utterance exceeds max duration (~6s), flush immediately to avoid latency
      if (session.speechFrames >= this.maxSpeechFrames) {
        await this.flushUtterance(session);
      }
    } else {
      // Silence / background noise
      if (session.isSpeaking) {
        session.silenceFrames++;
        session.pcmChunks.push(pcmChunk); // Capture trailing audio smoothly

        // If caller finished speaking and silence threshold reached
        if (session.silenceFrames >= this.silenceFramesThreshold) {
          if (session.speechFrames >= this.minSpeechFrames) {
            await this.flushUtterance(session);
          } else {
            // Speech was too brief (click / cough), discard
            this.resetUtteranceState(session);
          }
        }
      }
    }
  }

  /**
   * Assembles accumulated PCM speech chunks into a standard 8000Hz WAV buffer
   * and invokes CallsService.processCallerUtterance().
   */
  public async flushUtterance(session: MediaStreamSession): Promise<void> {
    if (session.pcmChunks.length === 0) {
      this.resetUtteranceState(session);
      return;
    }

    const totalPcm = Buffer.concat(session.pcmChunks);
    const wavAudio = wrapPcmInWav(totalPcm, 8000);
    const callControlId = session.callControlId;

    this.resetUtteranceState(session);

    this.logger.log(
      `Flushing caller speech utterance (${wavAudio.length} bytes WAV, ~${(totalPcm.length / 16000).toFixed(2)}s) for call ${callControlId}`,
    );

    try {
      await this.callsService.processCallerUtterance(callControlId, {
        audioBuffer: wavAudio,
      });
    } catch (err: unknown) {
      this.logger.error(`Error processing caller utterance for call ${callControlId}: ${err}`);
    }
  }

  /**
   * Sends synthesized audio (WAV or Linear PCM) back to caller through active Twilio WebSocket media stream.
   * Encodes 16-bit Linear PCM to G.711 mu-law, chunks into 20ms frames, and sends media events.
   */
  public async sendAudioToCaller(callControlId: string, audioBuffer: Buffer): Promise<boolean> {
    if (!audioBuffer || audioBuffer.length === 0) {
      return false;
    }

    const streamId = this.callToStreamMap.get(callControlId);
    if (!streamId) {
      this.logger.debug?.(`No active streamId found for call ${callControlId}`);
      return false;
    }

    const session = this.streamSessions.get(streamId);
    if (!session || !session.ws) {
      this.logger.debug?.(`No active WebSocket session found for stream ${streamId}`);
      return false;
    }

    // Check WebSocket open state
    const ws = session.ws;
    if (ws.readyState !== 1 /* WebSocket.OPEN */) {
      this.logger.warn(`WebSocket for call ${callControlId} is not open (readyState: ${ws.readyState})`);
      return false;
    }

    try {
      // If audio has 44-byte RIFF header, extract the raw Linear PCM data
      let pcmData = audioBuffer;
      if (audioBuffer.length > 44 && audioBuffer.subarray(0, 4).toString('ascii') === 'RIFF') {
        pcmData = audioBuffer.subarray(44);
      }

      // Convert 16-bit Linear PCM to 8-bit G.711 mu-law
      const muLawAudio = encodePcm16ToMuLaw(pcmData);

      // Stream mu-law audio in 20ms frames (160 bytes per frame at 8000Hz)
      const frameSize = 160;
      for (let offset = 0; offset < muLawAudio.length; offset += frameSize) {
        const chunk = muLawAudio.subarray(offset, Math.min(offset + frameSize, muLawAudio.length));
        const mediaMsg = JSON.stringify({
          event: 'media',
          streamSid: streamId,
          media: {
            payload: chunk.toString('base64'),
          },
        });
        ws.send(mediaMsg);
      }

      // Send mark message to indicate completion of audio dispatch
      const markMsg = JSON.stringify({
        event: 'mark',
        streamSid: streamId,
        mark: {
          name: 'agent-response-complete',
        },
      });
      ws.send(markMsg);

      this.logger.log(
        `Dispatched synthesized audio (${muLawAudio.length} bytes mu-law) to caller on stream ${streamId}`,
      );
      return true;
    } catch (err: unknown) {
      this.logger.error(`Failed to send audio over WebSocket for call ${callControlId}: ${err}`);
      return false;
    }
  }

  /**
   * Resets speech buffering counters for a session.
   */
  private resetUtteranceState(session: MediaStreamSession): void {
    session.pcmChunks = [];
    session.isSpeaking = false;
    session.speechFrames = 0;
    session.silenceFrames = 0;
  }

  /**
   * Handles stream termination ('stop' event).
   */
  public async handleStopEvent(
    _ws: WebSocket,
    payload: TwilioMediaStreamMessage,
    urlCallControlId?: string,
  ): Promise<void> {
    const streamId =
      payload.streamSid ??
      payload.stream_id ??
      (urlCallControlId ? this.callToStreamMap.get(urlCallControlId) : undefined);

    if (streamId) {
      const session = this.streamSessions.get(streamId);
      if (session && session.isSpeaking && session.speechFrames >= this.minSpeechFrames) {
        await this.flushUtterance(session);
      }
      this.cleanupSession(streamId);
    }
  }

  /**
   * Handles WebSocket disconnection.
   */
  public handleWebSocketClose(ws: WebSocket): void {
    for (const [streamId, session] of this.streamSessions.entries()) {
      if (session.ws === ws) {
        this.cleanupSession(streamId);
        break;
      }
    }
  }

  /**
   * Cleans up stream session resources.
   */
  public cleanupSession(streamId: string): void {
    const session = this.streamSessions.get(streamId);
    if (session) {
      this.callToStreamMap.delete(session.callControlId);
      this.streamSessions.delete(streamId);
      this.logger.log(`Media stream session cleaned up: ${streamId} (call: ${session.callControlId})`);
    }
  }

  /**
   * Helper for tests to inspect active stream session.
   */
  public getSession(streamId: string): MediaStreamSession | undefined {
    return this.streamSessions.get(streamId);
  }

  /**
   * Helper for tests to clear all stream sessions.
   */
  public clearAllSessions(): void {
    this.streamSessions.clear();
    this.callToStreamMap.clear();
  }
}
