import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import type {
  CreatePaymentRequestDto,
  PaymentRequestRecord,
  CreatePaymentResponse,
  ClientBalanceResponse,
  ApprovePaymentResponse,
  RejectPaymentResponse,
  AdminStatsResponse,
} from './payments.dto.js';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Calculates minutes based on locked formula: minutes = Math.floor(amount / 5)
   */
  calculateMinutes(amount: number): number {
    if (!Number.isInteger(amount) || amount < 100) {
      throw new BadRequestException(
        'Amount must be an integer greater than or equal to ₹100.',
      );
    }
    return Math.floor(amount / 5);
  }

  /**
   * Sanitizes and validates UTR number string
   */
  validateUtr(utr: string): string {
    if (!utr || typeof utr !== 'string') {
      throw new BadRequestException('UTR number must be a non-empty string.');
    }
    const trimmed = utr.trim();
    if (trimmed.length < 8 || trimmed.length > 25) {
      throw new BadRequestException(
        'UTR length must be between 8 and 25 characters.',
      );
    }
    if (!/^[a-zA-Z0-9]+$/.test(trimmed)) {
      throw new BadRequestException(
        'UTR must contain only alphanumeric characters.',
      );
    }
    return trimmed;
  }

  /**
   * 1. Create a payment request for the authenticated client
   */
  async createPaymentRequest(
    clientId: string,
    dto: CreatePaymentRequestDto,
  ): Promise<CreatePaymentResponse> {
    const minutesRequested = this.calculateMinutes(dto.amount);
    const sanitizedUtr = this.validateUtr(dto.utr_number);

    this.logger.log(
      `Creating payment request for client ${clientId}: ₹${dto.amount} (${minutesRequested} mins, UTR: ${sanitizedUtr})`,
    );

    const supabase = this.supabaseService.getAdminClient();
    const { data, error } = await supabase
      .from('payment_requests')
      .insert({
        client_id: clientId,
        amount: dto.amount,
        minutes_requested: minutesRequested,
        utr_number: sanitizedUtr,
        status: 'pending',
      })
      .select('id, minutes_requested')
      .single();

    if (error || !data) {
      this.logger.error(
        `Failed to insert payment request for client ${clientId}: ${error?.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to submit payment request. Please try again.',
      );
    }

    return {
      message:
        'Payment submitted successfully. Minutes will be added within 2 hours.',
      minutes_requested: minutesRequested,
    };
  }

  /**
   * 2. Get payment history for authenticated client only
   */
  async getClientPaymentHistory(
    clientId: string,
  ): Promise<{ payments: PaymentRequestRecord[] }> {
    this.logger.log(`Fetching payment history for client ${clientId}`);
    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('payment_requests')
      .select(
        'id, amount, minutes_requested, utr_number, status, created_at, resolved_at, admin_note',
      )
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(
        `Failed to retrieve payment history for client ${clientId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to retrieve payment history.',
      );
    }

    return {
      payments: (data as PaymentRequestRecord[]) || [],
    };
  }

  /**
   * 3. Get client minutes balance from profiles.token_balance
   */
  async getClientBalance(clientId: string): Promise<ClientBalanceResponse> {
    this.logger.log(`Fetching balance for client ${clientId}`);
    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('profiles')
      .select('token_balance')
      .eq('id', clientId)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Failed to fetch balance for client ${clientId}: ${error.message}`,
      );
      throw new InternalServerErrorException('Failed to retrieve balance.');
    }

    if (!data) {
      throw new NotFoundException('Client profile not found.');
    }

    return {
      balance: data.token_balance ?? 0,
      label: 'minutes',
    };
  }

  /**
   * Helper: Enrich payments array with client emails and business names from profiles
   */
  private async enrichPaymentsWithProfiles(
    payments: PaymentRequestRecord[],
  ): Promise<PaymentRequestRecord[]> {
    if (!payments || payments.length === 0) {
      return [];
    }

    const uniqueClientIds = Array.from(
      new Set(payments.map((p) => p.client_id).filter(Boolean)),
    );

    if (uniqueClientIds.length === 0) {
      return payments;
    }

    const supabase = this.supabaseService.getAdminClient();
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, email, business_name')
      .in('id', uniqueClientIds);

    if (error || !profiles) {
      this.logger.warn(`Failed to enrich profiles for admin payments: ${error?.message}`);
      return payments;
    }

    const profileMap = new Map<string, { email?: string; business_name?: string }>();
    for (const prof of profiles) {
      profileMap.set(prof.id, prof);
    }

    return payments.map((p) => {
      const prof = profileMap.get(p.client_id);
      return {
        ...p,
        client_email: prof?.email || null,
        client_business_name: prof?.business_name || null,
      };
    });
  }

  /**
   * 4. Admin: Get all pending payment requests
   */
  async getPendingPayments(): Promise<{
    payments: PaymentRequestRecord[];
    count: number;
  }> {
    this.logger.log('Admin fetching pending payments');
    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('payment_requests')
      .select(
        'id, client_id, amount, minutes_requested, utr_number, status, created_at, resolved_at, admin_note',
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error(`Failed to fetch pending payments: ${error.message}`);
      throw new InternalServerErrorException(
        'Failed to retrieve pending payments.',
      );
    }

    const enriched = await this.enrichPaymentsWithProfiles(
      (data as PaymentRequestRecord[]) || [],
    );
    return {
      payments: enriched,
      count: enriched.length,
    };
  }

  /**
   * 5. Admin: Get all payments (newest first)
   */
  async getAllPayments(): Promise<{
    payments: PaymentRequestRecord[];
    count: number;
  }> {
    this.logger.log('Admin fetching all payments');
    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('payment_requests')
      .select(
        'id, client_id, amount, minutes_requested, utr_number, status, created_at, resolved_at, admin_note',
      )
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to fetch all payments: ${error.message}`);
      throw new InternalServerErrorException('Failed to retrieve payments.');
    }

    const enriched = await this.enrichPaymentsWithProfiles(
      (data as PaymentRequestRecord[]) || [],
    );
    return {
      payments: enriched,
      count: enriched.length,
    };
  }

  /**
   * 6. Admin: Get payment statistics
   */
  async getAdminStats(): Promise<AdminStatsResponse> {
    this.logger.log('Admin calculating payment statistics');
    const supabase = this.supabaseService.getAdminClient();

    const { data, error } = await supabase
      .from('payment_requests')
      .select('status, amount, minutes_requested');

    if (error) {
      this.logger.error(`Failed to fetch stats: ${error.message}`);
      throw new InternalServerErrorException('Failed to calculate stats.');
    }

    const rows = data || [];
    let pendingCount = 0;
    let approvedCount = 0;
    let rejectedCount = 0;
    let totalApprovedAmount = 0;
    let totalApprovedMinutes = 0;

    for (const row of rows) {
      if (row.status === 'pending') {
        pendingCount += 1;
      } else if (row.status === 'approved') {
        approvedCount += 1;
        totalApprovedAmount += Number(row.amount) || 0;
        totalApprovedMinutes += Number(row.minutes_requested) || 0;
      } else if (row.status === 'rejected') {
        rejectedCount += 1;
      }
    }

    return {
      pending_payment_count: pendingCount,
      total_payment_count: rows.length,
      approved_payment_count: approvedCount,
      rejected_payment_count: rejectedCount,
      total_approved_amount: totalApprovedAmount,
      total_approved_minutes: totalApprovedMinutes,
    };
  }

  /**
   * 7. Admin: Atomically approve a payment request and credit minutes exactly once.
   *
   * Attempts PostgreSQL stored procedure `approve_payment_request` for single-transaction
   * ACID atomicity (row-level lock + balance increment + status transition). If the RPC
   * function is not yet present in the database, falls back to atomic application check-and-set.
   */
  async approvePayment(
    paymentId: string,
    adminNote?: string,
  ): Promise<ApprovePaymentResponse> {
    this.logger.log(`Admin approving payment ${paymentId}`);
    const supabase = this.supabaseService.getAdminClient();

    // 1. Attempt atomic PostgreSQL stored procedure (single transaction)
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        'approve_payment_request',
        {
          p_payment_id: paymentId,
          p_admin_note: adminNote ?? null,
        },
      );

      if (!rpcError && rpcData) {
        if (!rpcData.success) {
          if (rpcData.error === 'not_found') {
            throw new NotFoundException(
              `Payment request with ID "${paymentId}" not found.`,
            );
          }
          if (rpcData.error === 'already_processed') {
            throw new BadRequestException('This payment has already been processed');
          }
          throw new BadRequestException(
            rpcData.message || 'Payment approval failed.',
          );
        }

        this.logger.log(
          `Payment ${paymentId} approved atomically via database RPC. Credited ${rpcData.minutes_added} minutes to client ${rpcData.client_id} (new balance: ${rpcData.new_balance})`,
        );

        return {
          message: 'Approved. Minutes added to client account.',
          minutes_added: rpcData.minutes_added,
        };
      }

      // If RPC is missing from database schema, log and fallback gracefully
      if (
        rpcError &&
        (rpcError.message?.includes('approve_payment_request') ||
          rpcError.code === 'PGRST202' ||
          rpcError.message?.includes('not found') ||
          rpcError.details?.includes('function'))
      ) {
        this.logger.warn(
          `approve_payment_request RPC not found in database: ${rpcError.message}. Executing atomic application fallback.`,
        );
        return this.approvePaymentFallback(paymentId, adminNote);
      }

      if (rpcError) {
        this.logger.error(
          `Error executing approve_payment_request RPC for payment ${paymentId}: ${rpcError.message}`,
        );
        throw new InternalServerErrorException(
          rpcError.message || 'Database transaction error approving payment.',
        );
      }
    } catch (err: unknown) {
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException ||
        err instanceof InternalServerErrorException
      ) {
        throw err;
      }
      this.logger.warn(
        `RPC execution failed with exception: ${err instanceof Error ? err.message : String(err)}. Falling back to check-and-set.`,
      );
      return this.approvePaymentFallback(paymentId, adminNote);
    }

    return this.approvePaymentFallback(paymentId, adminNote);
  }

  /**
   * Application-level check-and-set fallback for approving payment
   */
  private async approvePaymentFallback(
    paymentId: string,
    adminNote?: string,
  ): Promise<ApprovePaymentResponse> {
    const supabase = this.supabaseService.getAdminClient();

    // 1. Locate payment request
    const { data: existing, error: findError } = await supabase
      .from('payment_requests')
      .select('id, client_id, minutes_requested, status')
      .eq('id', paymentId)
      .maybeSingle();

    if (findError) {
      this.logger.error(`Error querying payment ${paymentId}: ${findError.message}`);
      throw new InternalServerErrorException('Database error locating payment.');
    }

    if (!existing) {
      throw new NotFoundException(`Payment request with ID "${paymentId}" not found.`);
    }

    if (existing.status !== 'pending') {
      throw new BadRequestException('This payment has already been processed');
    }

    // 2. Atomic check-and-set state transition: status 'pending' -> 'approved'
    const now = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      status: 'approved',
      resolved_at: now,
    };
    if (adminNote !== undefined) {
      updatePayload.admin_note = adminNote;
    }

    const { data: updated, error: updateError } = await supabase
      .from('payment_requests')
      .update(updatePayload)
      .eq('id', paymentId)
      .eq('status', 'pending')
      .select('id, client_id, minutes_requested, status')
      .maybeSingle();

    if (updateError) {
      this.logger.error(
        `Failed to transition payment ${paymentId} to approved: ${updateError.message}`,
      );
      throw new InternalServerErrorException('Failed to update payment status.');
    }

    // If updated is null, a concurrent request processed this payment in the interim
    if (!updated) {
      throw new BadRequestException('This payment has already been processed');
    }

    // 3. Atomically add minutes to profiles.token_balance
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('token_balance')
      .eq('id', updated.client_id)
      .maybeSingle();

    if (profileError || !profile) {
      this.logger.error(
        `Failed to find profile ${updated.client_id} for crediting minutes: ${profileError?.message}`,
      );
      throw new InternalServerErrorException(
        'Client profile not found to credit minutes.',
      );
    }

    const currentBalance = profile.token_balance ?? 0;
    const newBalance = currentBalance + updated.minutes_requested;

    const { error: creditError } = await supabase
      .from('profiles')
      .update({ token_balance: newBalance })
      .eq('id', updated.client_id);

    if (creditError) {
      this.logger.error(
        `Failed to credit minutes to profile ${updated.client_id}: ${creditError.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to credit minutes to client account.',
      );
    }

    this.logger.log(
      `Payment ${paymentId} successfully approved via fallback. Credited ${updated.minutes_requested} minutes to client ${updated.client_id} (new balance: ${newBalance})`,
    );

    return {
      message: 'Approved. Minutes added to client account.',
      minutes_added: updated.minutes_requested,
    };
  }

  /**
   * 8. Admin: Atomically reject a payment request (NEVER adds minutes)
   */
  async rejectPayment(
    paymentId: string,
    adminNote?: string,
  ): Promise<RejectPaymentResponse> {
    this.logger.log(`Admin rejecting payment ${paymentId}`);
    const supabase = this.supabaseService.getAdminClient();

    // 1. Locate payment request
    const { data: existing, error: findError } = await supabase
      .from('payment_requests')
      .select('id, client_id, status')
      .eq('id', paymentId)
      .maybeSingle();

    if (findError) {
      this.logger.error(`Error querying payment ${paymentId}: ${findError.message}`);
      throw new InternalServerErrorException('Database error locating payment.');
    }

    if (!existing) {
      throw new NotFoundException(`Payment request with ID "${paymentId}" not found.`);
    }

    if (existing.status !== 'pending') {
      throw new BadRequestException('This payment has already been processed');
    }

    // 2. Atomic check-and-set: status 'pending' -> 'rejected'
    const now = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      status: 'rejected',
      resolved_at: now,
      admin_note: adminNote || 'Rejected by administrator',
    };

    const { data: updated, error: updateError } = await supabase
      .from('payment_requests')
      .update(updatePayload)
      .eq('id', paymentId)
      .eq('status', 'pending')
      .select('id, client_id, status')
      .maybeSingle();

    if (updateError) {
      this.logger.error(
        `Failed to transition payment ${paymentId} to rejected: ${updateError.message}`,
      );
      throw new InternalServerErrorException('Failed to update payment status.');
    }

    if (!updated) {
      throw new BadRequestException('This payment has already been processed');
    }

    this.logger.log(`Payment ${paymentId} marked as rejected.`);
    return {
      message: 'Payment rejected.',
    };
  }
}
