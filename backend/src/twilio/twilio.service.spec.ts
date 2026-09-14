import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TwilioService } from './twilio.service.js';

describe('TwilioService', () => {
  let service: TwilioService;
  let _configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwilioService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'TWILIO_ACCOUNT_SID') return 'AC00000000000000000000000000000000';
              if (key === 'TWILIO_AUTH_TOKEN') return 'mock_twilio_auth_token';
              if (key === 'TWILIO_PHONE_NUMBER') return '+15551234567';
              if (key === 'BACKEND_URL') return 'https://voice.example.com';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<TwilioService>(TwilioService);
    _configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return default phone number', () => {
    expect(service.getDefaultPhoneNumber()).toBe('+15551234567');
  });

  it('should format stream url with wss:// scheme', () => {
    expect(service.getStreamUrl()).toBe('wss://voice.example.com/voice/stream');
  });

  it('should generate valid TwiML with Connect Stream for answerCall', () => {
    const twiml = service.answerCall('CA123456789');
    expect(twiml).toContain('<Connect>');
    expect(twiml).toContain('<Stream url="wss://voice.example.com/voice/stream">');
    expect(twiml).toContain('<Parameter name="call_control_id" value="CA123456789"/>');
    expect(twiml).toContain('</Connect>');
  });

  it('should generate valid TwiML Say and Hangup with Polly.Aditi voice for announcements', () => {
    const twiml = service.generateTwiML('Hello & Welcome');
    expect(twiml).toContain('<Say voice="Polly.Aditi">Hello &amp; Welcome</Say>');
    expect(twiml).toContain('<Hangup/>');
  });

  it('should handle hangupCall gracefully', async () => {
    // Mock client calls update
    (service as any).client = {
      calls: jest.fn().mockReturnValue({
        update: jest.fn().mockResolvedValue({ sid: 'CA123456789', status: 'completed' }),
      }),
    };

    await expect(service.hangupCall('CA123456789')).resolves.not.toThrow();
  });

  it('should handle makeOutboundCall', async () => {
    (service as any).client = {
      calls: {
        create: jest.fn().mockResolvedValue({ sid: 'CA987654321' }),
      },
    };

    const sid = await service.makeOutboundCall({
      to: '+15551234567',
      from: '+12182741874',
      webhookUrl: 'https://voice.example.com/voice/webhook',
    });

    expect(sid).toBe('CA987654321');
  });
});
