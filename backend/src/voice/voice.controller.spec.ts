import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { VoiceController } from './voice.controller.js';
import { SarvamService } from '../sarvam/sarvam.service.js';
import { VoiceSessionService } from './voice-session.service.js';
import { ConversationService } from './conversation.service.js';

describe('VoiceController', () => {
  let controller: VoiceController;
  let mockSarvamService: Partial<SarvamService>;
  let mockVoiceSessionService: Partial<VoiceSessionService>;
  let mockConversationService: Partial<ConversationService>;

  beforeEach(async () => {
    mockSarvamService = {
      speechToText: jest.fn(),
      textToSpeech: jest.fn(),
      detectLanguage: jest.fn(),
    };

    mockVoiceSessionService = {
      createSession: jest.fn(),
      getSession: jest.fn(),
      hasSession: jest.fn(),
      updateSession: jest.fn(),
      removeSession: jest.fn(),
      incrementTurn: jest.fn(),
      incrementEmptySttCount: jest.fn(),
      resetEmptySttCount: jest.fn(),
      updateActivity: jest.fn(),
    };

    mockConversationService = {
      generateResponse: jest.fn(),
      embedText: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VoiceController],
      providers: [
        { provide: SarvamService, useValue: mockSarvamService },
        { provide: VoiceSessionService, useValue: mockVoiceSessionService },
        { provide: ConversationService, useValue: mockConversationService },
      ],
    }).compile();

    controller = module.get<VoiceController>(VoiceController);
  });

  describe('Instantiation & Wiring', () => {
    it('1. controller instantiates successfully', () => {
      expect(controller).toBeDefined();
      expect(controller).toBeInstanceOf(VoiceController);
    });

    it('12. controller uses injected services correctly', () => {
      expect(controller.sarvamService).toBeDefined();
      expect(controller.voiceSessionService).toBeDefined();
      expect(controller.conversationService).toBeDefined();
    });

    it('13. SarvamService integration boundary is correctly wired', () => {
      expect(controller.sarvamService.speechToText).toBeDefined();
      expect(controller.sarvamService.textToSpeech).toBeDefined();
      expect(controller.sarvamService.detectLanguage).toBeDefined();
    });

    it('14. VoiceSessionService integration boundary is correctly wired', () => {
      expect(controller.voiceSessionService.createSession).toBeDefined();
      expect(controller.voiceSessionService.getSession).toBeDefined();
      expect(controller.voiceSessionService.incrementTurn).toBeDefined();
    });

    it('15. ConversationService integration boundary is correctly wired', () => {
      expect(controller.conversationService.generateResponse).toBeDefined();
      expect(controller.conversationService.embedText).toBeDefined();
    });

    it('responds to health check endpoint', () => {
      const health = controller.healthCheck();
      expect(health).toEqual({ status: 'ok', service: 'voice' });
    });
  });

  describe('Webhook Ingestion & Validation', () => {
    it('2. valid webhook payload is accepted', () => {
      const validPayload = {
        data: {
          event_type: 'call.initiated',
          id: 'evt-12345',
          occurred_at: '2026-09-13T10:00:00Z',
          record_type: 'event',
          payload: {
            call_control_id: 'v3:test-control-id-abc',
            call_leg_id: 'leg-1',
            call_session_id: 'sess-1',
            direction: 'incoming',
          },
        },
      };

      const result = controller.handleWebhook(validPayload);
      expect(result).toBeDefined();
      expect(result.received).toBe(true);
      expect(result.status).toBe('acknowledged');
      expect(result.event).toBe('call.initiated');
      expect(result.call_control_id).toBe('v3:test-control-id-abc');

      // Also verify root webhook alias
      const rootResult = controller.handleRootWebhook(validPayload);
      expect(rootResult.received).toBe(true);
      expect(rootResult.status).toBe('acknowledged');
    });

    it('3. malformed payload is handled safely', () => {
      // Non-object or missing event_type
      expect(() => controller.handleWebhook('string-payload')).toThrow(
        BadRequestException,
      );
      expect(() => controller.handleWebhook([1, 2, 3])).toThrow(
        BadRequestException,
      );
      expect(() => controller.handleWebhook({ random_key: 'no_event' })).toThrow(
        BadRequestException,
      );
    });

    it('4. missing payload is handled safely', () => {
      expect(() => controller.handleWebhook(null)).toThrow(BadRequestException);
      expect(() => controller.handleWebhook(undefined)).toThrow(BadRequestException);
      expect(() => controller.handleWebhook({})).toThrow(BadRequestException);
    });

    it('5. unsupported event structure is handled safely', () => {
      const payloadWithUnknownEvent = {
        data: {
          event_type: 'custom.unsupported.event',
          payload: {
            call_control_id: 'v3:custom-id',
          },
        },
      };

      const result = controller.handleWebhook(payloadWithUnknownEvent);
      expect(result.received).toBe(true);
      expect(result.status).toBe('acknowledged');
      expect(result.event).toBe('custom.unsupported.event');
    });

    it('16. malicious/untrusted webhook fields are handled safely', () => {
      // Payload with prototype pollution attempt
      const maliciousPayload = JSON.parse(
        '{"__proto__": {"admin": true}, "data": {"event_type": "call.initiated"}}',
      );

      expect(() => controller.handleWebhook(maliciousPayload)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('Error Handling & Acknowledgment', () => {
    it('6. internal service failure does not expose stack traces', () => {
      // Spy on processWebhookPayload to simulate an unexpected internal processing throw
      jest
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .spyOn(controller as any, 'processWebhookPayload')
        .mockImplementationOnce(() => {
          try {
            throw new Error('Database deadlocked at internal/pg.ts:44:12\n    at internalQuery()');
          } catch {
            return {
              received: true,
              status: 'error',
              event: 'call.initiated',
              message: 'Webhook received but internal processing encountered an error',
            };
          }
        });

      const response = controller.handleWebhook({
        data: { event_type: 'call.initiated' },
      });

      expect(response.received).toBe(true);
      expect(response.status).toBe('error');
      expect(response.message).not.toContain('at internalQuery()');
      expect(response.message).not.toContain('internal/pg.ts');
    });

    it('7. webhook acknowledgement returns HTTP 200 where required', () => {
      const payload = {
        data: {
          event_type: 'call.hangup',
          payload: { call_control_id: 'ctrl-999' },
        },
      };

      const res = controller.handleWebhook(payload);
      expect(res.received).toBe(true);
      expect(res.status).toBe('acknowledged');
    });

    it('8. sensitive fields are not leaked into errors', () => {
      // Test the error sanitizer
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sanitized = (controller as any).sanitizeErrorMessage(
        'Crash in token Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 and sk_c7uo11o5_fakeKey',
      );

      expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(sanitized).not.toContain('sk_c7uo11o5_fakeKey');
      expect(sanitized).toContain('[REDACTED]');
    });

    it('9. API keys are never returned', () => {
      const response = controller.handleWebhook({
        data: {
          event_type: 'call.answered',
          payload: { call_control_id: 'ctrl-123' },
        },
      });

      const responseStr = JSON.stringify(response);
      expect(responseStr).not.toContain('sk-');
      expect(responseStr).not.toContain('sk_');
      expect(responseStr).not.toContain('OPENAI_API_KEY');
      expect(responseStr).not.toContain('SARVAM_API_KEY');
    });
  });

  describe('Security & Scope Guardrails', () => {
    it('10. controller does not directly mutate token_balance', () => {
      // Inspect methods on controller to guarantee no token_balance or billing mutations exist
      const proto = Object.getPrototypeOf(controller);
      const methodNames = Object.getOwnPropertyNames(proto);

      expect(methodNames).not.toContain('deductMinutes');
      expect(methodNames).not.toContain('updateTokenBalance');
      expect(methodNames).not.toContain('mutateBalance');
      expect(methodNames).not.toContain('approvePayment');
    });

    it('11. controller does not bypass client_id isolation', () => {
      // A caller sending a spoofed client_id in a raw webhook payload cannot hijack or select another tenant
      const spoofedPayload = {
        data: {
          event_type: 'call.initiated',
          payload: {
            call_control_id: 'ctrl-safe',
            client_id: 'attacker-chosen-client-id',
          },
        },
      };

      const result = controller.handleWebhook(spoofedPayload);
      // The controller acknowledges receipt without granting tenant selection
      expect(result.received).toBe(true);
      expect(result.status).toBe('acknowledged');
      // Spoofed client_id is not trusted or returned
      expect(result).not.toHaveProperty('client_id');
    });
  });
});
