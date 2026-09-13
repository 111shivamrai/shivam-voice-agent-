import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { CallsController } from './calls.controller.js';
import { CallsService } from './calls.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';

describe('CallsController', () => {
  let controller: CallsController;
  let callsService: CallsService;

  const mockClientId = 'client-auth-123';

  const mockCallsService = {
    initiateOutboundCall: jest.fn().mockResolvedValue({
      callId: 'call-out-1',
      telnyxCallId: 'v3:call_out',
      status: 'in_progress',
      direction: 'outbound',
      callerNumber: '+15551234567',
      calledNumber: '+15559876543',
    }),
    listCalls: jest.fn().mockResolvedValue({
      calls: [],
      total: 0,
      page: 1,
      limit: 20,
    }),
    getCallById: jest.fn().mockResolvedValue({
      id: 'call-1',
      client_id: mockClientId,
      status: 'completed',
    }),
  };

  const mockSupabaseService = {
    getClient: jest.fn().mockReturnValue({
      auth: {
        getUser: jest.fn().mockImplementation(async (token: string) => {
          if (token === 'valid-token') {
            return { data: { user: { id: mockClientId } }, error: null };
          }
          return { data: null, error: new Error('Invalid token') };
        }),
      },
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CallsController],
      providers: [
        {
          provide: CallsService,
          useValue: mockCallsService,
        },
        {
          provide: SupabaseService,
          useValue: mockSupabaseService,
        },
      ],
    }).compile();

    controller = module.get<CallsController>(CallsController);
    callsService = module.get<CallsService>(CallsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('resolveAuthenticatedClientId', () => {
    it('should resolve client ID from req.user', async () => {
      const req = { user: { id: mockClientId } } as any;
      const result = await controller.resolveAuthenticatedClientId(req);
      expect(result).toBe(mockClientId);
    });

    it('should resolve client ID from Bearer token', async () => {
      const req = { headers: { authorization: 'Bearer valid-token' } } as any;
      const result = await controller.resolveAuthenticatedClientId(req);
      expect(result).toBe(mockClientId);
    });

    it('should throw UnauthorizedException when no valid credentials provided', async () => {
      const req = { headers: {} } as any;
      await expect(controller.resolveAuthenticatedClientId(req)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('Endpoints', () => {
    it('POST /voice/calls/outbound should initiate call for authenticated client', async () => {
      const req = { user: { id: mockClientId } } as any;
      const res = await controller.initiateOutboundCall(req, { to: '+15559876543' });
      expect(callsService.initiateOutboundCall).toHaveBeenCalledWith(mockClientId, {
        to: '+15559876543',
      });
      expect(res.callId).toBe('call-out-1');
    });

    it('GET /voice/calls should return paginated calls list', async () => {
      const req = { user: { id: mockClientId } } as any;
      const res = await controller.listCalls(req, '1', '10', 'completed', 'inbound');
      expect(callsService.listCalls).toHaveBeenCalledWith(mockClientId, {
        page: 1,
        limit: 10,
        status: 'completed',
        direction: 'inbound',
      });
      expect(res.calls).toEqual([]);
    });

    it('GET /voice/calls/:id should return single call record', async () => {
      const req = { user: { id: mockClientId } } as any;
      const res = await controller.getCallById(req, 'call-1');
      expect(callsService.getCallById).toHaveBeenCalledWith(mockClientId, 'call-1');
      expect(res.id).toBe('call-1');
    });
  });
});
