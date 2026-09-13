import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import type { WebSocket } from 'ws';
import { CallsService } from './calls.service.js';
import { VoiceSessionService } from './voice-session.service.js';
import {
  decodeMuLawToPcm16,
  wrapPcmInWav,
  calculateRmsEnergy,
} from './audio-codec.util.js';

export interface MediaStreamSession {
  streamId: string;
  callControlId: string;
  clientId: string;
  ws?: WebSocket;
  pcmChunks: Buffer[];
  isSpeaking: boolean;
  speechFrames: number;
  silenceFrames: number;
  lastActiveAt: number;
}

export interface TelnyxMediaStreamMessage {
  event: 'start' | 'media' | 'stop' | 'connected';
  sequence_number?: string | number;
  stream_id?: string;
  call_control_id?: string;
  start?: {
    stream_id?: string;
    call_control_id?: string;
    call_leg_id?: string;
    tracks?: string[];
    media_format?: {
      encoding?: string;
      sample_rate?: number;
      channels?: number;
    };
    custom_headers?: Record<string, string>;
  };
  media?: {
    track?: string;
    chunk?: string | number;
    timestamp?: string | number;
    payload?: string; // base64 encoded audio
  };
  stop?: {
    call_control_id?: string;
  };
}

@Injectable()
export class MediaStreamService {
  private readonly logger = new Logger(MediaStreamService.name);

  // Active stream sessions keyed by streamId or callControlId
  private readonly streamSessions = new Map<string, MediaStreamSession>();
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
   * Handles incoming WebSocket raw message from Telnyx Media Streaming.
   */
  public async handleWebSocketMessage(
    ws: WebSocket,
    rawMessage: string | Buffer,
    urlCallControlId?: string,
  ): Promise<void> {
    try {
      const msgStr = typeof rawMessage === 'string' ? rawMessage : rawMessage.toString('utf-8');
      const payload: TelnyxMediaStreamMessage = JSON.parse(msgStr);

      switch (payload.event) {
        case 'start':
        case 'connected':
          await this.handleStartEvent(ws, payload, urlCallControlId);
          break;

        case 'media':
          await this.handleMediaEvent(ws, payload, urlCallControlId);
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
   * Initializes a media stream session when Telnyx sends 'start' or 'connected'.
   */
  public async handleStartEvent(
    ws: WebSocket,
    payload: TelnyxMediaStreamMessage,
    urlCallControlId?: string,
  ): Promise<boolean> {
    const streamId = payload.stream_id ?? payload.start?.stream_id ?? `stream-${Date.now()}`;
    const callControlId =
      payload.call_control_id ??
      payload.start?.call_control_id ??
      urlCallControlId;

    if (!callControlId) {
      this.logger.warn(`Media stream start rejected: Missing call_control_id (stream: ${streamId})`);
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
      `Media stream session started for call ${callControlId} (client: ${activeCall.clientId}, stream: ${streamId})`,
    );

    return true;
  }

  /**
   * Processes incoming audio chunks ('media' event).
   * Performs VAD, utterance buffering, and dispatches complete caller speech to processCallerUtterance.
   */
  public async handleMediaEvent(
    _ws: WebSocket,
    payload: TelnyxMediaStreamMessage,
    urlCallControlId?: string,
  ): Promise<void> {
    const streamId =
      payload.stream_id ??
      (urlCallControlId ? this.callToStreamMap.get(urlCallControlId) : undefined);

    let session = streamId ? this.streamSessions.get(streamId) : undefined;

    // Fallback: If start event was skipped or delayed, create session on first media event
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
    payload: TelnyxMediaStreamMessage,
    urlCallControlId?: string,
  ): Promise<void> {
    const streamId =
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
