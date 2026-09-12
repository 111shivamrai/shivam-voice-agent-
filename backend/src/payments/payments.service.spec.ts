import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let mockSupabaseClient: any;

  beforeEach(async () => {
    mockSupabaseClient = {
      from: jest.fn(),
    };

    const mockSupabaseService = {
      getAdminClient: jest.fn().mockReturnValue(mockSupabaseClient),
      getClient: jest.fn().mockReturnValue(mockSupabaseClient),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: SupabaseService,
          useValue: mockSupabaseService,
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. Calculation & Formula Tests (Scenarios 1 - 7)
  // =========================================================================
  describe('calculateMinutes', () => {
    it('Scenario 1: rejects amount below 100 with BadRequestException', () => {
      expect(() => service.calculateMinutes(99)).toThrow(BadRequestException);
      expect(() => service.calculateMinutes(0)).toThrow(BadRequestException);
      expect(() => service.calculateMinutes(-50)).toThrow(BadRequestException);
    });

    it('Scenario 2: rejects non-integer amounts with BadRequestException', () => {
      expect(() => service.calculateMinutes(100.5)).toThrow(BadRequestException);
      expect(() => service.calculateMinutes(199.99)).toThrow(BadRequestException);
      expect(() => service.calculateMinutes(NaN as any)).toThrow(BadRequestException);
    });

    it('Scenario 3: calculates correct minutes using Math.floor(amount / 5)', () => {
      expect(service.calculateMinutes(123)).toBe(Math.floor(123 / 5)); // 24
      expect(service.calculateMinutes(250)).toBe(50);
      expect(service.calculateMinutes(1000)).toBe(200);
    });

    it('Scenario 4: amount 100 -> exactly 20 minutes', () => {
      expect(service.calculateMinutes(100)).toBe(20);
    });

    it('Scenario 5: amount 105 -> exactly 21 minutes', () => {
      expect(service.calculateMinutes(105)).toBe(21);
    });

    it('Scenario 6: amount 499 -> 99 minutes', () => {
      expect(service.calculateMinutes(499)).toBe(99);
    });

    it('Scenario 7: amount 500 -> 100 minutes', () => {
      expect(service.calculateMinutes(500)).toBe(100);
    });
  });

  // =========================================================================
  // 2. UTR Validation Tests (Scenarios 8 - 12)
  // =========================================================================
  describe('validateUtr', () => {
    it('Scenario 8: rejects missing or empty UTR with BadRequestException', () => {
      expect(() => service.validateUtr('')).toThrow(BadRequestException);
      expect(() => service.validateUtr(null as any)).toThrow(BadRequestException);
      expect(() => service.validateUtr(undefined as any)).toThrow(BadRequestException);
    });

    it('Scenario 9: rejects UTR shorter than 8 characters with BadRequestException', () => {
      expect(() => service.validateUtr('1234567')).toThrow(BadRequestException);
      expect(() => service.validateUtr('ABC')).toThrow(BadRequestException);
    });

    it('Scenario 10: rejects UTR longer than 25 characters with BadRequestException', () => {
      const longUtr = 'A'.repeat(26);
      expect(() => service.validateUtr(longUtr)).toThrow(BadRequestException);
    });

    it('Scenario 11: rejects UTR with spaces or special characters with BadRequestException', () => {
      expect(() => service.validateUtr('UTR 12345678')).toThrow(BadRequestException);
      expect(() => service.validateUtr('UTR-12345678')).toThrow(BadRequestException);
      expect(() => service.validateUtr('UTR@12345678')).toThrow(BadRequestException);
      expect(() => service.validateUtr('UTR#12345678!')).toThrow(BadRequestException);
    });

    it('Scenario 12: accepts valid alphanumeric UTR and trims whitespace', () => {
      expect(service.validateUtr('  UTR12345678  ')).toBe('UTR12345678');
      expect(service.validateUtr('123456789012')).toBe('123456789012');
      expect(service.validateUtr('TXN20260912ABCDEF')).toBe('TXN20260912ABCDEF');
    });
  });

  // =========================================================================
  // 3. Create Payment Request Tests (Scenario 13 & edge cases)
  // =========================================================================
  describe('createPaymentRequest', () => {
    it('Scenario 13: inserts payment request with pending status and calculated minutes', async () => {
      const insertMock = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'req-123', minutes_requested: 100 },
            error: null,
          }),
        }),
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'payment_requests') {
          return { insert: insertMock };
        }
        return {};
      });

      const result = await service.createPaymentRequest('client-uuid-1', {
        amount: 500,
        utr_number: 'UTR123456789',
      });

      expect(result).toEqual({
        message: 'Payment submitted successfully. Minutes will be added within 2 hours.',
        minutes_requested: 100,
      });

      expect(insertMock).toHaveBeenCalledWith({
        client_id: 'client-uuid-1',
        amount: 500,
        minutes_requested: 100,
        utr_number: 'UTR123456789',
        status: 'pending',
      });
    });

    it('throws InternalServerErrorException when database insert fails', async () => {
      mockSupabaseClient.from.mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: { message: 'DB connection error' },
            }),
          }),
        }),
      });

      await expect(
        service.createPaymentRequest('client-uuid-1', {
          amount: 500,
          utr_number: 'UTR123456789',
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // =========================================================================
  // 4. Client Payment History Tests (Scenarios 15, 16)
  // =========================================================================
  describe('getClientPaymentHistory', () => {
    it('Scenario 15 & 16: returns client payment history filtered by client_id and ordered by created_at DESC', async () => {
      const mockPayments = [
        {
          id: 'pay-2',
          client_id: 'client-uuid-1',
          amount: 500,
          minutes_requested: 100,
          utr_number: 'UTR22222222',
          status: 'pending',
          created_at: '2026-09-12T12:00:00Z',
        },
        {
          id: 'pay-1',
          client_id: 'client-uuid-1',
          amount: 250,
          minutes_requested: 50,
          utr_number: 'UTR11111111',
          status: 'approved',
          created_at: '2026-09-11T12:00:00Z',
        },
      ];

      const orderMock = jest.fn().mockResolvedValue({ data: mockPayments, error: null });
      const eqMock = jest.fn().mockReturnValue({ order: orderMock });
      const selectMock = jest.fn().mockReturnValue({ eq: eqMock });

      mockSupabaseClient.from.mockReturnValue({ select: selectMock });

      const res = await service.getClientPaymentHistory('client-uuid-1');

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('payment_requests');
      expect(eqMock).toHaveBeenCalledWith('client_id', 'client-uuid-1');
      expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(res.payments).toHaveLength(2);
      expect(res.payments[0].id).toBe('pay-2');
    });

    it('throws InternalServerErrorException when history query fails', async () => {
      mockSupabaseClient.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: null, error: { message: 'timeout' } }),
          }),
        }),
      });

      await expect(service.getClientPaymentHistory('client-uuid-1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // =========================================================================
  // 5. Client Balance Tests (Scenarios 17, 18, 19)
  // =========================================================================
  describe('getClientBalance', () => {
    it('Scenario 17: returns profiles.token_balance as minutes balance', async () => {
      mockSupabaseClient.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: { token_balance: 150 },
              error: null,
            }),
          }),
        }),
      });

      const res = await service.getClientBalance('client-uuid-1');
      expect(res).toEqual({ balance: 150, label: 'minutes' });
    });

    it('Scenario 18: returns 0 if profile has null/zero balance', async () => {
      mockSupabaseClient.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: { token_balance: null },
              error: null,
            }),
          }),
        }),
      });

      const res = await service.getClientBalance('client-uuid-1');
      expect(res).toEqual({ balance: 0, label: 'minutes' });
    });

    it('Scenario 19: non-existent client returns NotFoundException', async () => {
      mockSupabaseClient.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          }),
        }),
      });

      await expect(service.getClientBalance('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // 6. Admin Payment Listing & Stats Tests (Scenarios 24, 25, 26)
  // =========================================================================
  describe('Admin Listing and Stats', () => {
    it('Scenario 24: getPendingPayments returns pending requests ordered by created_at ASC with profile enrichment', async () => {
      const pendingRows = [
        {
          id: 'pay-1',
          client_id: 'client-1',
          amount: 500,
          minutes_requested: 100,
          utr_number: 'UTR111',
          status: 'pending',
          created_at: '2026-09-10T10:00:00Z',
        },
      ];

      const profileRows = [
        { id: 'client-1', email: 'user1@example.com', business_name: 'Biz 1' },
      ];

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'payment_requests') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                order: jest.fn().mockResolvedValue({ data: pendingRows, error: null }),
              }),
            }),
          };
        }
        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({ data: profileRows, error: null }),
            }),
          };
        }
        return {};
      });

      const res = await service.getPendingPayments();
      expect(res.count).toBe(1);
      expect(res.payments[0].client_email).toBe('user1@example.com');
      expect(res.payments[0].client_business_name).toBe('Biz 1');
    });

    it('Scenario 25: getAllPayments returns all requests ordered by created_at DESC with profile enrichment', async () => {
      const allRows = [
        {
          id: 'pay-2',
          client_id: 'client-2',
          amount: 1000,
          minutes_requested: 200,
          utr_number: 'UTR222',
          status: 'approved',
          created_at: '2026-09-12T10:00:00Z',
        },
        {
          id: 'pay-1',
          client_id: 'client-1',
          amount: 500,
          minutes_requested: 100,
          utr_number: 'UTR111',
          status: 'rejected',
          created_at: '2026-09-10T10:00:00Z',
        },
      ];

      const profileRows = [
        { id: 'client-1', email: 'user1@example.com', business_name: 'Biz 1' },
        { id: 'client-2', email: 'user2@example.com', business_name: 'Biz 2' },
      ];

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'payment_requests') {
          return {
            select: jest.fn().mockReturnValue({
              order: jest.fn().mockResolvedValue({ data: allRows, error: null }),
            }),
          };
        }
        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({ data: profileRows, error: null }),
            }),
          };
        }
        return {};
      });

      const res = await service.getAllPayments();
      expect(res.count).toBe(2);
      expect(res.payments[0].id).toBe('pay-2');
      expect(res.payments[0].client_email).toBe('user2@example.com');
    });

    it('Scenario 26: getAdminStats calculates correct counts and sums', async () => {
      const rawRows = [
        { status: 'pending', amount: 500, minutes_requested: 100 },
        { status: 'pending', amount: 250, minutes_requested: 50 },
        { status: 'approved', amount: 1000, minutes_requested: 200 },
        { status: 'approved', amount: 500, minutes_requested: 100 },
        { status: 'rejected', amount: 300, minutes_requested: 60 },
      ];

      mockSupabaseClient.from.mockReturnValue({
        select: jest.fn().mockResolvedValue({ data: rawRows, error: null }),
      });

      const stats = await service.getAdminStats();
      expect(stats.total_payment_count).toBe(5);
      expect(stats.pending_payment_count).toBe(2);
      expect(stats.approved_payment_count).toBe(2);
      expect(stats.rejected_payment_count).toBe(1);
      expect(stats.total_approved_amount).toBe(1500);
      expect(stats.total_approved_minutes).toBe(300);
    });
  });

  // =========================================================================
  // 7. Approve Payment Tests (Scenarios 27, 28, 29)
  // =========================================================================
  describe('approvePayment', () => {
    it('Scenario 27 & 28: transitions status to approved and credits minutes to profiles.token_balance', async () => {
      const existingRecord = {
        id: 'pay-100',
        client_id: 'client-1',
        minutes_requested: 100,
        status: 'pending',
      };

      const updatedRecord = {
        id: 'pay-100',
        client_id: 'client-1',
        minutes_requested: 100,
        status: 'approved',
      };

      const profileRecord = {
        token_balance: 45,
      };

      const updateProfileMock = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'payment_requests') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: existingRecord,
                  error: null,
                }),
              }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  select: jest.fn().mockReturnValue({
                    maybeSingle: jest.fn().mockResolvedValue({
                      data: updatedRecord,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: profileRecord,
                  error: null,
                }),
              }),
            }),
            update: updateProfileMock,
          };
        }
        return {};
      });

      const res = await service.approvePayment('pay-100', 'Verified on bank portal');

      expect(res).toEqual({
        message: 'Approved. Minutes added to client account.',
        minutes_added: 100,
      });

      // Verification of atomic balance credit: 45 + 100 = 145
      expect(updateProfileMock).toHaveBeenCalledWith({ token_balance: 145 });
    });

    it('Scenario 29: double approval rejected with BadRequestException when status is not pending', async () => {
      mockSupabaseClient.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: {
                id: 'pay-100',
                client_id: 'client-1',
                minutes_requested: 100,
                status: 'approved', // already approved!
              },
              error: null,
            }),
          }),
        }),
      });

      await expect(service.approvePayment('pay-100')).rejects.toThrow(BadRequestException);
      await expect(service.approvePayment('pay-100')).rejects.toThrow(
        'This payment has already been processed',
      );
    });

    it('rejects approval with NotFoundException if payment ID does not exist', async () => {
      mockSupabaseClient.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          }),
        }),
      });

      await expect(service.approvePayment('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // 8. Reject Payment Tests (Scenarios 30, 31)
  // =========================================================================
  describe('rejectPayment', () => {
    it('Scenario 30: sets status to rejected with admin note and NEVER touches profile minutes', async () => {
      const existingRecord = {
        id: 'pay-200',
        client_id: 'client-2',
        status: 'pending',
      };

      const updatedRecord = {
        id: 'pay-200',
        client_id: 'client-2',
        status: 'rejected',
      };

      const profileUpdateSpy = jest.fn();

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'payment_requests') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: existingRecord,
                  error: null,
                }),
              }),
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  select: jest.fn().mockReturnValue({
                    maybeSingle: jest.fn().mockResolvedValue({
                      data: updatedRecord,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'profiles') {
          return {
            update: profileUpdateSpy,
          };
        }
        return {};
      });

      const res = await service.rejectPayment('pay-200', 'UTR not found on bank statement');

      expect(res).toEqual({
        message: 'Payment rejected.',
      });
      // CRITICAL: profile token balance must NEVER be updated
      expect(profileUpdateSpy).not.toHaveBeenCalled();
    });

    it('Scenario 31: rejects rejecting an already processed payment (400)', async () => {
      mockSupabaseClient.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({
              data: {
                id: 'pay-200',
                client_id: 'client-2',
                status: 'rejected', // already rejected!
              },
              error: null,
            }),
          }),
        }),
      });

      await expect(service.rejectPayment('pay-200')).rejects.toThrow(BadRequestException);
      await expect(service.rejectPayment('pay-200')).rejects.toThrow(
        'This payment has already been processed',
      );
    });
  });
});
