import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  StreamableFile,
  Logger,
} from '@nestjs/common';
import { SarvamService } from '../sarvam/sarvam.service.js';
import { VoiceSessionService } from './voice-session.service.js';
import { ConversationService } from './conversation.service.js';
import { CallsService } from './calls.service.js';
import type {
  WebhookAcknowledgment,
} from './voice.types.js';
import type { ProcessUtteranceResult } from './calls.types.js';

@Controller('voice')
export class VoiceController {
  private readonly logger = new Logger(VoiceController.name);

  constructor(
    public readonly sarvamService: SarvamService,
    public readonly voiceSessionService: VoiceSessionService,
    public readonly conversationService: ConversationService,
    public readonly callsService: CallsService,
  ) {}

  /**
   * Primary Telnyx webhook ingestion endpoint.
   * Acknowledges webhook events with HTTP 200.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  public async handleWebhook(@Body() body: unknown): Promise<WebhookAcknowledgment> {
    return this.processWebhookPayload(body);
  }

  /**
   * Root webhook route alias for Telnyx callback URLs configured to /voice.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  public async handleRootWebhook(@Body() body: unknown): Promise<WebhookAcknowledgment> {
    return this.processWebhookPayload(body);
  }

  /**
   * Transient audio streaming endpoint for Telnyx playback_start.
   * Delivers Sarvam Bulbul v3 synthesized WAV audio directly into the active call.
   */
  @Get('audio/:audioId')
  public getAudioStream(
    @Param('audioId') audioId: string,
    @Res({ passthrough: true }) res: any,
  ): StreamableFile {
    const cleanId = audioId.replace(/\.wav$/i, '');
    const buffer = this.callsService.getTransientAudio(cleanId);
    if (!buffer) {
      throw new NotFoundException('Audio buffer expired or not found');
    }

    res.set({
      'Content-Type': 'audio/wav',
      'Content-Length': buffer.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });

    return new StreamableFile(buffer);
  }

  /**
   * Caller utterance ingestion endpoint for direct streaming bridges, relays, and testing.
   * Feeds caller audio or transcript into the complete voice loop:
   * Sarvam STT -> ConversationService RAG -> Sarvam TTS -> Telnyx Playback
   */
  @Post('calls/:callControlId/utterance')
  @HttpCode(HttpStatus.OK)
  public async handleUtterance(
    @Param('callControlId') callControlId: string,
    @Body() body: { transcript?: string; audioBase64?: string },
  ): Promise<ProcessUtteranceResult> {
    if (!callControlId || typeof callControlId !== 'string') {
      throw new BadRequestException('Invalid callControlId');
    }
    const audioBuffer = body?.audioBase64
      ? Buffer.from(body.audioBase64, 'base64')
      : undefined;
    return this.callsService.processCallerUtterance(callControlId, {
      transcript: body?.transcript,
      audioBuffer,
    });
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
   */
  private async processWebhookPayload(body: unknown): Promise<WebhookAcknowledgment> {
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
      // Delegate to CallsService for full orchestration (state, audio, RAG, billing)
      if (this.callsService) {
        return await this.callsService.handleTelnyxWebhook(body);
      }

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
