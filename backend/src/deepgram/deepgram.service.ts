import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, DeepgramClient, PrerecordedSchema } from '@deepgram/sdk';
import {
  DeepgramConfigurationException,
  DeepgramTimeoutException,
} from './deepgram.exceptions.js';

export type DeepgramSupportedLanguage = 'hi' | 'en-IN';
export type DeepgramDetectedLanguage = 'Hindi' | 'English' | 'Hinglish';

@Injectable()
export class DeepgramService {
  private readonly logger = new Logger(DeepgramService.name);
  private readonly client: DeepgramClient;
  private readonly defaultTimeoutMs = 8000; // 8 seconds hard timeout
  private readonly minAudioByteLength = 1600; // ~100ms of 8kHz 16-bit mono PCM

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new DeepgramConfigurationException(
        'Deepgram API key is not configured. Set DEEPGRAM_API_KEY in backend environment.',
      );
    }
    this.client = createClient(apiKey);
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
   * Validates if a buffer is a valid RIFF/WAVE container.
   */
  private isValidWavBuffer(buffer: Buffer): boolean {
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 44) {
      return false;
    }
    // Check RIFF header at offset 0 and WAVE identifier at offset 8
    const riff = buffer.subarray(0, 4).toString('ascii');
    const wave = buffer.subarray(8, 12).toString('ascii');
    return riff === 'RIFF' && wave === 'WAVE';
  }

  /**
   * METHOD 1: Transcribes WAV audio using Deepgram Nova-3 model.
   *
   * @param audioBuffer - WAV audio buffer to transcribe
   * @param language - Optional language hint ('Hindi' | 'English' | 'Hinglish')
   * @returns Clean, trimmed transcript string or '' on failure/silence
   */
  async transcribeAudio(audioBuffer: Buffer, language?: string): Promise<string> {
    // 1. Minimum-audio and null checks:
    // Less than 1600 bytes is < 100ms of 8kHz 16-bit PCM audio; return '' immediately
    if (
      !audioBuffer ||
      !Buffer.isBuffer(audioBuffer) ||
      audioBuffer.length < this.minAudioByteLength
    ) {
      return '';
    }

    // 2. Audio format validation:
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
      // 3. Enforce 8-second request timeout via Promise.race
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

  /**
   * METHOD 2: Transcribes accumulated audio chunks.
   * Concatenates the chunks and delegates to transcribeAudio.
   *
   * @param audioChunks - Array of audio buffers
   * @param language - Optional language hint
   * @returns Clean, trimmed transcript string
   */
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

  /**
   * METHOD 3: Language Detection based on Hindi Unicode character ratio.
   *
   * Phase 4.5 Language Detection Rule:
   * 1. Count Hindi Unicode characters in \u0900-\u097F.
   * 2. Calculate: Hindi ratio = Hindi characters / total characters.
   * 3. ratio > 0.25 -> 'Hindi'
   * 4. ratio > 0.05 -> 'Hinglish'
   * 5. Otherwise -> 'English'
   *
   * @param transcript - Input transcript string
   * @returns 'Hindi' | 'English' | 'Hinglish'
   */
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

  /**
   * Redacts any credential or authorization header leakage from error messages.
   */
  private sanitizeMessage(msg: string): string {
    if (!msg) return 'STT error occurred.';
    return msg
      .replace(/bearer\s+[a-zA-Z0-9_.-]+/gi, 'Bearer [REDACTED]')
      .replace(/token\s*[:=]\s*[a-zA-Z0-9_.-]+/gi, 'token: [REDACTED]')
      .replace(/key\s*[:=]\s*[a-zA-Z0-9_.-]+/gi, 'key: [REDACTED]')
      .replace(/api[-_]?key\s*[:=]\s*[a-zA-Z0-9_.-]+/gi, 'apiKey: [REDACTED]');
  }
}
