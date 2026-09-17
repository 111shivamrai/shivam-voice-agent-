import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SmallestService } from './smallest.service.js';
import {
  SmallestConfigurationException,
  SmallestInvalidInputException,
  SmallestAuthenticationException,
  SmallestUnavailableException,
  SmallestTimeoutException,
  SmallestMalformedResponseException,
} from './smallest.exceptions.js';

/**
 * Creates a mock WAV audio Buffer.
 */
function createMockWavBuffer(byteLength = 1600): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + byteLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // Mono
  header.writeUInt32LE(8000, 24); // 8000Hz
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(byteLength, 40);

  const payload = Buffer.alloc(byteLength, 0x33);
  return Buffer.concat([header, payload]);
}

describe('SmallestService', () => {
  let service: SmallestService;
  let _configService: ConfigService;

  beforeEach(async () => {
    // Mock global fetch for Smallest.ai HTTP requests
    global.fetch = jest.fn().mockImplementation(async (_url: string, _opts?: any) => {
      const mockWav = createMockWavBuffer(2000);
      return new Response(new Uint8Array(mockWav), {
        status: 200,
        headers: { 'Content-Type': 'audio/wav' },
      });
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmallestService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'SMALLEST_API_KEY' || key === 'smallest.apiKey') {
                return 'sk_test_mock_smallest_key_12345';
              }
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<SmallestService>(SmallestService);
    _configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ====================================================================
  // 1. Instantiation & Configuration
  // ====================================================================
  describe('Instantiation & Configuration', () => {
    it('1. should instantiate successfully when SMALLEST_API_KEY is present', () => {
      expect(service).toBeDefined();
    });

    it('2. should throw SmallestConfigurationException when API key is missing', async () => {
      const emptyConfig = {
        get: jest.fn().mockReturnValue(null),
      };
      const unconfiguredService = new SmallestService(emptyConfig as any);
      await expect(unconfiguredService.textToSpeech('Hello')).rejects.toThrow(
        SmallestConfigurationException,
      );
    });

    it('3. should throw SmallestConfigurationException when API key is blank/whitespace', async () => {
      const blankConfig = {
        get: jest.fn().mockReturnValue('   '),
      };
      const unconfiguredService = new SmallestService(blankConfig as any);
      await expect(unconfiguredService.textToSpeech('Hello')).rejects.toThrow(
        SmallestConfigurationException,
      );
    });
  });

  // ====================================================================
  // 2. Text Preprocessing
  // ====================================================================
  describe('Text Preprocessing', () => {
    it('4. should strip Markdown bold, italics, headers, code, and links', () => {
      const markdown = '# Hello World\nThis is **bold** and *italic* text with `code` and [a link](https://example.com).';
      const cleaned = service.preprocessText(markdown);
      expect(cleaned).not.toContain('#');
      expect(cleaned).not.toContain('**');
      expect(cleaned).not.toContain('*');
      expect(cleaned).not.toContain('`');
      expect(cleaned).not.toContain('https://example.com');
      expect(cleaned).toContain('This is bold and italic text with code and a link.');
    });

    it('5. should strip emojis from text', () => {
      const textWithEmojis = 'Welcome to our clinic! 😊🏥 We are open today. 👍';
      const cleaned = service.preprocessText(textWithEmojis);
      expect(cleaned).not.toContain('😊');
      expect(cleaned).not.toContain('🏥');
      expect(cleaned).not.toContain('👍');
      expect(cleaned).toBe('Welcome to our clinic! We are open today.');
    });

    it('6. should strip standalone URLs', () => {
      const textWithUrl = 'Visit our portal at https://myclinic.example.com/portal or www.myclinic.com for info.';
      const cleaned = service.preprocessText(textWithUrl);
      expect(cleaned).not.toContain('https://myclinic.example.com/portal');
      expect(cleaned).not.toContain('www.myclinic.com');
      expect(cleaned).toContain('Visit our portal at or for info.');
    });

    it('7. should enforce maximum 500 characters limit without breaking sentences', () => {
      const longSentence = 'This is a test sentence that will be repeated multiple times to exceed the limit. ';
      const longText = longSentence.repeat(15); // > 1000 chars
      const cleaned = service.preprocessText(longText);
      expect(cleaned.length).toBeLessThanOrEqual(500);
      expect(cleaned.endsWith('.')).toBe(true);
    });

    it('8. should return empty string for null, undefined, or empty input', () => {
      expect(service.preprocessText('')).toBe('');
      expect(service.preprocessText('   ')).toBe('');
      expect(service.preprocessText(null as any)).toBe('');
      expect(service.preprocessText(undefined as any)).toBe('');
    });
  });

  // ====================================================================
  // 3. Voice and Language Selection
  // ====================================================================
  describe('Voice and Language Selection', () => {
    it('9. should select anika for English by default', () => {
      expect(service.selectVoice('English')).toBe('anika');
      expect(service.selectVoice('en-IN')).toBe('anika');
      expect(service.selectVoice(undefined)).toBe('anika');
    });

    it('10. should select raj for Hindi and Hinglish', () => {
      expect(service.selectVoice('Hindi')).toBe('raj');
      expect(service.selectVoice('hi-IN')).toBe('raj');
      expect(service.selectVoice('Hinglish')).toBe('raj');
    });

    it('11. should accept explicitly supported voice parameters', () => {
      expect(service.selectVoice('English', 'arjun')).toBe('arjun');
      expect(service.selectVoice('English', 'pooja')).toBe('pooja');
      expect(service.selectVoice('English', 'emily')).toBe('emily');
      expect(service.selectVoice('Hindi', 'raman')).toBe('raman');
    });

    it('12. should map language to hi or en', () => {
      expect(service.mapLanguage('Hindi')).toBe('hi');
      expect(service.mapLanguage('hi-IN')).toBe('hi');
      expect(service.mapLanguage('Hinglish')).toBe('hi');
      expect(service.mapLanguage('English')).toBe('en');
      expect(service.mapLanguage('en-US')).toBe('en');
      expect(service.mapLanguage(undefined)).toBe('en');
    });
  });

  // ====================================================================
  // 4. textToSpeech Synthesis
  // ====================================================================
  describe('textToSpeech synthesis', () => {
    it('13. should synthesize English speech with 8000Hz WAV and anika voice', async () => {
      const result = await service.textToSpeech('Hello, how can I help you today?', 'English');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://waves-api.smallest.ai/api/v1/lightning/get_speech',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk_test_mock_smallest_key_12345',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            text: 'Hello, how can I help you today?',
            voice_id: 'anika',
            sample_rate: 8000,
            speed: 1.0,
            add_wav_header: true,
          }),
        }),
      );

      expect(result).toBeDefined();
      expect(result.audioBuffer).toBeInstanceOf(Buffer);
      expect(result.sampleRate).toBe(8000);
      expect(result.voiceId).toBe('anika');
      expect(result.languageCode).toBe('en');
    });

    it('14. should synthesize Hindi speech with raj voice', async () => {
      const result = await service.textToSpeech('नमस्ते, मैं आपकी क्या सहायता कर सकता हूँ?', 'Hindi');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://waves-api.smallest.ai/api/v1/lightning/get_speech',
        expect.objectContaining({
          body: JSON.stringify({
            text: 'नमस्ते, मैं आपकी क्या सहायता कर सकता हूँ?',
            voice_id: 'raj',
            sample_rate: 8000,
            speed: 1.0,
            add_wav_header: true,
          }),
        }),
      );

      expect(result.voiceId).toBe('raj');
      expect(result.languageCode).toBe('hi');
    });

    it('15. should throw SmallestInvalidInputException for empty text after preprocessing', async () => {
      await expect(service.textToSpeech('   ')).rejects.toThrow(
        SmallestInvalidInputException,
      );
      await expect(service.textToSpeech('😊👍')).rejects.toThrow(
        SmallestInvalidInputException,
      );
    });

    it('16. should throw SmallestAuthenticationException on HTTP 401', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        new Response('Unauthorized: Invalid API Key', { status: 401 }),
      );

      await expect(service.textToSpeech('Valid text')).rejects.toThrow(
        SmallestAuthenticationException,
      );
    });

    it('17. should throw SmallestUnavailableException on HTTP 429 rate limiting', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        new Response('Rate limit exceeded', { status: 429 }),
      );

      await expect(service.textToSpeech('Valid text')).rejects.toThrow(
        SmallestUnavailableException,
      );
    });

    it('18. should throw SmallestUnavailableException on HTTP 500/503 server errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500 }),
      );

      await expect(service.textToSpeech('Valid text')).rejects.toThrow(
        SmallestUnavailableException,
      );
    });

    it('19. should throw SmallestTimeoutException when request aborts due to timeout', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      (global.fetch as jest.Mock).mockRejectedValueOnce(abortError);

      await expect(service.textToSpeech('Valid text')).rejects.toThrow(
        SmallestTimeoutException,
      );
    });

    it('20. should throw SmallestUnavailableException on network failure', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'));

      await expect(service.textToSpeech('Valid text')).rejects.toThrow(
        SmallestUnavailableException,
      );
    });

    it('21. should throw SmallestMalformedResponseException on empty response body', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        new Response(new Uint8Array(0), { status: 200 }),
      );

      await expect(service.textToSpeech('Valid text')).rejects.toThrow(
        SmallestMalformedResponseException,
      );
    });
  });

  // ====================================================================
  // 5. Credentials Sanitization
  // ====================================================================
  describe('Credentials Sanitization', () => {
    it('22. should redact bearer tokens, sk_ keys, and api keys from error logs', () => {
      const raw = 'Crash in Bearer sk_05fb37609faa0c424fd5dd440f339643 and apiKey: sk_test123';
      const sanitized = service.sanitizeMessage(raw);

      expect(sanitized).not.toContain('sk_05fb37609faa0c424fd5dd440f339643');
      expect(sanitized).not.toContain('sk_test123');
      expect(sanitized).toContain('[REDACTED]');
    });
  });

  // ====================================================================
  // 6. Concurrency Safety
  // ====================================================================
  describe('Concurrency Safety', () => {
    it('23. should handle concurrent TTS requests without shared state interference', async () => {
      const [res1, res2] = await Promise.all([
        service.textToSpeech('First caller message in English', 'English'),
        service.textToSpeech('Second caller message in Hindi', 'Hindi'),
      ]);

      expect(res1.voiceId).toBe('anika');
      expect(res2.voiceId).toBe('raj');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });
});
