import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SarvamConfigurationException,
  SarvamInvalidInputException,
  SarvamRequestRejectedException,
  SarvamUnavailableException,
  SarvamTimeoutException,
  SarvamMalformedResponseException,
} from './sarvam.exceptions.js';

export type SupportedTtsLanguage = 'hi-IN' | 'en-IN';
export type DetectedLanguage = 'hindi' | 'hinglish' | 'english';

export interface TextToSpeechResult {
  audioBase64: string;
  audioBuffer: Buffer;
  sampleRate: number;
  languageCode: SupportedTtsLanguage;
  speaker: string;
}

export interface SpeechToTextResponse {
  transcript: string;
}

@Injectable()
export class SarvamService {
  private readonly logger = new Logger(SarvamService.name);

  // Configuration constants
  private readonly baseUrl = 'https://api.sarvam.ai';
  private readonly defaultTimeoutMs = 15000;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Safely retrieves the Sarvam API key from configuration.
   * Throws SarvamConfigurationException if missing or blank.
   */
  private getApiKey(): string {
    const key =
      this.configService.get<string>('SARVAM_API_KEY') ??
      this.configService.get<string>('sarvam.apiKey') ??
      this.configService.get<string>('sarvamApiKey');

    if (!key || typeof key !== 'string' || key.trim() === '') {
      throw new SarvamConfigurationException(
        'Sarvam API key is not configured. Set SARVAM_API_KEY in backend environment.',
      );
    }
    return key.trim();
  }

  /**
   * 1. Speech-to-Text (STT) via Sarvam Saaras v3
   *
   * @param audioBuffer - WAV audio buffer to transcribe
   * @returns Clean, trimmed transcript string
   */
  async speechToText(audioBuffer: Buffer): Promise<string> {
    if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
      throw new SarvamInvalidInputException(
        'Audio buffer is empty or missing. Please provide valid WAV audio.',
      );
    }

    const apiKey = this.getApiKey();
    const endpoint = `${this.baseUrl}/speech-to-text`;

    this.logger.log(
      `Sending STT request to Sarvam (${audioBuffer.length} bytes, model: saaras:v3, language: hi-IN)`,
    );

    // Build multipart/form-data payload
    const formData = new FormData();
    const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/wav' });
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model', 'saaras:v3');
    formData.append('language_code', 'hi-IN');
    formData.append('with_timestamps', 'false');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.defaultTimeoutMs);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'api-subscription-key': apiKey,
          Accept: 'application/json',
        },
        body: formData,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new SarvamTimeoutException(this.defaultTimeoutMs);
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`STT network failure: ${msg}`);
      throw new SarvamUnavailableException(
        `Failed to reach Sarvam STT service: ${msg}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    // Handle non-2xx HTTP responses safely without leaking headers/secrets
    if (!response.ok) {
      let errorDetail = response.statusText || 'Unknown error';
      try {
        const errorJson = (await response.json()) as Record<string, unknown>;
        if (typeof errorJson?.message === 'string') {
          errorDetail = errorJson.message;
        } else if (typeof errorJson?.error === 'string') {
          errorDetail = errorJson.error;
        } else if (typeof errorJson?.detail === 'string') {
          errorDetail = errorJson.detail;
        }
      } catch {
        // Fallback to statusText
      }

      this.logger.warn(`Sarvam STT failed with HTTP ${response.status}: ${errorDetail}`);

      if (response.status >= 400 && response.status < 500) {
        throw new SarvamRequestRejectedException(response.status, errorDetail);
      }
      throw new SarvamUnavailableException(errorDetail, response.status);
    }

    // Parse and validate response JSON
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SarvamMalformedResponseException(
        'Sarvam STT returned an invalid JSON response.',
      );
    }

    const payload = body as Record<string, unknown>;
    if (!payload || typeof payload !== 'object' || typeof payload.transcript !== 'string') {
      throw new SarvamMalformedResponseException(
        'Sarvam STT response is missing the required "transcript" field.',
      );
    }

    return payload.transcript.trim();
  }

  /**
   * 2. Text-to-Speech (TTS) via Sarvam Bulbul v3
   *
   * @param text - Text prompt to synthesize
   * @param language - Target language code: 'hi-IN' (meera) or 'en-IN' (pavithra)
   * @returns Synthesized audio in both base64 string and Buffer format
   */
  async textToSpeech(
    text: string,
    language: SupportedTtsLanguage,
  ): Promise<TextToSpeechResult> {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      throw new SarvamInvalidInputException('Text input cannot be empty.');
    }

    if (language !== 'hi-IN' && language !== 'en-IN') {
      throw new SarvamInvalidInputException(
        `Unsupported language code "${language}". Supported languages are "hi-IN" and "en-IN".`,
      );
    }

    const apiKey = this.getApiKey();
    const endpoint = `${this.baseUrl}/text-to-speech`;

    // Speaker selection for bulbul:v3:
    // 'priya' is fully supported for both hi-IN and en-IN
    const speaker = 'priya';
    const trimmedText = text.trim();

    this.logger.log(
      `Sending TTS request to Sarvam (${trimmedText.length} chars, language: ${language}, speaker: ${speaker}, sampleRate: 8000Hz)`,
    );

    const requestPayload = {
      inputs: [trimmedText],
      target_language_code: language,
      speaker,
      pace: 1.0,
      speech_sample_rate: 8000,
      enable_preprocessing: true,
      model: 'bulbul:v3',
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.defaultTimeoutMs);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'api-subscription-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new SarvamTimeoutException(this.defaultTimeoutMs);
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`TTS network failure: ${msg}`);
      throw new SarvamUnavailableException(
        `Failed to reach Sarvam TTS service: ${msg}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      let errorDetail = response.statusText || 'Unknown error';
      try {
        const errorJson = (await response.json()) as Record<string, unknown>;
        if (typeof errorJson?.message === 'string') {
          errorDetail = errorJson.message;
        } else if (typeof errorJson?.error === 'string') {
          errorDetail = errorJson.error;
        } else if (typeof errorJson?.detail === 'string') {
          errorDetail = errorJson.detail;
        }
      } catch {
        // Fallback to statusText
      }

      this.logger.warn(`Sarvam TTS failed with HTTP ${response.status}: ${errorDetail}`);

      if (response.status >= 400 && response.status < 500) {
        throw new SarvamRequestRejectedException(response.status, errorDetail);
      }
      throw new SarvamUnavailableException(errorDetail, response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SarvamMalformedResponseException(
        'Sarvam TTS returned an invalid JSON response.',
      );
    }

    const payload = body as Record<string, unknown>;
    if (
      !payload ||
      typeof payload !== 'object' ||
      !Array.isArray(payload.audios) ||
      payload.audios.length === 0
    ) {
      throw new SarvamMalformedResponseException(
        'Sarvam TTS response is missing the "audios" array or it is empty.',
      );
    }

    const firstAudio = payload.audios[0];
    if (typeof firstAudio !== 'string' || firstAudio.trim().length === 0) {
      throw new SarvamMalformedResponseException(
        'Sarvam TTS returned an empty audio string in the "audios" array.',
      );
    }

    const audioBase64 = firstAudio.trim();
    const audioBuffer = Buffer.from(audioBase64, 'base64');

    return {
      audioBase64,
      audioBuffer,
      sampleRate: 8000,
      languageCode: language,
      speaker,
    };
  }

  /**
   * 3. Language Detection
   *
   * Locked Project Logic:
   * 1. Count Hindi Unicode characters in U+0900–U+097F.
   * 2. Calculate the proportion of Hindi characters in the text (hindiCount / text.length).
   * 3. More than 20% Hindi characters (> 0.20) -> 'hindi'
   * 4. More than 5% Hindi characters (> 0.05) -> 'hinglish'
   * 5. Otherwise -> 'english'
   *
   * @param text - Input text string
   * @returns Typed DetectedLanguage ('hindi' | 'hinglish' | 'english')
   */
  detectLanguage(text: string): DetectedLanguage {
    if (!text || typeof text !== 'string' || text.length === 0) {
      return 'english';
    }

    // Count Hindi Unicode characters in range U+0900–U+097F
    const hindiMatches = text.match(/[\u0900-\u097F]/g);
    const hindiCount = hindiMatches ? hindiMatches.length : 0;

    const proportion = hindiCount / text.length;

    if (proportion > 0.2) {
      return 'hindi';
    }
    if (proportion > 0.05) {
      return 'hinglish';
    }
    return 'english';
  }

  /**
   * Maps detected language to the corresponding Sarvam TTS language code:
   * 'hindi' or 'hinglish' -> 'hi-IN' (meera)
   * 'english' -> 'en-IN' (pavithra)
   */
  getTtsLanguageCode(language: DetectedLanguage): SupportedTtsLanguage {
    return language === 'english' ? 'en-IN' : 'hi-IN';
  }
}
