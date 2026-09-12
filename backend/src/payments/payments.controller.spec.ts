import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let paymentsService: jest.Mocked<Partial<PaymentsService>>;
  let supabaseAuthGetUser: jest.Mock;

  beforeEach(async () => {
    supabaseAuthGetUser = jest.fn();

    const mockSupabaseClient = {
      auth: {
        getUser: supabaseAuthGetUser,
      },
    };

    const mockSupabaseService = {
      getClient: jest.fn().mockReturnValue(mockSupabaseClient),
    };

    paymentsService = {
      createPaymentRequest: jest.fn(),
      getClientPaymentHistory: jest.fn(),
      getClientBalance: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        {
          provide: PaymentsService,
          useValue: paymentsService,
        },
        {
          provide: SupabaseService,
          useValue: mockSupabaseService,
        },
      ],
    }).compile();

    controller = module.get<PaymentsController>(PaymentsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveAuthenticatedClientId', () => {
    it('Scenario 14: resolves client ID from req.user.id if already set by guard', async () => {
      const mockReq = {
        user: { id: 'guard-client-123' },
        headers: {},
      } as unknown as Request;

      const clientId = await controller.resolveAuthenticatedClientId(mockReq);
      expect(clientId).toBe('guard-client-123');
    });

    it('resolves client ID from req.user.sub if id is absent', async () => {
      const mockReq = {
        user: { sub: 'sub-client-456' },
        headers: {},
      } as unknown as Request;

      const clientId = await controller.resolveAuthenticatedClientId(mockReq);
      expect(clientId).toBe('sub-client-456');
    });

    it('resolves client ID by verifying Bearer token with Supabase Auth', async () => {
      supabaseAuthGetUser.mockResolvedValue({
        data: { user: { id: 'auth-client-789' } },
        error: null,
      });

      const mockReq = {
        headers: {
          authorization: 'Bearer valid.jwt.token',
        },
      } as unknown as Request;

      const clientId = await controller.resolveAuthenticatedClientId(mockReq);
      expect(clientId).toBe('auth-client-789');
      expect(supabaseAuthGetUser).toHaveBeenCalledWith('valid.jwt.token');
    });

    it('throws UnauthorizedException when Authorization header is missing', async () => {
      const mockReq = {
        headers: {},
      } as unknown as Request;

      await expect(controller.resolveAuthenticatedClientId(mockReq)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when Bearer token is invalid or rejected by Supabase', async () => {
      supabaseAuthGetUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid JWT signature' },
      });

      const mockReq = {
        headers: {
          authorization: 'Bearer invalid.jwt.token',
        },
      } as unknown as Request;

      await expect(controller.resolveAuthenticatedClientId(mockReq)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when Bearer token throws an error', async () => {
      supabaseAuthGetUser.mockRejectedValue(new Error('Network failure'));

      const mockReq = {
        headers: {
          authorization: 'Bearer invalid.jwt.token',
        },
      } as unknown as Request;

      await expect(controller.resolveAuthenticatedClientId(mockReq)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('createPaymentRequest (POST /payments/request)', () => {
    it('strictly passes authenticated clientId and ignores any client_id in body/query', async () => {
      supabaseAuthGetUser.mockResolvedValue({
        data: { user: { id: 'legit-client-id' } },
        error: null,
      });

      const mockReq = {
        headers: {
          authorization: 'Bearer valid.jwt.token',
        },
        body: {
          client_id: 'malicious-spoofed-id', // MUST BE COMPLETELY IGNORED
        },
      } as unknown as Request;

      const dto = {
        amount: 500,
        utr_number: 'UTR123456789',
      };

      (paymentsService.createPaymentRequest as jest.Mock).mockResolvedValue({
        message: 'Payment submitted successfully. Minutes will be added within 2 hours.',
        minutes_requested: 100,
      });

      const res = await controller.createPaymentRequest(mockReq, dto as any);

      expect(res.minutes_requested).toBe(100);
      expect(paymentsService.createPaymentRequest).toHaveBeenCalledWith(
        'legit-client-id',
        dto,
      );
      expect(paymentsService.createPaymentRequest).not.toHaveBeenCalledWith(
        'malicious-spoofed-id',
        expect.anything(),
      );
    });
  });

  describe('getPaymentHistory (GET /payments/history)', () => {
    it('retrieves payment history for the authenticated client only', async () => {
      supabaseAuthGetUser.mockResolvedValue({
        data: { user: { id: 'client-user-123' } },
        error: null,
      });

      const mockReq = {
        headers: {
          authorization: 'Bearer valid.jwt.token',
        },
      } as unknown as Request;

      (paymentsService.getClientPaymentHistory as jest.Mock).mockResolvedValue({
        payments: [
          {
            id: 'pay-1',
            client_id: 'client-user-123',
            amount: 500,
            minutes_requested: 100,
            utr_number: 'UTR123',
            status: 'pending',
          },
        ],
      });

      const res = await controller.getPaymentHistory(mockReq);

      expect(res.payments).toHaveLength(1);
      expect(paymentsService.getClientPaymentHistory).toHaveBeenCalledWith('client-user-123');
    });
  });

  describe('getBalance (GET /payments/balance)', () => {
    it('retrieves balance for the authenticated client', async () => {
      supabaseAuthGetUser.mockResolvedValue({
        data: { user: { id: 'client-user-123' } },
        error: null,
      });

      const mockReq = {
        headers: {
          authorization: 'Bearer valid.jwt.token',
        },
      } as unknown as Request;

      (paymentsService.getClientBalance as jest.Mock).mockResolvedValue({
        balance: 60,
        label: 'minutes',
      });

      const res = await controller.getBalance(mockReq);

      expect(res).toEqual({ balance: 60, label: 'minutes' });
      expect(paymentsService.getClientBalance).toHaveBeenCalledWith('client-user-123');
    });
  });
});
