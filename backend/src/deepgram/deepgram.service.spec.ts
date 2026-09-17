import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DeepgramService } from './deepgram.service.js';
import { DeepgramConfigurationException } from './deepgram.exceptions.js';
import * as deepgramSdk from '@deepgram/sdk';

// Mock @deepgram/sdk
jest.mock('@deepgram/sdk', () => ({
  createClient: jest.fn(),
  LiveTranscriptionEvents: {
    Open: 'Open',
    Close: 'Close',
    Transcript: 'Transcript',
    Error: 'Error',
    Metadata: 'Metadata',
    UtteranceEnd: 'UtteranceEnd',
    SpeechStarted: 'SpeechStarted',
  },
}));

/**
 * Creates a valid WAV Buffer of specified PCM payload byte length (minimum 44 byte header).
 */
function createValidWavBuffer(pcmByteLength = 1600): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmByteLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size
  header.writeUInt16LE(1, 20); // AudioFormat (PCM = 1)
  header.writeUInt16LE(1, 22); // NumChannels (1 = Mono)
  header.writeUInt32LE(8000, 24); // SampleRate (8000Hz)
  header.writeUInt32LE(16000, 28); // ByteRate (8000 * 1 * 2)
  header.writeUInt16LE(2, 32); // BlockAlign (1 * 2)
  header.writeUInt16LE(16, 34); // BitsPerSample (16)
  header.write('data', 36);
  header.writeUInt32LE(pcmByteLength, 40);

  const payload = Buffer.alloc(pcmByteLength, 0x55);
  return Buffer.concat([header, payload]);
}

describe('DeepgramService', () => {
  let service: DeepgramService;
  let _configService: ConfigService;
  let mockTranscribeFile: jest.Mock;
  let mockDeepgramClient: any;

  beforeEach(async () => {
    mockTranscribeFile = jest.fn().mockResolvedValue({
      result: {
        results: {
          channels: [
            {
              alternatives: [
                {
                  transcript: 'Hello, this is a test transcription.',
                  confidence: 0.98,
                },
              ],
            },
          ],
        },
      },
      error: null,
    });

    const mockLiveConnection = {
      on: jest.fn(),
      send: jest.fn(),
      finish: jest.fn(),
    };

    mockDeepgramClient = {
      listen: {
        prerecorded: {
          transcribeFile: mockTranscribeFile,
        },
        live: jest.fn().mockReturnValue(mockLiveConnection),
      },
    };

    (deepgramSdk.createClient as jest.Mock).mockReturnValue(mockDeepgramClient);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeepgramService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'DEEPGRAM_API_KEY' || key === 'deepgram.apiKey') {
                return 'test_deepgram_api_key_12345';
              }
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<DeepgramService>(DeepgramService);
    _configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  // ====================================================================
  // 1. Instantiation & Configuration
  // ====================================================================
  describe('Instantiation & Configuration', () => {
    it('1. should instantiate successfully when DEEPGRAM_API_KEY is present', () => {
      expect(service).toBeDefined();
      expect(deepgramSdk.createClient).toHaveBeenCalledWith('test_deepgram_api_key_12345');
    });

    it('2. should throw DeepgramConfigurationException when API key is missing', async () => {
      const mockConfigEmpty = {
        get: jest.fn().mockReturnValue(null),
      };

      expect(() => {
        new DeepgramService(mockConfigEmpty as any);
      }).toThrow(DeepgramConfigurationException);
    });

    it('3. should throw DeepgramConfigurationException when API key is whitespace only', () => {
      const mockConfigEmpty = {
        get: jest.fn().mockReturnValue('   '),
      };

      expect(() => {
        new DeepgramService(mockConfigEmpty as any);
      }).toThrow(DeepgramConfigurationException);
    });
  });

  // ====================================================================
  // 2. Language Mapping
  // ====================================================================
  describe('mapLanguage', () => {
    it('4. should map English to en-IN', () => {
      expect(service.mapLanguage('english')).toBe('en-IN');
      expect(service.mapLanguage('English')).toBe('en-IN');
      expect(service.mapLanguage('en')).toBe('en-IN');
      expect(service.mapLanguage('en-IN')).toBe('en-IN');
      expect(service.mapLanguage('en-US')).toBe('en-IN');
    });

    it('5. should map Hindi to hi', () => {
      expect(service.mapLanguage('hindi')).toBe('hi');
      expect(service.mapLanguage('Hindi')).toBe('hi');
      expect(service.mapLanguage('hi')).toBe('hi');
      expect(service.mapLanguage('hi-IN')).toBe('hi');
    });

    it('6. should map Hinglish to hi', () => {
      expect(service.mapLanguage('hinglish')).toBe('hi');
      expect(service.mapLanguage('Hinglish')).toBe('hi');
    });

    it('7. should fallback to hi for undefined/null/unknown languages', () => {
      expect(service.mapLanguage(undefined)).toBe('hi');
      expect(service.mapLanguage('')).toBe('hi');
      expect(service.mapLanguage('unknown-language')).toBe('hi');
    });
  });

  // ====================================================================
  // 3. Audio Validation & Minimum Byte Checks
  // ====================================================================
  describe('Audio Buffer Validation', () => {
    it('8. should return empty string for null / undefined / non-buffer audio', async () => {
      const resNull = await service.transcribeAudio(null as any);
      const resUndef = await service.transcribeAudio(undefined as any);
      const resEmpty = await service.transcribeAudio(Buffer.alloc(0));

      expect(resNull).toBe('');
      expect(resUndef).toBe('');
      expect(resEmpty).toBe('');
      expect(mockTranscribeFile).not.toHaveBeenCalled();
    });

    it('9. should return empty string if audio length is under 1600 bytes', async () => {
      const smallBuffer = Buffer.alloc(1599);
      const res = await service.transcribeAudio(smallBuffer);

      expect(res).toBe('');
      expect(mockTranscribeFile).not.toHaveBeenCalled();
    });

    it('10. should return empty string for invalid WAV header (not RIFF/WAVE)', async () => {
      const nonWavBuffer = Buffer.alloc(2000, 0x00);
      const res = await service.transcribeAudio(nonWavBuffer);

      expect(res).toBe('');
      expect(mockTranscribeFile).not.toHaveBeenCalled();
    });
  });

  // ====================================================================
  // 4. transcribeAudio execution
  // ====================================================================
  describe('transcribeAudio with Deepgram Nova-3', () => {
    it('11. should transcribe valid English audio using nova-3 and en-IN', async () => {
      const wavBuffer = createValidWavBuffer(2000);
      const transcript = await service.transcribeAudio(wavBuffer, 'English');

      expect(mockTranscribeFile).toHaveBeenCalledWith(
        wavBuffer,
        expect.objectContaining({
          model: 'nova-3',
          smart_format: true,
          punctuate: true,
          language: 'en-IN',
          diarize: false,
        }),
      );
      expect(transcript).toBe('Hello, this is a test transcription.');
    });

    it('12. should transcribe valid Hindi audio using nova-3 and hi', async () => {
      mockTranscribeFile.mockResolvedValueOnce({
        result: {
          results: {
            channels: [
              {
                alternatives: [
                  {
                    transcript: 'नमस्ते, मैं आपकी क्या मदद कर सकता हूँ?',
                    confidence: 0.95,
                  },
                ],
              },
            ],
          },
        },
        error: null,
      });

      const wavBuffer = createValidWavBuffer(2000);
      const transcript = await service.transcribeAudio(wavBuffer, 'Hindi');

      expect(mockTranscribeFile).toHaveBeenCalledWith(
        wavBuffer,
        expect.objectContaining({
          model: 'nova-3',
          language: 'hi',
        }),
      );
      expect(transcript).toBe('नमस्ते, मैं आपकी क्या मदद कर सकता हूँ?');
    });

    it('13. should handle empty Deepgram transcript gracefully', async () => {
      mockTranscribeFile.mockResolvedValueOnce({
        result: {
          results: {
            channels: [
              {
                alternatives: [
                  {
                    transcript: '',
                  },
                ],
              },
            ],
          },
        },
        error: null,
      });

      const wavBuffer = createValidWavBuffer(2000);
      const transcript = await service.transcribeAudio(wavBuffer);
      expect(transcript).toBe('');
    });

    it('14. should handle whitespace-only Deepgram transcript gracefully', async () => {
      mockTranscribeFile.mockResolvedValueOnce({
        result: {
          results: {
            channels: [
              {
                alternatives: [
                  {
                    transcript: '    \n\t   ',
                  },
                ],
              },
            ],
          },
        },
        error: null,
      });

      const wavBuffer = createValidWavBuffer(2000);
      const transcript = await service.transcribeAudio(wavBuffer);
      expect(transcript).toBe('');
    });

    it('15. should handle Deepgram error response gracefully without crashing', async () => {
      mockTranscribeFile.mockResolvedValueOnce({
        result: null,
        error: new Error('Deepgram internal server error'),
      });

      const wavBuffer = createValidWavBuffer(2000);
      const transcript = await service.transcribeAudio(wavBuffer);
      expect(transcript).toBe('');
    });

    it('16. should handle network / SDK rejection gracefully and return empty string', async () => {
      mockTranscribeFile.mockRejectedValueOnce(new Error('Connection reset by peer'));

      const wavBuffer = createValidWavBuffer(2000);
      const transcript = await service.transcribeAudio(wavBuffer);
      expect(transcript).toBe('');
    });

    it('17. should handle malformed response missing results or channels gracefully', async () => {
      mockTranscribeFile.mockResolvedValueOnce({
        result: {},
        error: null,
      });

      const wavBuffer = createValidWavBuffer(2000);
      const transcript = await service.transcribeAudio(wavBuffer);
      expect(transcript).toBe('');
    });

    it('18. should enforce timeout if request takes longer than timeout limit', async () => {
      (service as any).defaultTimeoutMs = 50;
      mockTranscribeFile.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 300)),
      );

      const wavBuffer = createValidWavBuffer(2000);
      const transcript = await service.transcribeAudio(wavBuffer);
      expect(transcript).toBe('');
      (service as any).defaultTimeoutMs = 8000;
    });
  });

  // ====================================================================
  // 5. transcribeStream
  // ====================================================================
  describe('transcribeStream', () => {
    it('19. should combine audio chunks and delegate to transcribeAudio', async () => {
      const chunk1 = createValidWavBuffer(800);
      const chunk2 = Buffer.alloc(800, 0x11);

      const transcript = await service.transcribeStream([chunk1, chunk2], 'English');

      expect(mockTranscribeFile).toHaveBeenCalled();
      expect(transcript).toBe('Hello, this is a test transcription.');
    });

    it('20. should return empty string for empty or non-array chunks', async () => {
      expect(await service.transcribeStream([])).toBe('');
      expect(await service.transcribeStream(null as any)).toBe('');
      expect(await service.transcribeStream([Buffer.alloc(0)])).toBe('');
      expect(mockTranscribeFile).not.toHaveBeenCalled();
    });
  });

  // ====================================================================
  // 6. detectLanguage
  // ====================================================================
  describe('detectLanguage (Hindi Unicode ratio rule)', () => {
    it('21. should return Hindi for pure Hindi Devanagari text (>0.25 ratio)', () => {
      const text = 'नमस्ते, आप कैसे हैं? मुझे डॉक्टर से मिलना है।';
      expect(service.detectLanguage(text)).toBe('Hindi');
    });

    it('22. should return Hinglish for mixed Hindi/English text (>0.05 and <=0.25 ratio)', () => {
      // 4 Hindi chars out of 40 chars = 0.10 ratio
      const text = 'Hello sir, मुझे booking appointment confirm.';
      expect(service.detectLanguage(text)).toBe('Hinglish');
    });

    it('23. should return English for Latin English text (<=0.05 ratio)', () => {
      const text = 'Hello, I would like to know the clinic operating hours.';
      expect(service.detectLanguage(text)).toBe('English');
    });

    it('24. should safely return English for empty, whitespace, null, or undefined input', () => {
      expect(service.detectLanguage('')).toBe('English');
      expect(service.detectLanguage('   ')).toBe('English');
      expect(service.detectLanguage(null as any)).toBe('English');
      expect(service.detectLanguage(undefined as any)).toBe('English');
    });
  });

  // ====================================================================
  // 7. Security & Credentials Redaction
  // ====================================================================
  describe('Security & Credentials Redaction', () => {
    it('25. should sanitize sensitive authorization tokens and keys in error logs', async () => {
      mockTranscribeFile.mockRejectedValueOnce(
        new Error(
          'Failed request with Bearer secret_token_value_abc and apiKey: 60ba76b793dfc9c55ed70fc33fb4ab604008f182',
        ),
      );

      const loggerWarnSpy = jest.spyOn((service as any).logger, 'warn');
      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error');

      const wavBuffer = createValidWavBuffer(2000);
      await service.transcribeAudio(wavBuffer);

      const loggedMsg =
        (loggerWarnSpy.mock.calls[0]?.[0] as string) ||
        (loggerErrorSpy.mock.calls[0]?.[0] as string) ||
        '';

      expect(loggedMsg).not.toContain('secret_token_value_abc');
      expect(loggedMsg).not.toContain('60ba76b793dfc9c55ed70fc33fb4ab604008f182');
      expect(loggedMsg).toContain('[REDACTED]');
    });
  });

  // ====================================================================
  // 8. Concurrent Calls Isolation
  // ====================================================================
  describe('Concurrent Calls Isolation', () => {
    it('26. should handle concurrent transcription requests safely without state contamination', async () => {
      mockTranscribeFile
        .mockResolvedValueOnce({
          result: {
            results: {
              channels: [{ alternatives: [{ transcript: 'Caller 1 utterance' }] }],
            },
          },
          error: null,
        })
        .mockResolvedValueOnce({
          result: {
            results: {
              channels: [{ alternatives: [{ transcript: 'Caller 2 utterance' }] }],
            },
          },
          error: null,
        });

      const wav1 = createValidWavBuffer(1800);
      const wav2 = createValidWavBuffer(2200);

      const [res1, res2] = await Promise.all([
        service.transcribeAudio(wav1, 'English'),
        service.transcribeAudio(wav2, 'Hindi'),
      ]);

      expect(res1).toBe('Caller 1 utterance');
      expect(res2).toBe('Caller 2 utterance');
      expect(mockTranscribeFile).toHaveBeenCalledTimes(2);
    });
  });

  // ====================================================================
  // 9. Phase 4.5 Prompt 3: Nova-3 Live WebSocket Streaming
  // ====================================================================
  describe('createLiveStream', () => {
    let eventHandlers: Record<string, Function>;
    let mockLiveConn: any;

    beforeEach(() => {
      eventHandlers = {};
      mockLiveConn = {
        on: jest.fn().mockImplementation((event: string, handler: Function) => {
          eventHandlers[event] = handler;
        }),
        send: jest.fn(),
        finish: jest.fn(),
      };
      mockDeepgramClient.listen.live.mockReturnValue(mockLiveConn);
    });

    it('27. should configure live stream with linear16 8000Hz, endpointing 350, and interim_results', () => {
      const onTranscript = jest.fn();
      const stream = service.createLiveStream('session-1', {
        language: 'english',
        onTranscript,
      });

      expect(mockDeepgramClient.listen.live).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'nova-3',
          language: 'en-IN',
          encoding: 'linear16',
          sample_rate: 8000,
          channels: 1,
          endpointing: 350,
          interim_results: true,
          vad_events: true,
        }),
      );
      expect(stream).toBeDefined();
    });

    it('28. should send audio frames only when stream is active', () => {
      const stream = service.createLiveStream('session-2', {
        language: 'english',
        onTranscript: jest.fn(),
      });

      // Before open event, sending does nothing
      const chunk = Buffer.from([1, 2, 3]);
      stream.sendAudio(chunk);
      expect(mockLiveConn.send).not.toHaveBeenCalled();

      // Trigger open event
      eventHandlers['Open']();
      expect(stream.isActive()).toBe(true);

      stream.sendAudio(chunk);
      expect(mockLiveConn.send).toHaveBeenCalled();
    });

    it('29. should accumulate is_final segments and emit full utterance on speech_final', () => {
      const onTranscript = jest.fn();
      service.createLiveStream('session-3', {
        language: 'english',
        onTranscript,
      });

      eventHandlers['Open']();

      // Interim result (not final)
      eventHandlers['Transcript']({
        is_final: false,
        speech_final: false,
        channel: { alternatives: [{ transcript: 'What is' }] },
      });
      expect(onTranscript).toHaveBeenCalledWith('What is', false, false);

      // First final segment
      eventHandlers['Transcript']({
        is_final: true,
        speech_final: false,
        channel: { alternatives: [{ transcript: 'What is your' }] },
      });

      // Second final segment
      eventHandlers['Transcript']({
        is_final: true,
        speech_final: false,
        channel: { alternatives: [{ transcript: 'pricing plan?' }] },
      });

      // Speech final event
      eventHandlers['Transcript']({
        is_final: true,
        speech_final: true,
        channel: { alternatives: [{ transcript: '' }] },
      });

      expect(onTranscript).toHaveBeenCalledWith('What is your pricing plan?', true, true);
    });

    it('30. should clean up session on close and finish', () => {
      const onClose = jest.fn();
      const stream = service.createLiveStream('session-4', {
        language: 'english',
        onTranscript: jest.fn(),
        onClose,
      });

      eventHandlers['Open']();
      expect(stream.isActive()).toBe(true);

      stream.finish();
      expect(mockLiveConn.finish).toHaveBeenCalled();

      eventHandlers['Close']();
      expect(stream.isActive()).toBe(false);
      expect(onClose).toHaveBeenCalled();
    });

    it('31. should handle closeAllLiveStreams on shutdown gracefully', () => {
      const stream = service.createLiveStream('session-5', {
        language: 'english',
        onTranscript: jest.fn(),
      });
      eventHandlers['Open']();

      service.closeAllLiveStreams();
      expect(stream.isActive()).toBe(false);
      expect(mockLiveConn.finish).toHaveBeenCalled();
    });
  });
});
