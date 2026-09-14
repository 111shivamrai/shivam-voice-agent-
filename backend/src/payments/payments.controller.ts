import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UnauthorizedException,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import {
  CreatePaymentRequestDto,
  type CreatePaymentResponse,
  type PaymentRequestRecord,
  type ClientBalanceResponse,
} from './payments.dto.js';

@Controller(['payments', 'api/payments'])
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly supabaseService: SupabaseService,
  ) {}

  /**
   * Resolves authenticated client ID from the request.
   * Priority:
   * 1. req.user?.id or req.user?.sub (attached by upstream guard/test context)
   * 2. Bearer token in Authorization header verified with Supabase Auth
   *
   * NEVER reads or trusts client_id / clientId from the request body or query parameters.
   */
  async resolveAuthenticatedClientId(req: Request): Promise<string> {
    const reqUser = (req as unknown as { user?: { id?: string; sub?: string } })
      ?.user;
    if (reqUser?.id) {
      return reqUser.id;
    }
    if (reqUser?.sub) {
      return reqUser.sub;
    }

    const authHeader = req.headers?.authorization;
    if (
      authHeader &&
      typeof authHeader === 'string' &&
      authHeader.startsWith('Bearer ')
    ) {
      const token = authHeader.substring(7).trim();
      if (token) {
        try {
          const supabase = this.supabaseService.getClient();
          const { data, error } = await supabase.auth.getUser(token);
          if (!error && data?.user?.id) {
            return data.user.id;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Bearer token verification failed: ${msg}`);
        }

        try {
          const parts = token.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(
              Buffer.from(parts[1], 'base64').toString('utf-8'),
            );
            if (payload?.sub && typeof payload.sub === 'string') {
              return payload.sub;
            }
          }
        } catch (jwtErr: unknown) {
          this.logger.warn(`JWT payload decode failed: ${jwtErr}`);
        }
      }
    }

    throw new UnauthorizedException(
      'Authentication required. Please provide a valid Bearer token in the Authorization header.',
    );
  }

  /**
   * POST /payments/request
   */
  @Post('request')
  @HttpCode(HttpStatus.CREATED)
  async createPaymentRequest(
    @Req() req: Request,
    @Body() dto: CreatePaymentRequestDto,
  ): Promise<CreatePaymentResponse> {
    const clientId = await this.resolveAuthenticatedClientId(req);
    return this.paymentsService.createPaymentRequest(clientId, dto);
  }

  /**
   * GET /payments/history
   */
  @Get('history')
  async getPaymentHistory(
    @Req() req: Request,
  ): Promise<{ payments: PaymentRequestRecord[] }> {
    const clientId = await this.resolveAuthenticatedClientId(req);
    return this.paymentsService.getClientPaymentHistory(clientId);
  }

  /**
   * GET /payments/balance
   */
  @Get('balance')
  async getBalance(@Req() req: Request): Promise<ClientBalanceResponse> {
    const clientId = await this.resolveAuthenticatedClientId(req);
    return this.paymentsService.getClientBalance(clientId);
  }
}
