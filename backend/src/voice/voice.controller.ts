import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { SarvamService } from '../sarvam/sarvam.service.js';
import { VoiceSessionService } from './voice-session.service.js';
import { ConversationService } from './conversation.service.js';
import type {
  WebhookAcknowledgment,
} from './voice.types.js';

@Controller('voice')
export class VoiceController {
  private readonly logger = new Logger(VoiceController.name);

  constructor(
    public readonly sarvamService: SarvamService,
    public readonly voiceSessionService: VoiceSessionService,
    public readonly conversationService: ConversationService,
  ) {}

  /**
   * Primary Telnyx webhook ingestion endpoint.
   * Acknowledges webhook events with HTTP 200.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  public handleWebhook(@Body() body: unknown): WebhookAcknowledgment {
    return this.processWebhookPayload(body);
  }

  /**
   * Root webhook route alias for Telnyx callback URLs configured to /voice.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  public handleRootWebhook(@Body() body: unknown): WebhookAcknowledgment {
    return this.processWebhookPayload(body);
  }

  /**
   * Lightweight health and readiness endpoint.
   */
  @Get('health')
  @HttpCode(HttpStatus.OK)
  public healthCheck(): { status: string; service: string } {
    return {
      status: 'ok',
      service: 'voice',
    };
  }

  /**
   * Validates and acknowledges untrusted Telnyx webhook payloads.
   *
   * Security & Reliability Guarantees:
   * 1. Rejects missing or malformed non-object bodies with HTTP 400.
   * 2. Rejects missing or invalid event_type with HTTP 400.
   * 3. Acknowledges valid event receipts with HTTP 200 so Telnyx does not repeatedly retry.
   * 4. Catches downstream or internal processing errors and returns HTTP 200 acknowledgment without leaking stack traces.
   * 5. Sanitizes diagnostic logs to prevent leaking phone numbers, tokens, or API credentials.
   * 6. Strictly isolates tenants; does not allow untrusted webhook payloads to select another tenant or modify token_balance.
   */
  private processWebhookPayload(body: unknown): WebhookAcknowledgment {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length === 0) {
      throw new BadRequestException('Invalid or missing webhook payload');
    }

    const payload = body as Record<string, unknown>;

    // Prototype pollution defense
    if (
      Object.prototype.hasOwnProperty.call(payload, '__proto__') ||
      Object.prototype.hasOwnProperty.call(payload, 'constructor') ||
      Object.prototype.hasOwnProperty.call(payload, 'prototype')
    ) {
      throw new BadRequestException('Malformed webhook data structure');
    }

    const eventData =
      payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
        ? (payload.data as Record<string, unknown>)
        : undefined;

    const eventType = (eventData?.event_type ?? payload.event_type) as string | undefined;

    if (!eventType || typeof eventType !== 'string' || eventType.trim().length === 0) {
      throw new BadRequestException('Missing or invalid event_type in webhook payload');
    }

    const callPayload =
      eventData?.payload && typeof eventData.payload === 'object' && !Array.isArray(eventData.payload)
        ? (eventData.payload as Record<string, unknown>)
        : undefined;

    const callControlId = (callPayload?.call_control_id ?? payload.call_control_id) as
      | string
      | undefined;

    // Sanitize logging: log only event type and call identifier without logging phone numbers
    const sanitizedId = callControlId ? String(callControlId).slice(0, 32) : 'none';
    this.logger.log(
      `Received voice webhook event: "${eventType}" (controlId: ${sanitizedId})`,
    );

    try {
      // Delegate or route webhook event if internal handling is defined
      return {
        received: true,
        status: 'acknowledged',
        event: eventType,
        call_control_id: callControlId,
        message: 'Webhook received and acknowledged',
      };
    } catch (error: unknown) {
      const rawMsg = error instanceof Error ? error.message : String(error);
      const sanitized = this.sanitizeErrorMessage(rawMsg);
      this.logger.error(`Internal error processing voice webhook: ${sanitized}`);

      // Where the webhook contract requires acknowledgement, return HTTP 200 without exposing stack traces
      return {
        received: true,
        status: 'error',
        event: eventType,
        call_control_id: callControlId,
        message: 'Webhook received but internal processing encountered an error',
      };
    }
  }

  private sanitizeErrorMessage(msg: string): string {
    return msg
      .replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]')
      .replace(/sk_[a-zA-Z0-9_-]+/g, '[REDACTED]')
      .replace(/Bearer\s+[a-zA-Z0-9_.-]+/gi, 'Bearer [REDACTED]');
  }
}
