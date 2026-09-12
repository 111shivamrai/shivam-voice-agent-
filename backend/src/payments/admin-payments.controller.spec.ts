import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AdminPaymentsController } from './admin-payments.controller.js';
import { PaymentsService } from './payments.service.js';

describe('AdminPaymentsController', () => {
  let controller: AdminPaymentsController;
  let paymentsService: jest.Mocked<Partial<PaymentsService>>;
  let configService: jest.Mocked<Partial<ConfigService>>;

  const ADMIN_PASS = 'TestAdminSecret123!';

  beforeEach(async () => {
    paymentsService = {
      getPendingPayments: jest.fn(),
      getAllPayments: jest.fn(),
      getAdminStats: jest.fn(),
      approvePayment: jest.fn(),
      rejectPayment: jest.fn(),
    };

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'ADMIN_PASSWORD') {
          return ADMIN_PASS;
        }
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminPaymentsController],
      providers: [
        {
          provide: PaymentsService,
          useValue: paymentsService,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    }).compile();

    controller = module.get<AdminPaymentsController>(AdminPaymentsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Admin Authentication Verification (Scenarios 20, 21, 22, 23)
  // =========================================================================
  describe('Admin Authentication (validateAdmin)', () => {
    it('Scenario 20: verifyAdmin succeeds with correct password', () => {
      const mockReq = {
        headers: {
          'x-admin-password': ADMIN_PASS,
        },
      } as unknown as Request;

      const res = controller.verifyAdmin(mockReq);
      expect(res).toEqual({
        success: true,
        message: 'Admin authenticated',
      });
    });

    it('Scenario 21: verifyAdmin fails with wrong password (401)', () => {
      const mockReq = {
        headers: {
          'x-admin-password': 'WrongPassword!',
        },
      } as unknown as Request;

      expect(() => controller.verifyAdmin(mockReq)).toThrow(UnauthorizedException);
    });

    it('Scenario 22: verifyAdmin fails with missing password (401)', () => {
      const mockReq = {
        headers: {},
      } as unknown as Request;

      expect(() => controller.verifyAdmin(mockReq)).toThrow(UnauthorizedException);
    });

    it('Scenario 23: all admin endpoints reject unauthenticated requests (401)', async () => {
      const unauthReq = {
        headers: {},
      } as unknown as Request;

      expect(() => controller.verifyAdmin(unauthReq)).toThrow(UnauthorizedException);
      await expect(controller.getPendingPayments(unauthReq)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(controller.getAllPayments(unauthReq)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(controller.getStats(unauthReq)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(controller.approvePayment('id-1', unauthReq)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(
        controller.rejectPayment('id-1', {} as any, unauthReq),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // =========================================================================
  // Admin Endpoints Delegation
  // =========================================================================
  describe('Admin Endpoints', () => {
    const validReq = {
      headers: {
        'x-admin-password': ADMIN_PASS,
      },
    } as unknown as Request;

    it('GET /admin/payments/pending delegates to service.getPendingPayments', async () => {
      (paymentsService.getPendingPayments as jest.Mock).mockResolvedValue({
        payments: [],
        count: 0,
      });

      const res = await controller.getPendingPayments(validReq);
      expect(res).toEqual({ payments: [], count: 0 });
      expect(paymentsService.getPendingPayments).toHaveBeenCalledTimes(1);
    });

    it('GET /admin/payments delegates to service.getAllPayments', async () => {
      (paymentsService.getAllPayments as jest.Mock).mockResolvedValue({
        payments: [],
        count: 0,
      });

      const res = await controller.getAllPayments(validReq);
      expect(res).toEqual({ payments: [], count: 0 });
      expect(paymentsService.getAllPayments).toHaveBeenCalledTimes(1);
    });

    it('GET /admin/stats delegates to service.getAdminStats', async () => {
      const mockStats = {
        pending_payment_count: 1,
        total_payment_count: 5,
        approved_payment_count: 3,
        rejected_payment_count: 1,
        total_approved_amount: 1500,
        total_approved_minutes: 300,
      };
      (paymentsService.getAdminStats as jest.Mock).mockResolvedValue(mockStats);

      const res = await controller.getStats(validReq);
      expect(res).toEqual(mockStats);
      expect(paymentsService.getAdminStats).toHaveBeenCalledTimes(1);
    });

    it('POST /admin/payments/:id/approve delegates to service.approvePayment', async () => {
      (paymentsService.approvePayment as jest.Mock).mockResolvedValue({
        message: 'Approved. Minutes added to client account.',
        minutes_added: 100,
      });

      const res = await controller.approvePayment('pay-123', validReq);
      expect(res.minutes_added).toBe(100);
      expect(paymentsService.approvePayment).toHaveBeenCalledWith('pay-123');
    });

    it('POST /admin/payments/:id/reject delegates to service.rejectPayment', async () => {
      (paymentsService.rejectPayment as jest.Mock).mockResolvedValue({
        message: 'Payment rejected.',
      });

      const res = await controller.rejectPayment(
        'pay-123',
        { admin_note: 'Fake receipt' },
        validReq,
      );
      expect(res).toEqual({ message: 'Payment rejected.' });
      expect(paymentsService.rejectPayment).toHaveBeenCalledWith(
        'pay-123',
        'Fake receipt',
      );
    });
  });
});
