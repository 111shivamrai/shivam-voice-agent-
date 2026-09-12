import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  UnauthorizedException,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { PaymentsService } from './payments.service.js';
import {
  RejectPaymentDto,
  type PaymentRequestRecord,
  type ApprovePaymentResponse,
  type RejectPaymentResponse,
  type AdminStatsResponse,
} from './payments.dto.js';

@Controller(['admin', 'api/admin'])
export class AdminPaymentsController {
  private readonly logger = new Logger(AdminPaymentsController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Verifies x-admin-password against environment configuration.
   * Throws 401 Unauthorized if missing or incorrect.
   */
  validateAdmin(req: Request): void {
    const rawHeader =
      req.headers['x-admin-password'] || req.header?.('x-admin-password');
    const providedPassword =
      typeof rawHeader === 'string'
        ? rawHeader.trim()
        : Array.isArray(rawHeader)
          ? rawHeader[0]?.trim()
          : '';

    const expectedPassword =
      this.configService.get<string>('ADMIN_PASSWORD') ??
      this.configService.get<string>('admin.password');

    if (!providedPassword || !expectedPassword || providedPassword !== expectedPassword) {
      this.logger.warn('Admin authentication failed: invalid or missing password');
      throw new UnauthorizedException(
        'Unauthorized: Invalid or missing admin credentials.',
      );
    }
  }

  /**
   * GET /admin/verify
   */
  @Get('verify')
  @HttpCode(HttpStatus.OK)
  verifyAdmin(@Req() req: Request): { success: boolean; message: string } {
    this.validateAdmin(req);
    return {
      success: true,
      message: 'Admin authenticated',
    };
  }

  /**
   * GET /admin/payments/pending
   */
  @Get('payments/pending')
  async getPendingPayments(
    @Req() req: Request,
  ): Promise<{ payments: PaymentRequestRecord[]; count: number }> {
    this.validateAdmin(req);
    return this.paymentsService.getPendingPayments();
  }

  /**
   * GET /admin/payments
   */
  @Get('payments')
  async getAllPayments(
    @Req() req: Request,
  ): Promise<{ payments: PaymentRequestRecord[]; count: number }> {
    this.validateAdmin(req);
    return this.paymentsService.getAllPayments();
  }

  /**
   * GET /admin/stats
   */
  @Get('stats')
  async getStats(@Req() req: Request): Promise<AdminStatsResponse> {
    this.validateAdmin(req);
    return this.paymentsService.getAdminStats();
  }

  /**
   * POST /admin/payments/:id/approve
   */
  @Post('payments/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approvePayment(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<ApprovePaymentResponse> {
    this.validateAdmin(req);
    return this.paymentsService.approvePayment(id);
  }

  /**
   * POST /admin/payments/:id/reject
   */
  @Post('payments/:id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectPayment(
    @Param('id') id: string,
    @Body() dto: RejectPaymentDto,
    @Req() req: Request,
  ): Promise<RejectPaymentResponse> {
    this.validateAdmin(req);
    return this.paymentsService.rejectPayment(id, dto?.admin_note);
  }
}
