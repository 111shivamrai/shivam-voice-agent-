import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, DeepgramClient, PrerecordedSchema, LiveTranscriptionEvents } from '@deepgram/sdk';
import {
  DeepgramConfigurationException,
  DeepgramTimeoutException,
} from './deepgram.exceptions.js';

export type DeepgramSupportedLanguage = 'hi' | 'en-IN';
export type DeepgramDetectedLanguage = 'Hindi' | 'English' | 'Hinglish';

export interface DeepgramLiveStreamOptions {
  language?: string;
  onTranscript: (transcript: string, isFinal: boolean, speechFinal: boolean) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
}

export interface DeepgramLiveStreamHandle {
  sendAudio: (chunk: Buffer) => void;
  finish: () => void;
  close: () => void;
  isActive: () => boolean;
}

interface ActiveLiveSession {
  connection: any;
  finalizedSegments: string[];
  isActive: boolean;
}

@Injectable()
export class DeepgramService implements OnModuleDestroy {
  private readonly logger = new Logger(DeepgramService.name);
  private readonly client: DeepgramClient;
  private readonly defaultTimeoutMs = 8000; // 8 seconds hard timeout
  private readonly minAudioByteLength = 1600; // ~100ms of 8kHz 16-bit mono PCM
  private readonly activeStreams = new Map<string, ActiveLiveSession>();

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new DeepgramConfigurationException(
        'Deepgram API key is not configured. Set DEEPGRAM_API_KEY in backend environment.',
      );
    }
    this.client = createClient(apiKey);
  }

  onModuleDestroy(): void {
    this.closeAllLiveStreams();
  }

  /**
   * Safely retrieves Deepgram API key from configuration.
   */
  private getApiKey(): string {
    const key =
      this.configService.get<string>('DEEPGRAM_API_KEY') ??
      this.configService.get<string>('deepgram.apiKey') ??
      this.configService.get<string>('deepgramApiKey');

    if (!key || typeof key !== 'string' || key.trim() === '') {
      return '';
    }
    return key.trim();
  }

  /**
   * Helper to map language string to Deepgram language code.
   * Hindi -> 'hi'
   * English -> 'en-IN'
   * Hinglish -> 'hi'
   * Default -> 'hi'
   */
  public mapLanguage(language?: string): DeepgramSupportedLanguage {
    if (!language || typeof language !== 'string') {
      return 'hi';
    }
    const clean = language.toLowerCase().trim();
    if (clean === 'english' || clean === 'en' || clean === 'en-in' || clean === 'en-us') {
      return 'en-IN';
    }
    if (clean === 'hindi' || clean === 'hi' || clean === 'hi-in') {
      return 'hi';
    }
    if (clean === 'hinglish') {
      return 'hi';
    }
    return 'hi';
  }

  /**
   * Creates a dedicated Deepgram Nova-3 live streaming session for an active call.
   */
  public createLiveStream(
    sessionId: string,
    options: DeepgramLiveStreamOptions,
  ): DeepgramLiveStreamHandle {
    // Close existing session if any
    this.closeLiveStream(sessionId);

    const targetLang = this.mapLanguage(options.language);

    this.logger.log(
      `Creating Deepgram Nova-3 live WebSocket stream for session ${sessionId} (language: ${targetLang}, 8kHz Linear16)`,
    );

    const connection = this.client.listen.live({
      model: 'nova-3',
      language: targetLang,
      encoding: 'linear16',
      sample_rate: 8000,
      channels: 1,
      interim_results: true,
      smart_format: true,
      punctuate: true,
      endpointing: 350,
      vad_events: true,
    });

    const sessionState: ActiveLiveSession = {
      connection,
      finalizedSegments: [],
      isActive: false,
    };

    this.activeStreams.set(sessionId, sessionState);

    connection.on(LiveTranscriptionEvents.Open, () => {
      sessionState.isActive = true;
      this.logger.debug?.(`Deepgram live WebSocket connected for session ${sessionId}`);
    });

    connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
      const alt = data.channel?.alternatives?.[0];
      const text = alt?.transcript?.trim();
      const isFinal = Boolean(data.is_final);
      const speechFinal = Boolean(data.speech_final);

      if (isFinal && text) {
        sessionState.finalizedSegments.push(text);
      }

      if (speechFinal) {
        const fullUtterance = sessionState.finalizedSegments.join(' ').replace(/\s+/g, ' ').trim();
        sessionState.finalizedSegments = [];
        if (fullUtterance) {
          options.onTranscript(fullUtterance, true, true);
        }
      } else if (!isFinal && text) {
        options.onTranscript(text, false, false);
      }
    });

    connection.on(LiveTranscriptionEvents.Error, (err: any) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Deepgram live error on session ${sessionId}: ${this.sanitizeMessage(msg)}`);
      options.onError?.(err instanceof Error ? err : new Error(msg));
    });

    connection.on(LiveTranscriptionEvents.Close, () => {
      sessionState.isActive = false;
      this.activeStreams.delete(sessionId);
      this.logger.debug?.(`Deepgram live WebSocket closed for session ${sessionId}`);
      options.onClose?.();
    });

    return {
      sendAudio: (chunk: Buffer) => {
        try {
          if (sessionState.isActive && chunk && chunk.length > 0) {
            connection.send(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer);
          }
        } catch (err: unknown) {
          this.logger.debug?.(`Failed to send audio chunk to Deepgram: ${err}`);
        }
      },
      finish: () => {
        try {
          if (sessionState.isActive) {
            connection.finish();
          }
        } catch (err: unknown) {
          this.logger.debug?.(`Error finishing Deepgram live stream: ${err}`);
        }
      },
      close: () => {
        this.closeLiveStream(sessionId);
      },
      isActive: () => sessionState.isActive,
    };
  }

  /**
   * Closes and cleans up a specific live streaming session.
   */
  public closeLiveStream(sessionId: string): void {
    const session = this.activeStreams.get(sessionId);
    if (session) {
      session.isActive = false;
      try {
        if (typeof session.connection?.finish === 'function') {
          session.connection.finish();
        }
      } catch {}
      this.activeStreams.delete(sessionId);
    }
  }

  /**
   * Closes all active live streaming sessions (on shutdown).
   */
  public closeAllLiveStreams(): void {
    for (const id of Array.from(this.activeStreams.keys())) {
      this.closeLiveStream(id);
    }
  }

  /**
   * Validates if a buffer is a valid RIFF/WAVE container.
   */
  private isValidWavBuffer(buffer: Buffer): boolean {
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 44) {
      return false;
    }
    const riff = buffer.subarray(0, 4).toString('ascii');
    const wave = buffer.subarray(8, 12).toString('ascii');
    return riff === 'RIFF' && wave === 'WAVE';
  }

  /**
   * Transcribes WAV audio using Deepgram Nova-3 model (prerecorded batch method).
   */
  async transcribeAudio(audioBuffer: Buffer, language?: string): Promise<string> {
    if (
      !audioBuffer ||
      !Buffer.isBuffer(audioBuffer) ||
      audioBuffer.length < this.minAudioByteLength
    ) {
      return '';
    }

    if (!this.isValidWavBuffer(audioBuffer)) {
      this.logger.warn(
        `Invalid audio format: Buffer (${audioBuffer.length} bytes) is not a valid RIFF/WAVE container.`,
      );
      return '';
    }

    const targetLang = this.mapLanguage(language);

    this.logger.log(
      `Sending STT request to Deepgram Nova-3 (${audioBuffer.length} bytes WAV, language: ${targetLang})`,
    );

    const options: PrerecordedSchema = {
      model: 'nova-3',
      smart_format: true,
      punctuate: true,
      language: targetLang,
      diarize: false,
      multichannel: false,
    };

    try {
      const transcribePromise = this.client.listen.prerecorded
        .transcribeFile(audioBuffer, options)
        .catch((err: unknown) => {
          return {
            result: null,
            error: err instanceof Error ? err : new Error(String(err)),
          };
        });

      let timeoutTimer: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<{ result: null; error: Error }>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          reject(new DeepgramTimeoutException(this.defaultTimeoutMs));
        }, this.defaultTimeoutMs);
      });

      const response = await Promise.race([transcribePromise, timeoutPromise]).finally(() => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
      });

      if (response.error) {
        const errorMsg = response.error.message || 'Unknown Deepgram API error';
        this.logger.warn(`Deepgram STT provider error: ${this.sanitizeMessage(errorMsg)}`);
        return '';
      }

      const transcript =
        response.result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;

      if (!transcript || typeof transcript !== 'string') {
        return '';
      }

      return transcript.trim();
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const safeMsg = this.sanitizeMessage(rawMsg);
      this.logger.error(`Deepgram STT processing failed: ${safeMsg}`);
      return '';
    }
  }

  async transcribeStream(audioChunks: Buffer[], language?: string): Promise<string> {
    if (!audioChunks || !Array.isArray(audioChunks) || audioChunks.length === 0) {
      return '';
    }

    const validChunks = audioChunks.filter((chunk) => Buffer.isBuffer(chunk) && chunk.length > 0);
    if (validChunks.length === 0) {
      return '';
    }

    const combined = Buffer.concat(validChunks);
    return this.transcribeAudio(combined, language);
  }

  detectLanguage(transcript: string): DeepgramDetectedLanguage {
    if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
      return 'English';
    }

    const clean = transcript.trim();
    const hindiMatches = clean.match(/[\u0900-\u097F]/g);
    const hindiCount = hindiMatches ? hindiMatches.length : 0;
    const ratio = hindiCount / clean.length;

    if (ratio > 0.25) {
      return 'Hindi';
    }
    if (ratio > 0.05) {
      return 'Hinglish';
    }
    return 'English';
  }

  private sanitizeMessage(msg: string): string {
    if (!msg) return 'STT error occurred.';
    return msg
      .replace(/bearer\s+[a-zA-Z0-9_.-]+/gi, 'Bearer [REDACTED]')
      .replace(/token\s*[:=]\s*[a-zA-Z0-9_.-]+/gi, 'token: [REDACTED]')
      .replace(/key\s*[:=]\s*[a-zA-Z0-9_.-]+/gi, 'key: [REDACTED]')
      .replace(/api[-_]?key\s*[:=]\s*[a-zA-Z0-9_.-]+/gi, 'apiKey: [REDACTED]');
  }
}
