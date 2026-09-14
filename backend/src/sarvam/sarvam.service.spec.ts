import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SarvamService } from './sarvam.service.js';
import {
  SarvamConfigurationException,
  SarvamInvalidInputException,
  SarvamRequestRejectedException,
  SarvamUnavailableException,
  SarvamTimeoutException,
  SarvamMalformedResponseException,
} from './sarvam.exceptions.js';

describe('SarvamService', () => {
  let service: SarvamService;
  let configService: jest.Mocked<Partial<ConfigService>>;
  const originalFetch = global.fetch;

  // Use a dummy secret for mock tests — NEVER real credentials
  const MOCK_API_KEY = 'mock_sarvam_test_key_xyz123';

  beforeEach(async () => {
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (
          key === 'SARVAM_API_KEY' ||
          key === 'sarvam.apiKey' ||
          key === 'sarvamApiKey'
        ) {
          return MOCK_API_KEY;
        }
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SarvamService,
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    }).compile();

    service = module.get<SarvamService>(SarvamService);

    // Mock global.fetch
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('initializes SarvamService correctly', () => {
    expect(service).toBeDefined();
  });

  // =========================================================================
  // 1. SPEECH-TO-TEXT (STT) TESTS
  // =========================================================================
  describe('speechToText', () => {
    const validWavBuffer = Buffer.from('RIFF....WAVEfmt ....data....');

    it('successfully transcribes WAV audio with correct endpoint, model, and language', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          transcript: 'नमस्ते, मैं आपकी कैसे सहायता कर सकता हूँ?',
        }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const transcript = await service.speechToText(validWavBuffer);

      expect(transcript).toBe('नमस्ते, मैं आपकी कैसे सहायता कर सकता हूँ?');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.sarvam.ai/speech-to-text');
      expect(options.method).toBe('POST');
      expect(options.headers['api-subscription-key']).toBe(MOCK_API_KEY);

      // Verify multipart/form-data payload contains saaras:v3, hi-IN, with_timestamps=false
      const formData = options.body as FormData;
      expect(formData.get('model')).toBe('saaras:v3');
      expect(formData.get('language_code')).toBe('hi-IN');
      expect(formData.get('with_timestamps')).toBe('false');
      expect(formData.get('file')).toBeDefined();
    });

    it('rejects empty or missing audio buffer with SarvamInvalidInputException', async () => {
      await expect(service.speechToText(Buffer.alloc(0))).rejects.toThrow(
        SarvamInvalidInputException,
      );
      await expect(service.speechToText(null as any)).rejects.toThrow(
        SarvamInvalidInputException,
      );
      await expect(service.speechToText(undefined as any)).rejects.toThrow(
        SarvamInvalidInputException,
      );
    });

    it('fails safely with SarvamConfigurationException if API key is missing', async () => {
      (configService.get as jest.Mock).mockReturnValue(undefined);

      await expect(service.speechToText(validWavBuffer)).rejects.toThrow(
        SarvamConfigurationException,
      );
    });

    it('handles provider HTTP 4xx errors with SarvamRequestRejectedException', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: jest.fn().mockResolvedValue({ message: 'Invalid audio sample rate' }),
      });

      await expect(service.speechToText(validWavBuffer)).rejects.toThrow(
        SarvamRequestRejectedException,
      );
    });

    it('handles provider HTTP 5xx errors with SarvamUnavailableException', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: jest.fn().mockResolvedValue({ error: 'Model overloaded' }),
      });

      await expect(service.speechToText(validWavBuffer)).rejects.toThrow(
        SarvamUnavailableException,
      );
    });

    it('handles request timeout with SarvamTimeoutException', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      (global.fetch as jest.Mock).mockRejectedValue(abortError);

      await expect(service.speechToText(validWavBuffer)).rejects.toThrow(
        SarvamTimeoutException,
      );
    });

    it('handles network connection failure with SarvamUnavailableException', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(
        new Error('getaddrinfo ENOTFOUND api.sarvam.ai'),
      );

      await expect(service.speechToText(validWavBuffer)).rejects.toThrow(
        SarvamUnavailableException,
      );
    });

    it('throws SarvamMalformedResponseException if response is not valid JSON', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockRejectedValue(new Error('Unexpected token < in JSON')),
      });

      await expect(service.speechToText(validWavBuffer)).rejects.toThrow(
        SarvamMalformedResponseException,
      );
    });

    it('throws SarvamMalformedResponseException if transcript field is missing in JSON', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ text: 'Wrong key name' }),
      });

      await expect(service.speechToText(validWavBuffer)).rejects.toThrow(
        SarvamMalformedResponseException,
      );
    });

    it('returns empty string if transcript is empty whitespace', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ transcript: '   ' }),
      });

      const res = await service.speechToText(validWavBuffer);
      expect(res).toBe('');
    });
  });

  // =========================================================================
  // 2. TEXT-TO-SPEECH (TTS) TESTS
  // =========================================================================
  describe('textToSpeech', () => {
    const mockWavBase64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEA';

    it('successfully synthesizes Hindi TTS with bulbul:v3, hi-IN, priya, and 8000 Hz', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          audios: [mockWavBase64],
        }),
      });

      const res = await service.textToSpeech('नमस्ते, क्या हाल है?', 'hi-IN');

      expect(res.audioBase64).toBe(mockWavBase64);
      expect(Buffer.isBuffer(res.audioBuffer)).toBe(true);
      expect(res.sampleRate).toBe(8000);
      expect(res.languageCode).toBe('hi-IN');
      expect(res.speaker).toBe('priya');

      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.sarvam.ai/text-to-speech');
      expect(options.headers['api-subscription-key']).toBe(MOCK_API_KEY);
      expect(options.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body as string);
      expect(body).toEqual({
        inputs: ['नमस्ते, क्या हाल है?'],
        target_language_code: 'hi-IN',
        speaker: 'priya',
        pace: 1.0,
        speech_sample_rate: 8000,
        enable_preprocessing: true,
        model: 'bulbul:v3',
      });
    });

    it('successfully synthesizes English TTS with bulbul:v3, en-IN, and priya speaker', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          audios: [mockWavBase64],
        }),
      });

      const res = await service.textToSpeech(
        'Welcome to our automated voice assistant.',
        'en-IN',
      );

      expect(res.speaker).toBe('priya');
      expect(res.languageCode).toBe('en-IN');
      expect(res.sampleRate).toBe(8000);

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(options.body as string);
      expect(body.speaker).toBe('priya');
      expect(body.target_language_code).toBe('en-IN');
      expect(body.model).toBe('bulbul:v3');
    });

    it('rejects empty or whitespace-only text with SarvamInvalidInputException', async () => {
      await expect(service.textToSpeech('', 'hi-IN')).rejects.toThrow(
        SarvamInvalidInputException,
      );
      await expect(service.textToSpeech('   ', 'en-IN')).rejects.toThrow(
        SarvamInvalidInputException,
      );
      await expect(service.textToSpeech(null as any, 'hi-IN')).rejects.toThrow(
        SarvamInvalidInputException,
      );
    });

    it('rejects unsupported language codes with SarvamInvalidInputException', async () => {
      await expect(
        service.textToSpeech('Hello', 'fr-FR' as any),
      ).rejects.toThrow(SarvamInvalidInputException);
      await expect(
        service.textToSpeech('Hello', 'es-ES' as any),
      ).rejects.toThrow(SarvamInvalidInputException);
    });

    it('fails safely with SarvamConfigurationException if API key is missing', async () => {
      (configService.get as jest.Mock).mockReturnValue(undefined);

      await expect(service.textToSpeech('Hello', 'en-IN')).rejects.toThrow(
        SarvamConfigurationException,
      );
    });

    it('handles provider HTTP 4xx error with SarvamRequestRejectedException', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: jest.fn().mockResolvedValue({ message: 'Text too long' }),
      });

      await expect(service.textToSpeech('Hello', 'en-IN')).rejects.toThrow(
        SarvamRequestRejectedException,
      );
    });

    it('handles provider HTTP 5xx error with SarvamUnavailableException', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: jest.fn().mockResolvedValue({ error: 'Server crashed' }),
      });

      await expect(service.textToSpeech('Hello', 'en-IN')).rejects.toThrow(
        SarvamUnavailableException,
      );
    });

    it('handles TTS request timeout with SarvamTimeoutException', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      (global.fetch as jest.Mock).mockRejectedValue(abortError);

      await expect(service.textToSpeech('Hello', 'en-IN')).rejects.toThrow(
        SarvamTimeoutException,
      );
    });

    it('throws SarvamMalformedResponseException if audios array is missing in TTS response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ audio: 'wrong_key' }),
      });

      await expect(service.textToSpeech('Hello', 'en-IN')).rejects.toThrow(
        SarvamMalformedResponseException,
      );
    });

    it('throws SarvamMalformedResponseException if audios array is empty or contains empty string', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ audios: [] }),
      });

      await expect(service.textToSpeech('Hello', 'en-IN')).rejects.toThrow(
        SarvamMalformedResponseException,
      );

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ audios: ['   '] }),
      });

      await expect(service.textToSpeech('Hello', 'en-IN')).rejects.toThrow(
        SarvamMalformedResponseException,
      );
    });
  });

  // =========================================================================
  // 3. LANGUAGE DETECTION TESTS
  // =========================================================================
  describe('detectLanguage', () => {
    it('detects clearly Hindi text (> 20% Hindi characters)', () => {
      const pureHindi = 'नमस्ते, आप कैसे हैं?';
      expect(service.detectLanguage(pureHindi)).toBe('hindi');

      // Mostly Hindi with some English: "नमस्ते दुनिया this is cool"
      expect(service.detectLanguage('नमस्ते दुनिया this is cool')).toBe('hindi');
    });

    it('detects clearly English text (0% or <= 5% Hindi characters)', () => {
      const englishText = 'Hello, how are you doing today? Welcome to our service.';
      expect(service.detectLanguage(englishText)).toBe('english');
    });

    it('detects Hinglish text (> 5% and <= 20% Hindi characters)', () => {
      // 100 characters total, with 10 Hindi characters -> 10%
      // 10 Hindi chars = 'नमस्तेनमस्ते' (12 chars).
      // Let's craft exact string: 10 Hindi chars out of 100 total chars = 10%
      const tenHindiChars = 'अआइईउऊऋएऐओ'; // exactly 10 characters in U+0900-U+097F
      const ninetyAscii = 'a'.repeat(90);
      const testString = tenHindiChars + ninetyAscii; // total length = 100
      expect(service.detectLanguage(testString)).toBe('hinglish');
    });

    it('verifies boundary behavior around 5%', () => {
      // Exactly 5%: 5 Hindi chars out of 100 = 5.0% -> NOT > 5% -> 'english'
      const fiveHindi = 'अआइईउ'; // 5 chars
      const ninetyFiveAscii = 'b'.repeat(95);
      expect(service.detectLanguage(fiveHindi + ninetyFiveAscii)).toBe('english');

      // 6%: 6 Hindi chars out of 100 = 6.0% -> > 5% -> 'hinglish'
      const sixHindi = 'अआइईउऊ'; // 6 chars
      const ninetyFourAscii = 'b'.repeat(94);
      expect(service.detectLanguage(sixHindi + ninetyFourAscii)).toBe('hinglish');
    });

    it('verifies boundary behavior around 20%', () => {
      // Exactly 20%: 20 Hindi chars out of 100 = 20.0% -> NOT > 20% -> 'hinglish'
      const twentyHindi = 'अआइईउऊऋएऐओअआइईउऊऋएऐओ'; // 20 chars
      const eightyAscii = 'c'.repeat(80);
      expect(service.detectLanguage(twentyHindi + eightyAscii)).toBe('hinglish');

      // 21%: 21 Hindi chars out of 100 = 21.0% -> > 20% -> 'hindi'
      const twentyOneHindi = twentyHindi + 'क'; // 21 chars
      const seventyNineAscii = 'c'.repeat(79);
      expect(service.detectLanguage(twentyOneHindi + seventyNineAscii)).toBe('hindi');
    });

    it('handles empty or null/undefined text safely by returning english', () => {
      expect(service.detectLanguage('')).toBe('english');
      expect(service.detectLanguage(null as any)).toBe('english');
      expect(service.detectLanguage(undefined as any)).toBe('english');
    });

    it('handles punctuation and numbers only by returning english', () => {
      expect(service.detectLanguage('1234567890 !@#$%^&*()_+-=')).toBe('english');
      expect(service.detectLanguage('.,;:?! " "')).toBe('english');
    });

    it('maps detected language to appropriate TTS language code via getTtsLanguageCode', () => {
      expect(service.getTtsLanguageCode('hindi')).toBe('hi-IN');
      expect(service.getTtsLanguageCode('hinglish')).toBe('hi-IN');
      expect(service.getTtsLanguageCode('english')).toBe('en-IN');
    });
  });

  // =========================================================================
  // 4. SECURITY & SENSITIVE CREDENTIAL LEAKAGE TESTS
  // =========================================================================
  describe('Security & Credential Protection', () => {
    it('never exposes API subscription key in thrown exceptions or error messages', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: jest.fn().mockResolvedValue({ detail: 'Invalid subscription key' }),
      });

      try {
        await service.textToSpeech('Test', 'en-IN');
        fail('Should have thrown an exception');
      } catch (err: any) {
        expect(err.message).not.toContain(MOCK_API_KEY);
        expect(JSON.stringify(err)).not.toContain(MOCK_API_KEY);
      }
    });

    it('never leaks API key in STT exceptions', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(
        new Error('Network error on https://api.sarvam.ai'),
      );

      try {
        await service.speechToText(Buffer.from('test audio'));
        fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).not.toContain(MOCK_API_KEY);
      }
    });

    it('never returns the API key in STT or TTS response objects', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          transcript: 'sample transcript',
          audios: ['dGVzdF9hdWRpbw=='],
        }),
      });

      const sttRes = await service.speechToText(Buffer.from('audio'));
      expect(sttRes).not.toContain(MOCK_API_KEY);

      const ttsRes = await service.textToSpeech('hello', 'en-IN');
      expect(JSON.stringify(ttsRes)).not.toContain(MOCK_API_KEY);
    });
  });
});
