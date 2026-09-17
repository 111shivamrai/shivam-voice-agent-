import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CallsService } from './calls.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { SarvamService } from '../sarvam/sarvam.service.js';
import { DeepgramService } from '../deepgram/deepgram.service.js';
import { SmallestService } from '../smallest/smallest.service.js';
import { VoiceSessionService } from './voice-session.service.js';
import { ConversationService } from './conversation.service.js';
import { TwilioService } from '../twilio/twilio.service.js';
import { MediaStreamService } from './media-stream.service.js';
import {
  InsufficientBalanceException,
  CallNotFoundException,
  InvalidPhoneNumberException,
  UnauthorizedCallAccessException,
  TelnyxApiException,
} from './calls.exceptions.js';
import {
  MAX_CALL_DURATION_SECONDS,
  CALL_MESSAGES,
} from './calls.types.js';

describe('CallsService', () => {
  let service: CallsService;
  let configService: ConfigService;
  let _supabaseService: SupabaseService;
  let sarvamService: SarvamService;
  let deepgramService: DeepgramService;
  let smallestService: SmallestService;
  let voiceSessionService: VoiceSessionService;
  let _conversationService: ConversationService;
  let twilioService: TwilioService;

  const mockClientId = '11111111-1111-4111-8111-111111111111';
  const mockOtherClientId = '22222222-2222-4222-8222-222222222222';
  const mockCallControlId = 'v3:call_ctrl_1234567890';
  const mockTelnyxNumber = '+15551234567';
  const mockCallerNumber = '+15559876543';

  // Mock database records
  let mockProfilesDb: Record<string, any> = {};
  let mockCallsDb: any[] = [];

  const createMockSupabase = () => {
    const dbClient = {
      auth: {
        getUser: jest.fn().mockImplementation(async (token: string) => {
          if (token === 'valid-token') {
            return { data: { user: { id: mockClientId } }, error: null };
          }
          return { data: null, error: new Error('Invalid token') };
        }),
      },
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockImplementation((field: string, val: string) => {
                let found: any = null;
                if (field === 'id') {
                  found = mockProfilesDb[val];
                  } else if (field === 'telnyx_number') {
                    found = Object.values(mockProfilesDb).find(
                      (p: any) => p.telnyx_number === val || p.telnyx_number === `+${val}`,
                    );
                  }
                  return {
                    maybeSingle: jest.fn().mockResolvedValue({
                      data: found ? { ...found } : null,
                      error: null,
                    }),
                  };
                }),
              }),
              update: jest.fn().mockImplementation((updates: any) => ({
                eq: jest.fn().mockImplementation((field: string, val: string) => {
                  if (mockProfilesDb[val]) {
                    Object.assign(mockProfilesDb[val], updates);
                  }
                  return Promise.resolve({ data: mockProfilesDb[val], error: null });
                }),
              })),
            };
          }

          if (table === 'calls') {
            return {
              insert: jest.fn().mockImplementation((record: any) => {
                const inserted = {
                  id: `call-db-${Date.now()}-${Math.random()}`,
                  created_at: new Date().toISOString(),
                  ...record,
                };
                mockCallsDb.push(inserted);
                return {
                  select: jest.fn().mockReturnValue({
                    single: jest.fn().mockResolvedValue({ data: inserted, error: null }),
                  }),
                };
              }),
              select: jest.fn().mockImplementation((_fields?: string, _opts?: any) => {
                let filtered = [...mockCallsDb];
                const builder: any = {
                  eq: jest.fn().mockImplementation((field: string, val: string) => {
                    filtered = filtered.filter((c) => c[field] === val);
                    return builder;
                  }),
                  order: jest.fn().mockImplementation(() => builder),
                  range: jest.fn().mockImplementation((start: number, end: number) => {
                    const sliced = filtered.slice(start, end + 1);
                    return Promise.resolve({
                      data: sliced,
                      count: filtered.length,
                      error: null,
                    });
                  }),
                  maybeSingle: jest.fn().mockImplementation(() => {
                    return Promise.resolve({
                      data: filtered[0] || null,
                      error: null,
                    });
                  }),
                };
                return builder;
              }),
              update: jest.fn().mockImplementation((updates: any) => ({
                eq: jest.fn().mockImplementation((field: string, val: string) => {
                  const item = mockCallsDb.find((c) => c[field] === val);
                  if (item) {
                    Object.assign(item, updates);
                  }
                  return Promise.resolve({ data: item, error: null });
                }),
              })),
            };
          }

          return {};
        }),
        rpc: jest.fn().mockImplementation((func: string, params: any) => {
          if (func === 'deduct_minutes') {
            const profile = mockProfilesDb[params.p_client_id];
            if (!profile) {
              return Promise.resolve({
                data: { success: false, error: 'profile_not_found' },
                error: null,
              });
            }
            const deductible = Math.min(profile.token_balance || 0, params.p_minutes);
            profile.token_balance = Math.max(0, (profile.token_balance || 0) - params.p_minutes);
            return Promise.resolve({
              data: {
                success: true,
                deducted: deductible,
                remaining_balance: profile.token_balance,
                client_id: params.p_client_id,
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        }),
      };
      return {
        getClient: jest.fn().mockReturnValue(dbClient),
        getAdminClient: jest.fn().mockReturnValue(dbClient),
      };
    };

  beforeEach(async () => {
    mockProfilesDb = {
      [mockClientId]: {
        id: mockClientId,
        email: 'client1@example.com',
        token_balance: 50,
        telnyx_number: mockTelnyxNumber,
        agent_language: 'English',
      },
      [mockOtherClientId]: {
        id: mockOtherClientId,
        email: 'client2@example.com',
        token_balance: 0,
        telnyx_number: '+15559990000',
        agent_language: 'Hindi',
      },
    };
    mockCallsDb = [];

    // Mock global fetch for Telnyx REST API calls
    global.fetch = jest.fn().mockImplementation(async (url: string, opts?: any) => {
      if (url.includes('/calls') && opts?.method === 'POST') {
        if (url.includes('/actions/')) {
          return new Response(JSON.stringify({ result: 'ok' }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            data: {
              call_control_id: 'v3:call_outbound_999',
              call_leg_id: 'leg-1',
              status: 'dialing',
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallsService,
        VoiceSessionService,
        {
          provide: TwilioService,
          useValue: {
            answerCall: jest.fn().mockReturnValue('<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://test.host/voice/stream"/></Connect></Response>'),
            hangupCall: jest.fn().mockResolvedValue(undefined),
            makeOutboundCall: jest.fn().mockResolvedValue('CA_outbound_test_123'),
            generateTwiML: jest.fn().mockImplementation((msg: string) => `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${msg}</Say><Hangup/></Response>`),
            getDefaultPhoneNumber: jest.fn().mockReturnValue(mockTelnyxNumber),
            getStreamUrl: jest.fn().mockReturnValue('wss://test.host/voice/stream'),
          },
        },
        {
          provide: MediaStreamService,
          useValue: {
            sendAudioToCaller: jest.fn().mockResolvedValue(false),
            handleWebSocketMessage: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'TELNYX_API_KEY' || key === 'telnyx.apiKey') return 'KEY_TELNYX_TEST_123';
              if (key === 'TELNYX_PHONE_NUMBER' || key === 'telnyx.phoneNumber') return mockTelnyxNumber;
              if (key === 'TELNYX_CONNECTION_ID' || key === 'TELNYX_APP_ID') return 'conn-123';
              if (key === 'TWILIO_ACCOUNT_SID') return 'AC_test_123';
              if (key === 'TWILIO_AUTH_TOKEN') return 'token_test_123';
              if (key === 'TWILIO_PHONE_NUMBER') return mockTelnyxNumber;
              if (key === 'BACKEND_URL') return 'http://localhost:3001';
              return null;
            }),
          },
        },
        {
          provide: SupabaseService,
          useValue: createMockSupabase(),
        },
        {
          provide: SarvamService,
          useValue: {
            speechToText: jest.fn().mockResolvedValue('What are your opening hours?'),
            textToSpeech: jest.fn().mockResolvedValue({
              audioBuffer: Buffer.from('mock-audio-data'),
              sampleRate: 24000,
              languageCode: 'en-IN',
            }),
            detectLanguage: jest.fn().mockReturnValue('english'),
          },
        },
        {
          provide: DeepgramService,
          useValue: {
            transcribeAudio: jest.fn().mockResolvedValue('What are your opening hours?'),
            transcribeStream: jest.fn().mockResolvedValue('What are your opening hours?'),
            detectLanguage: jest.fn().mockReturnValue('English'),
          },
        },
        {
          provide: SmallestService,
          useValue: {
            textToSpeech: jest.fn().mockResolvedValue({
              audioBuffer: Buffer.from('mock-audio-data'),
              audioBase64: 'bW9jay1hdWRpby1kYXRh',
              sampleRate: 8000,
              languageCode: 'en',
              voiceId: 'anika',
            }),
            preprocessText: jest.fn().mockImplementation((t: string) => t),
            selectVoice: jest.fn().mockReturnValue('anika'),
            mapLanguage: jest.fn().mockReturnValue('en'),
          },
        },
        {
          provide: ConversationService,
          useValue: {
            generateResponse: jest.fn().mockResolvedValue({
              answer: 'We are open Monday to Friday from 9 AM to 6 PM.',
              source: 'document',
              chunksUsed: 2,
            }),
          },
        },
      ],
    }).compile();

    service = module.get<CallsService>(CallsService);
    configService = module.get<ConfigService>(ConfigService);
    _supabaseService = module.get<SupabaseService>(SupabaseService);
    sarvamService = module.get<SarvamService>(SarvamService);
    deepgramService = module.get<DeepgramService>(DeepgramService);
    smallestService = module.get<SmallestService>(SmallestService);
    voiceSessionService = module.get<VoiceSessionService>(VoiceSessionService);
    _conversationService = module.get<ConversationService>(ConversationService);
    twilioService = module.get<TwilioService>(TwilioService);

    service.clearActiveCalls();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ====================================================================
  // 1. Initialization & Configuration
  // ====================================================================
  describe('Initialization & Configuration', () => {
    it('1. should be defined', () => {
      expect(service).toBeDefined();
    });

    it('2. should correctly retrieve Telnyx configuration values', () => {
      expect(service.getTelnyxApiKey()).toBe('KEY_TELNYX_TEST_123');
      expect(service.getDefaultTelnyxPhoneNumber()).toBe(mockTelnyxNumber);
      expect(service.getTelnyxConnectionId()).toBe('conn-123');
    });

    it('3. should handle missing config safely', () => {
      jest.spyOn(configService, 'get').mockReturnValue(null);
      expect(service.getTelnyxApiKey()).toBe('');
      expect(service.getDefaultTelnyxPhoneNumber()).toBe('');
    });
  });

  // ====================================================================
  // 2. Telnyx REST API Call Control Actions
  // ====================================================================
  describe('Telnyx Call Control Actions', () => {
    it('4. answerCall should send POST request to Telnyx answer endpoint', async () => {
      const result = await service.answerCall(mockCallControlId);
      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/calls/${mockCallControlId}/actions/answer`),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('5. answerCall should return false when fetch fails', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      const result = await service.answerCall(mockCallControlId);
      expect(result).toBe(false);
    });

    it('6. hangupCall should send POST request to Telnyx hangup endpoint', async () => {
      const result = await service.hangupCall(mockCallControlId);
      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/calls/${mockCallControlId}/actions/hangup`),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('7. hangupCall should handle error gracefully', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('API error'));
      const result = await service.hangupCall(mockCallControlId);
      expect(result).toBe(false);
    });

    it('8. speakText should send payload, voice, and language', async () => {
      const result = await service.speakText(mockCallControlId, {
        payload: 'Hello test',
        language: 'en-US',
      });
      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/calls/${mockCallControlId}/actions/speak`),
        expect.objectContaining({
          body: JSON.stringify({ payload: 'Hello test', voice: 'female', language: 'en-US' }),
        }),
      );
    });

    it('9. playbackAudio should send audio_url payload', async () => {
      const result = await service.playbackAudio(mockCallControlId, 'https://example.com/audio.mp3');
      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/calls/${mockCallControlId}/actions/playback_start`),
        expect.objectContaining({
          body: JSON.stringify({ audio_url: 'https://example.com/audio.mp3' }),
        }),
      );
    });
  });

  // ====================================================================
  // 3. Webhook Ingestion & Idempotency
  // ====================================================================
  describe('Webhook Ingestion & Idempotency', () => {
    it('10. should reject non-object body', async () => {
      const ack = await service.handleTelnyxWebhook(null);
      expect(ack.received).toBe(false);
      expect(ack.status).toBe('error');
    });

    it('11. should reject payload missing event_type', async () => {
      const ack = await service.handleTelnyxWebhook({ data: {} });
      expect(ack.received).toBe(false);
      expect(ack.status).toBe('error');
    });

    it('12. should acknowledge valid event receipt', async () => {
      const ack = await service.handleTelnyxWebhook({
        data: {
          id: 'evt-1',
          event_type: 'call.initiated',
          payload: { call_control_id: mockCallControlId, to: mockTelnyxNumber, from: mockCallerNumber },
        },
      });
      expect(ack.received).toBe(true);
      expect(ack.status).toBe('acknowledged');
    });

    it('13. should ignore duplicate event IDs (idempotency)', async () => {
      const payload = {
        data: {
          id: 'evt-unique-99',
          event_type: 'call.initiated',
          payload: { call_control_id: mockCallControlId, to: mockTelnyxNumber, from: mockCallerNumber },
        },
      };

      const firstAck = await service.handleTelnyxWebhook(payload);
      expect(firstAck.received).toBe(true);
      expect(firstAck.message).toBe('Webhook processed successfully');

      const secondAck = await service.handleTelnyxWebhook(payload);
      expect(secondAck.received).toBe(true);
      expect(secondAck.message).toBe('Duplicate event ignored');
    });

    it('14. should handle unknown event types safely', async () => {
      const ack = await service.handleTelnyxWebhook({
        data: {
          id: 'evt-custom',
          event_type: 'call.dtmf.received',
          payload: { call_control_id: mockCallControlId },
        },
      });
      expect(ack.received).toBe(true);
      expect(ack.status).toBe('acknowledged');
    });
  });

  // ====================================================================
  // 4. Inbound Call Handling
  // ====================================================================
  describe('Inbound Call Handling', () => {
    it('15. should reject and hang up if called number does not belong to any client', async () => {
      const hangupSpy = jest.spyOn(service, 'hangupCall');

      await service.handleCallInitiated({
        call_control_id: mockCallControlId,
        to: '+19999999999',
        from: mockCallerNumber,
      });

      expect(hangupSpy).toHaveBeenCalledWith(mockCallControlId);
      expect(service.getActiveCall(mockCallControlId)).toBeUndefined();
    });

    it('16. should reject call with insufficient balance message when balance is 0 (English)', async () => {
      const speakSpy = jest.spyOn(service, 'speakText');
      const hangupSpy = jest.spyOn(service, 'hangupCall');

      // mockOtherClientId has balance 0
      await service.handleCallInitiated({
        call_control_id: mockCallControlId,
        to: '+15559990000',
        from: mockCallerNumber,
      });

      expect(speakSpy).toHaveBeenCalledWith(
        mockCallControlId,
        expect.objectContaining({ payload: CALL_MESSAGES.INSUFFICIENT_BALANCE_HI }),
      );
      expect(hangupSpy).toHaveBeenCalledWith(mockCallControlId);
      expect(service.getActiveCall(mockCallControlId)).toBeUndefined();
    });

    it('17. should answer call, create DB record and voice session if balance > 0', async () => {
      const answerSpy = jest.spyOn(service, 'answerCall');

      await service.handleCallInitiated({
        call_control_id: mockCallControlId,
        to: mockTelnyxNumber,
        from: mockCallerNumber,
      });

      expect(answerSpy).toHaveBeenCalledWith(mockCallControlId);
      expect(mockCallsDb.length).toBe(1);
      expect(mockCallsDb[0].client_id).toBe(mockClientId);
      expect(mockCallsDb[0].direction).toBe('inbound');
      expect(mockCallsDb[0].status).toBe('in_progress');

      // Verify VoiceSession
      const session = voiceSessionService.getSession(mockCallControlId);
      expect(session).toBeDefined();
      expect(session?.clientId).toBe(mockClientId);

      // Verify Active Call map
      const active = service.getActiveCall(mockCallControlId);
      expect(active).toBeDefined();
      expect(active?.clientId).toBe(mockClientId);
    });

    it('18. should match phone number without leading +', async () => {
      await service.handleCallInitiated({
        call_control_id: 'ctrl-no-plus',
        to: '15551234567', // without +
        from: mockCallerNumber,
      });

      expect(service.getActiveCall('ctrl-no-plus')).toBeDefined();
    });
  });

  // ====================================================================
  // 5. Call Answered Event
  // ====================================================================
  describe('Call Answered Event', () => {
    it('19. should synthesize English greeting via Smallest.ai TTS, playback audio, and record in transcript', async () => {
      const playbackSpy = jest.spyOn(service, 'playbackAudio');
      const speakSpy = jest.spyOn(service, 'speakText');

      await service.handleCallInitiated({
        call_control_id: mockCallControlId,
        to: mockTelnyxNumber,
        from: mockCallerNumber,
      });

      await service.handleCallAnswered({ call_control_id: mockCallControlId });

      expect(smallestService.textToSpeech).toHaveBeenCalledWith(
        CALL_MESSAGES.GREETING_EN,
        'en',
      );
      expect(playbackSpy).toHaveBeenCalledWith(
        mockCallControlId,
        expect.stringMatching(/\/voice\/audio\/[0-9a-f-]+\.wav$/),
      );
      expect(speakSpy).not.toHaveBeenCalled();

      const active = service.getActiveCall(mockCallControlId);
      expect(active?.transcript.length).toBe(1);
      expect(active?.transcript[0].source).toBe('greeting');
    });

    it('20. should speak Hindi greeting via Smallest.ai TTS if client agent language is Hindi', async () => {
      mockProfilesDb[mockClientId].agent_language = 'Hindi';
      const playbackSpy = jest.spyOn(service, 'playbackAudio');

      await service.handleCallInitiated({
        call_control_id: mockCallControlId,
        to: mockTelnyxNumber,
        from: mockCallerNumber,
      });

      await service.handleCallAnswered({ call_control_id: mockCallControlId });

      expect(smallestService.textToSpeech).toHaveBeenCalledWith(
        CALL_MESSAGES.GREETING_HI,
        'hi',
      );
      expect(playbackSpy).toHaveBeenCalledWith(
        mockCallControlId,
        expect.stringMatching(/\/voice\/audio\/[0-9a-f-]+\.wav$/),
      );
    });

    it('21. should ignore call.answered if callControlId is not active', async () => {
      const speakSpy = jest.spyOn(service, 'speakText');
      await service.handleCallAnswered({ call_control_id: 'unknown-id' });
      expect(speakSpy).not.toHaveBeenCalled();
    });
  });

  // ====================================================================
  // 6. Call Hangup & Atomic Minute Deduction
  // ====================================================================
  describe('Call Hangup & Atomic Billing', () => {
    it('22. should calculate duration, deduct minutes atomically, and update DB call record', async () => {
      await service.handleCallInitiated({
        call_control_id: mockCallControlId,
        to: mockTelnyxNumber,
        from: mockCallerNumber,
      });

      const active = service.getActiveCall(mockCallControlId)!;
      // Simulate 125 seconds elapsed (3 billable minutes)
      active.startedAt = new Date(Date.now() - 125 * 1000);

      const initialBalance = mockProfilesDb[mockClientId].token_balance;

      await service.handleCallHangup({ call_control_id: mockCallControlId });

      // Check balance deduction
      expect(mockProfilesDb[mockClientId].token_balance).toBe(initialBalance - 3);

      // Check DB call record update
      expect(mockCallsDb[0].status).toBe('completed');
      expect(mockCallsDb[0].duration_seconds).toBeGreaterThanOrEqual(124);
      expect(mockCallsDb[0].minutes_used).toBe(3);

      // Verify cleanup
      expect(service.getActiveCall(mockCallControlId)).toBeUndefined();
      expect(voiceSessionService.getSession(mockCallControlId)).toBeNull();
    });

    it('23. should handle 0 duration calls without deducting minutes', async () => {
      await service.handleCallInitiated({
        call_control_id: mockCallControlId,
        to: mockTelnyxNumber,
        from: mockCallerNumber,
      });

      const active = service.getActiveCall(mockCallControlId)!;
      active.startedAt = new Date(); // 0s duration

      const initialBalance = mockProfilesDb[mockClientId].token_balance;
      await service.handleCallHangup({ call_control_id: mockCallControlId });

      expect(mockProfilesDb[mockClientId].token_balance).toBe(initialBalance);
    });

    it('24. should handle hangup on unknown callControlId gracefully', async () => {
      await expect(
        service.handleCallHangup({ call_control_id: 'non-existent' }),
      ).resolves.not.toThrow();
    });
  });

  // ====================================================================
  // 7. Conversation Turn & Utterance Processing
  // ====================================================================
  describe('Conversation Turn & Utterance Processing', () => {
    beforeEach(async () => {
      await service.handleCallInitiated({
        call_control_id: mockCallControlId,
        to: mockTelnyxNumber,
        from: mockCallerNumber,
      });
    });

    it('25. should return error if session is not found', async () => {
      const res = await service.processCallerUtterance('invalid-ctrl', { transcript: 'Hi' });
      expect(res.hangup).toBe(true);
      expect(res.responseText).toBe('Session not found');
    });

    it('26. should terminate call if max 10-minute limit is reached', async () => {
      const active = service.getActiveCall(mockCallControlId)!;
      // Simulate 605 seconds elapsed (exceeds 600s limit)
      active.startedAt = new Date(Date.now() - (MAX_CALL_DURATION_SECONDS + 5) * 1000);

      const res = await service.processCallerUtterance(mockCallControlId, { transcript: 'Hello?' });
      expect(res.hangup).toBe(true);
      expect(res.source).toBe('limit');
      expect(res.responseText).toBe(CALL_MESSAGES.MAX_DURATION_EN);
    });

    it('27. should terminate call in Hindi if Hindi session exceeds 10-minute limit', async () => {
      const active = service.getActiveCall(mockCallControlId)!;
      active.language = 'hindi';
      active.startedAt = new Date(Date.now() - (MAX_CALL_DURATION_SECONDS + 5) * 1000);

      const res = await service.processCallerUtterance(mockCallControlId, { transcript: 'नमस्ते' });
      expect(res.hangup).toBe(true);
      expect(res.responseText).toBe(CALL_MESSAGES.MAX_DURATION_HI);
    });

    it('28. should transcribe audio buffer via Deepgram STT', async () => {
      const mockAudio = Buffer.from('audio-wave-bytes');
      const res = await service.processCallerUtterance(mockCallControlId, {
        audioBuffer: mockAudio,
      });

      expect(deepgramService.transcribeAudio).toHaveBeenCalledWith(mockAudio, 'english');
      expect(res.hangup).toBe(false);
      expect(res.source).toBe('document');
    });

    it('29. should prompt caller on 3 consecutive empty STTs (English)', async () => {
      // 1st empty
      await service.processCallerUtterance(mockCallControlId, { transcript: '' });
      // 2nd empty
      await service.processCallerUtterance(mockCallControlId, { transcript: '' });
      // 3rd empty
      const res3 = await service.processCallerUtterance(mockCallControlId, { transcript: '' });

      expect(res3.hangup).toBe(false);
      expect(res3.responseText).toBe(CALL_MESSAGES.EMPTY_STT_PROMPT_EN);
    });

    it('30. should terminate call on 5 consecutive empty STTs (English)', async () => {
      for (let i = 0; i < 4; i++) {
        await service.processCallerUtterance(mockCallControlId, { transcript: '' });
      }
      const res5 = await service.processCallerUtterance(mockCallControlId, { transcript: '' });

      expect(res5.hangup).toBe(true);
      expect(res5.responseText).toBe(CALL_MESSAGES.EMPTY_STT_TERMINATE_EN);
    });

    it('31. should prompt and terminate in Hindi for Hindi session on empty STTs', async () => {
      const active = service.getActiveCall(mockCallControlId)!;
      active.language = 'hindi';

      for (let i = 0; i < 2; i++) {
        await service.processCallerUtterance(mockCallControlId, { transcript: '' });
      }
      const res3 = await service.processCallerUtterance(mockCallControlId, { transcript: '' });
      expect(res3.responseText).toBe(CALL_MESSAGES.EMPTY_STT_PROMPT_HI);

      await service.processCallerUtterance(mockCallControlId, { transcript: '' });
      const res5 = await service.processCallerUtterance(mockCallControlId, { transcript: '' });
      expect(res5.hangup).toBe(true);
      expect(res5.responseText).toBe(CALL_MESSAGES.EMPTY_STT_TERMINATE_HI);
    });

    it('32. should reset empty STT counter upon receiving valid speech', async () => {
      await service.processCallerUtterance(mockCallControlId, { transcript: '' });
      await service.processCallerUtterance(mockCallControlId, { transcript: '' });

      // Valid speech
      await service.processCallerUtterance(mockCallControlId, { transcript: 'Valid question' });
      const session = voiceSessionService.getSession(mockCallControlId);
      expect(session?.emptySttCount).toBe(0);
    });

    it('33. should enforce 10-turn limit and terminate on 11th turn', async () => {
      for (let i = 0; i < 10; i++) {
        const res = await service.processCallerUtterance(mockCallControlId, {
          transcript: `Question ${i + 1}`,
        });
        expect(res.hangup).toBe(false);
      }

      // 11th turn
      const res11 = await service.processCallerUtterance(mockCallControlId, {
        transcript: 'Turn 11 question',
      });
      expect(res11.hangup).toBe(true);
      expect(res11.source).toBe('limit');
      expect(res11.responseText).toBe(CALL_MESSAGES.MAX_TURNS_EN);
    });

    it('34. should append 3-minute remaining warning after 7 minutes elapsed', async () => {
      const active = service.getActiveCall(mockCallControlId)!;
      // Simulate 430 seconds elapsed (> 420s / 7 mins)
      active.startedAt = new Date(Date.now() - 430 * 1000);

      const res = await service.processCallerUtterance(mockCallControlId, {
        transcript: 'Tell me about services',
      });

      expect(res.warningGiven).toBe(true);
      expect(res.responseText).toContain(CALL_MESSAGES.WARNING_3MIN_EN);
      expect(active.warningGiven).toBe(true);
    });

    it('35. should not repeat 3-minute warning on subsequent turns', async () => {
      const active = service.getActiveCall(mockCallControlId)!;
      active.startedAt = new Date(Date.now() - 430 * 1000);

      const res1 = await service.processCallerUtterance(mockCallControlId, {
        transcript: 'Query 1',
      });
      expect(res1.warningGiven).toBe(true);

      const res2 = await service.processCallerUtterance(mockCallControlId, {
        transcript: 'Query 2',
      });
      expect(res2.warningGiven).toBe(false);
      expect(res2.responseText).not.toContain(CALL_MESSAGES.WARNING_3MIN_EN);
    });

    it('36. should synthesize audio via Smallest.ai Lightning V3 TTS and deliver to Telnyx via playback_start', async () => {
      const playbackSpy = jest.spyOn(service, 'playbackAudio');
      const speakSpy = jest.spyOn(service, 'speakText');

      const res = await service.processCallerUtterance(mockCallControlId, {
        transcript: 'When are you open?',
      });

      // 1. Smallest.ai TTS must be called
      expect(smallestService.textToSpeech).toHaveBeenCalledWith(
        expect.stringContaining('open Monday to Friday'),
        'en',
      );
      expect(res.responseAudio).toBeDefined();

      // 2. Playback of generated audio URL must be triggered via Telnyx playback_start
      expect(playbackSpy).toHaveBeenCalledWith(
        mockCallControlId,
        expect.stringMatching(/\/voice\/audio\/[0-9a-f-]+\.wav$/),
      );

      // 3. Telnyx speakText must NOT be called on the normal successful path
      expect(speakSpy).not.toHaveBeenCalled();

      // 4. Verify transient audio can be retrieved by ID
      const audioUrl = playbackSpy.mock.calls[0][1];
      const audioIdMatch = audioUrl.match(/\/voice\/audio\/([0-9a-f-]+)\.wav$/);
      expect(audioIdMatch).toBeTruthy();
      const storedBuffer = service.getTransientAudio(audioIdMatch![1]);
      expect(storedBuffer).toEqual(Buffer.from('mock-audio-data'));

      const active = service.getActiveCall(mockCallControlId)!;
      expect(active.transcript.some((t) => t.role === 'user')).toBe(true);
      expect(active.transcript.some((t) => t.role === 'assistant')).toBe(true);
    });

    it('37. should fallback to Sarvam Bulbul v3 TTS if Smallest.ai TTS synthesis fails', async () => {
      (smallestService.textToSpeech as jest.Mock).mockRejectedValueOnce(
        new Error('Smallest.ai service unavailable'),
      );
      const playbackSpy = jest.spyOn(service, 'playbackAudio');
      const speakSpy = jest.spyOn(service, 'speakText');

      const res = await service.processCallerUtterance(mockCallControlId, {
        transcript: 'Test fallback to Sarvam TTS',
      });

      // Sarvam TTS fallback must be called
      expect(sarvamService.textToSpeech).toHaveBeenCalledWith(
        expect.any(String),
        'en-IN',
      );
      expect(playbackSpy).toHaveBeenCalled();
      expect(speakSpy).not.toHaveBeenCalled();
      expect(res.responseAudio).toBeDefined();
    });

    it('37a. should fallback to Telnyx speakText ONLY if both Smallest and Sarvam TTS fail', async () => {
      (smallestService.textToSpeech as jest.Mock).mockRejectedValueOnce(
        new Error('Smallest down'),
      );
      (sarvamService.textToSpeech as jest.Mock).mockRejectedValueOnce(
        new Error('Sarvam down'),
      );
      const speakSpy = jest.spyOn(service, 'speakText');
      const playbackSpy = jest.spyOn(service, 'playbackAudio');

      const res = await service.processCallerUtterance(mockCallControlId, {
        transcript: 'Test total TTS fallback',
      });

      expect(playbackSpy).not.toHaveBeenCalled();
      expect(speakSpy).toHaveBeenCalledWith(
        mockCallControlId,
        expect.objectContaining({ payload: expect.any(String) }),
      );
      expect(res.responseText).toBeDefined();
    });

    it('37b. should process incoming caller audio from Telnyx webhook (call.gather.ended)', async () => {
      const processSpy = jest.spyOn(service, 'processCallerUtterance');

      await service.handleTelnyxWebhook({
        data: {
          id: 'evt-audio-gather',
          event_type: 'call.gather.ended',
          payload: {
            call_control_id: mockCallControlId,
            speech: 'How do I reach customer support?',
          },
        },
      });

      expect(processSpy).toHaveBeenCalledWith(
        mockCallControlId,
        expect.objectContaining({
          transcript: 'How do I reach customer support?',
        }),
      );
    });
  });

  // ====================================================================
  // 8. Outbound Calling
  // ====================================================================
  describe('Outbound Calling', () => {
    it('38. should throw InvalidPhoneNumberException for invalid destination', async () => {
      await expect(
        service.initiateOutboundCall(mockClientId, { to: 'invalid-num' }),
      ).rejects.toThrow(InvalidPhoneNumberException);
    });

    it('39. should throw InsufficientBalanceException if client has 0 balance', async () => {
      await expect(
        service.initiateOutboundCall(mockOtherClientId, { to: '+15551234567' }),
      ).rejects.toThrow(InsufficientBalanceException);
    });

    it('40. should successfully initiate outbound call and record in database', async () => {
      const res = await service.initiateOutboundCall(mockClientId, {
        to: '+15558887777',
      });

      expect(res.direction).toBe('outbound');
      expect(res.status).toBe('in_progress');
      expect(res.calledNumber).toBe('+15558887777');
      expect(res.callerNumber).toBe(mockTelnyxNumber);

      expect(mockCallsDb.some((c) => c.direction === 'outbound')).toBe(true);
    });

    it('41. should handle Telephony API failure and throw TelnyxApiException', async () => {
      (twilioService.makeOutboundCall as jest.Mock).mockRejectedValueOnce(
        new Error('Twilio outbound call failure'),
      );
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        new Response('Invalid destination', { status: 400 }),
      );

      await expect(
        service.initiateOutboundCall(mockClientId, { to: '+15558887777' }),
      ).rejects.toThrow(TelnyxApiException);
    });
  });

  // ====================================================================
  // 9. Call History & Retrieval (Tenant-Isolated)
  // ====================================================================
  describe('Call History & Retrieval', () => {
    beforeEach(() => {
      mockCallsDb = [
        {
          id: 'call-1',
          client_id: mockClientId,
          direction: 'inbound',
          caller_number: '+15551111111',
          called_number: mockTelnyxNumber,
          status: 'completed',
          duration_seconds: 120,
          minutes_used: 2,
          created_at: new Date().toISOString(),
        },
        {
          id: 'call-2',
          client_id: mockOtherClientId,
          direction: 'inbound',
          caller_number: '+15552222222',
          called_number: '+15559990000',
          status: 'completed',
          duration_seconds: 60,
          minutes_used: 1,
          created_at: new Date().toISOString(),
        },
      ];
    });

    it('42. listCalls should strictly isolate calls for the requesting client', async () => {
      const res = await service.listCalls(mockClientId);
      expect(res.calls.length).toBe(1);
      expect(res.calls[0].id).toBe('call-1');
      expect(res.total).toBe(1);
    });

    it('43. getCallById should return call record for owning client', async () => {
      const call = await service.getCallById(mockClientId, 'call-1');
      expect(call.id).toBe('call-1');
      expect(call.client_id).toBe(mockClientId);
    });

    it('44. getCallById should throw CallNotFoundException if call does not exist', async () => {
      await expect(service.getCallById(mockClientId, 'non-existent')).rejects.toThrow(
        CallNotFoundException,
      );
    });

    it('45. getCallById should throw UnauthorizedCallAccessException for cross-tenant call', async () => {
      // call-2 belongs to mockOtherClientId
      await expect(service.getCallById(mockClientId, 'call-2')).rejects.toThrow(
        UnauthorizedCallAccessException,
      );
    });
  });
});
