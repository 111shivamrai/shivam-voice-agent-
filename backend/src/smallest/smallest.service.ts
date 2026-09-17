import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SmallestConfigurationException,
  SmallestInvalidInputException,
  SmallestAuthenticationException,
  SmallestUnavailableException,
  SmallestTimeoutException,
  SmallestMalformedResponseException,
} from './smallest.exceptions.js';

export interface SmallestTtsResult {
  audioBuffer: Buffer;
  audioBase64: string;
  sampleRate: number;
  languageCode: string;
  voiceId: string;
}

export type SmallestSupportedVoice =
  | 'anika'
  | 'radhika'
  | 'arjun'
  | 'vikram'
  | 'dhruv'
  | 'kartik'
  | 'naina'
  | 'sakshi'
  | 'alice';

@Injectable()
export class SmallestService {
  private readonly logger = new Logger(SmallestService.name);

  // Smallest.ai Lightning V3.1 configuration
  private readonly baseUrl = 'https://waves-api.smallest.ai/api/v1/lightning-v3.1/get_speech';
  private readonly defaultTimeoutMs = 5000; // 5 seconds bounded timeout for fast voice responses
  private readonly maxTextLength = 500; // 500 characters max input length

  constructor(private readonly configService: ConfigService) {}

  /**
   * Safely retrieves Smallest.ai API key from configuration.
   */
  private getApiKey(): string {
    const key =
      this.configService.get<string>('SMALLEST_API_KEY') ??
      this.configService.get<string>('smallest.apiKey') ??
      this.configService.get<string>('smallestApiKey');

    if (!key || typeof key !== 'string' || key.trim() === '') {
      throw new SmallestConfigurationException(
        'Smallest.ai API key is not configured. Set SMALLEST_API_KEY in backend environment.',
      );
    }
    return key.trim();
  }

  /**
   * Text Preprocessing for Speech Synthesis:
   * 1. Remove Markdown syntax (headers, code blocks, bold, italics, bullets, links)
   * 2. Remove emojis (Unicode extended pictographs)
   * 3. Remove URLs
   * 4. Normalize phone numbers and number formatting for natural speech
   * 5. Enforce maximum input length of 500 characters
   */
  public preprocessText(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    let cleaned = text.trim();

    // 1. Remove markdown links: [text](url) -> text
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // 2. Remove URLs (http, https, www)
    cleaned = cleaned.replace(/https?:\/\/\S+/gi, '');
    cleaned = cleaned.replace(/www\.\S+/gi, '');

    // 3. Remove markdown headers, code blocks, formatting (*, _, ~, #, `)
    cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
    cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
    cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');
    cleaned = cleaned.replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1');
    cleaned = cleaned.replace(/^\s*[-*+]\s+/gm, '');
    cleaned = cleaned.replace(/^\s*\d+\.\s+/gm, '');
    cleaned = cleaned.replace(/^>\s+/gm, '');

    // 4. Remove emojis using Unicode property escapes
    cleaned = cleaned.replace(/\p{Extended_Pictographic}/gu, '');

    // 5. Clean up multiple spaces and empty lines
    cleaned = cleaned.replace(/[ \t]+/g, ' ');
    cleaned = cleaned.replace(/\n\s*\n/g, '. ');
    cleaned = cleaned.replace(/\n/g, ' ');
    cleaned = cleaned.trim();

    // 6. Enforce 500 characters maximum length
    if (cleaned.length > this.maxTextLength) {
      // Truncate at sentence boundary or last word boundary within 500 chars
      const truncated = cleaned.slice(0, this.maxTextLength);
      const lastPunct = Math.max(
        truncated.lastIndexOf('.'),
        truncated.lastIndexOf('!'),
        truncated.lastIndexOf('?'),
        truncated.lastIndexOf('।'),
      );
      if (lastPunct > 200) {
        cleaned = truncated.slice(0, lastPunct + 1).trim();
      } else {
        const lastSpace = truncated.lastIndexOf(' ');
        cleaned = (lastSpace > 200 ? truncated.slice(0, lastSpace) : truncated).trim();
      }
    }

    return cleaned;
  }

  /**
   * Deterministically selects voice ID based on language and optional voice parameter.
   * Includes graceful aliasing for legacy voice names.
   */
  public selectVoice(language?: string, voice?: string): SmallestSupportedVoice {
    if (voice) {
      const v = voice.toLowerCase().trim();
      // Direct supported catalog match
      if (['anika', 'radhika', 'arjun', 'vikram', 'dhruv', 'kartik', 'naina', 'sakshi', 'alice'].includes(v)) {
        return v as SmallestSupportedVoice;
      }
      // Graceful legacy/alias mappings
      if (v === 'raj' || v === 'raman') return 'vikram';
      if (v === 'pooja') return 'sakshi';
      if (v === 'emily') return 'anika';
    }

    const lang = (language ?? '').toLowerCase().trim();
    if (lang.includes('hindi') || lang.includes('hi') || lang.includes('hinglish')) {
      return 'radhika'; // Verified Lightning V3.1 Hindi/Hinglish voice
    }

    return 'anika'; // Verified Lightning V3.1 English voice
  }

  /**
   * Maps language to ISO code ('hi' or 'en').
   */
  public mapLanguage(language?: string): 'hi' | 'en' {
    const clean = (language ?? '').toLowerCase().trim();
    if (clean.includes('hindi') || clean.includes('hi') || clean.includes('hinglish')) {
      return 'hi';
    }
    return 'en';
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
   * Synthesizes text to speech using Smallest.ai Lightning V3.
   *
   * @param text - Text string to synthesize
   * @param language - Optional language hint ('Hindi' | 'English' | 'hi' | 'en')
   * @param voice - Optional voice ID ('anika' | 'raj' | 'pooja' | 'arjun' | 'emily')
   * @returns SmallestTtsResult with WAV Buffer (mono, 8kHz)
   */
  public async textToSpeech(
    text: string,
    language?: string,
    voice?: string,
  ): Promise<SmallestTtsResult> {
    const cleanedText = this.preprocessText(text);
    if (!cleanedText) {
      throw new SmallestInvalidInputException('Text input cannot be empty after preprocessing.');
    }

    const apiKey = this.getApiKey();
    const voiceId = this.selectVoice(language, voice);
    const languageCode = this.mapLanguage(language);

    this.logger.log(
      `Sending TTS request to Smallest.ai Lightning V3.1 (${cleanedText.length} chars, voice: ${voiceId}, lang: ${languageCode}, sampleRate: 8000Hz)`,
    );

    const payload = {
      text: cleanedText,
      voice_id: voiceId,
      sample_rate: 8000,
      speed: 1.0,
      output_format: 'wav',
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.defaultTimeoutMs);

    let response: Response;
    try {
      response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'audio/wav, audio/*, application/octet-stream',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new SmallestTimeoutException(this.defaultTimeoutMs);
      }
      const rawMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Smallest.ai TTS network failure: ${this.sanitizeMessage(rawMsg)}`);
      throw new SmallestUnavailableException(
        `Failed to reach Smallest.ai TTS service: ${this.sanitizeMessage(rawMsg)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const status = response.status;
      const errorText = await response.text().catch(() => '');
      const safeDetail = this.sanitizeMessage(errorText);

      this.logger.warn(`Smallest.ai TTS request returned HTTP ${status}: ${safeDetail}`);

      if (status === 401 || status === 403) {
        throw new SmallestAuthenticationException(`Smallest.ai auth failure (HTTP ${status})`);
      }
      if (status === 400 || status === 422) {
        throw new SmallestInvalidInputException(
          `Smallest.ai rejected payload (HTTP ${status}): ${safeDetail}`,
        );
      }
      if (status === 429) {
        throw new SmallestUnavailableException('Smallest.ai rate limit exceeded (HTTP 429)', 429);
      }
      throw new SmallestUnavailableException(`Smallest.ai returned status ${status}`, status);
    }

    let audioBuffer: Buffer;
    try {
      const arrayBuf = await response.arrayBuffer();
      audioBuffer = Buffer.from(arrayBuf);
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      throw new SmallestMalformedResponseException(
        `Failed to read audio response body: ${this.sanitizeMessage(rawMsg)}`,
      );
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new SmallestMalformedResponseException('Smallest.ai returned empty audio body.');
    }

    if (!this.isValidWavBuffer(audioBuffer)) {
      this.logger.warn(
        `Smallest.ai audio buffer (${audioBuffer.length} bytes) missing standard WAV header.`,
      );
    }

    return {
      audioBuffer,
      audioBase64: audioBuffer.toString('base64'),
      sampleRate: 8000,
      languageCode,
      voiceId,
    };
  }

  /**
   * Redacts sensitive authorization tokens and keys from error messages.
   */
  public sanitizeMessage(msg: string): string {
    if (!msg) return 'Smallest.ai error occurred.';
    return msg
      .replace(/bearer\s+[a-zA-Z0-9_.-]+/gi, 'Bearer [REDACTED]')
      .replace(/token\s*[:=]\s*[a-zA-Z0-9_.-]+/gi, 'token: [REDACTED]')
      .replace(/key\s*[:=]\s*[a-zA-Z0-9_.-]+/gi, 'key: [REDACTED]')
      .replace(/api[-_]?key\s*[:=]\s*[a-zA-Z0-9_.-]+/gi, 'apiKey: [REDACTED]')
      .replace(/sk_[a-zA-Z0-9_.-]+/gi, 'sk_[REDACTED]');
  }
}
