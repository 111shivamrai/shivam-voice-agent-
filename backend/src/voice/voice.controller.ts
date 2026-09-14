import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Res,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  StreamableFile,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SarvamService } from '../sarvam/sarvam.service.js';
import { VoiceSessionService } from './voice-session.service.js';
import { ConversationService } from './conversation.service.js';
import { CallsService } from './calls.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import type { WebhookAcknowledgment } from './voice.types.js';
import type { ProcessUtteranceResult, InitiateOutboundCallDto } from './calls.types.js';

@Controller('voice')
export class VoiceController {
  private readonly logger = new Logger(VoiceController.name);

  constructor(
    public readonly sarvamService: SarvamService,
    public readonly voiceSessionService: VoiceSessionService,
    public readonly conversationService: ConversationService,
    public readonly callsService: CallsService,
    private readonly supabaseService: SupabaseService,
  ) {}

  /**
   * Primary voice webhook ingestion endpoint (Twilio and Telnyx).
   * For Twilio: returns TwiML XML (Content-Type: text/xml).
   * For Telnyx: returns WebhookAcknowledgment JSON.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  public async handleWebhook(
    @Body() body: unknown,
    @Res({ passthrough: false }) res?: Response,
  ): Promise<any> {
    return this.processIncomingWebhook(body, res);
  }

  /**
   * Root webhook route alias (/voice) for Twilio/Telnyx callbacks.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  public async handleRootWebhook(
    @Body() body: unknown,
    @Res({ passthrough: false }) res?: Response,
  ): Promise<any> {
    return this.processIncomingWebhook(body, res);
  }

  /**
   * Twilio call status callback endpoint.
   * Handles call completion, failure, duration tracking, and atomic billing.
   */
  @Post('status-callback')
  @HttpCode(HttpStatus.OK)
  public async handleStatusCallback(
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: false }) res?: Response,
  ): Promise<any> {
    try {
      if (this.callsService) {
        await this.callsService.handleTwilioStatusCallback(body);
      }
      const twiml = '<?xml version="1.0" encoding="UTF-8"?><Response/>';
      if (res && typeof res.type === 'function') {
        res.type('text/xml').send(twiml);
        return;
      }
      return twiml;
    } catch (err: unknown) {
      this.logger.warn(`Error processing status callback: ${err}`);
      const twiml = '<?xml version="1.0" encoding="UTF-8"?><Response/>';
      if (res && typeof res.type === 'function') {
        res.type('text/xml').send(twiml);
        return;
      }
      return twiml;
    }
  }

  /**
   * POST /voice/outbound
   * Initiates an outbound call for authenticated client.
   */
  @Post('outbound')
  @HttpCode(HttpStatus.OK)
  public async handleOutbound(
    @Req() req: Request,
    @Body() body: InitiateOutboundCallDto,
  ) {
    const clientId = await this.resolveAuthenticatedClientId(req);
    return this.callsService.initiateOutboundCall(clientId, body);
  }

  /**
   * POST /voice/end/:callId
   * Ends an active call for authenticated client.
   */
  @Post('end/:callId')
  @HttpCode(HttpStatus.OK)
  public async handleEndCall(
    @Req() req: Request,
    @Param('callId') callId: string,
  ) {
    await this.resolveAuthenticatedClientId(req);
    await this.callsService.hangupCall(callId);
    return { success: true, message: `Call ${callId} ended` };
  }

  /**
   * Transient audio streaming endpoint for carrier playback.
   * Delivers Sarvam Bulbul v3 synthesized WAV audio directly into the active call.
   */
  @Get('audio/:audioId')
  public getAudioStream(
    @Param('audioId') audioId: string,
    @Res({ passthrough: true }) res: any,
  ): StreamableFile {
    const cleanId = audioId.replace(/\.wav$/i, '');
    const buffer = this.callsService.consumeTransientAudio(cleanId);
    if (!buffer) {
      throw new NotFoundException('Audio buffer expired or not found');
    }

    if (res && typeof res.set === 'function') {
      res.set({
        'Content-Type': 'audio/wav',
        'Content-Length': String(buffer.length),
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });
    }

    return new StreamableFile(buffer);
  }

  /**
   * Caller utterance ingestion endpoint for direct streaming bridges, relays, and testing.
   * Feeds caller audio or transcript into the complete voice loop:
   * Sarvam STT -> ConversationService RAG -> Sarvam TTS -> WebSocket/Playback
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
   * Processes incoming webhook payloads from Twilio or Telnyx.
   */
  private async processIncomingWebhook(body: unknown, res?: Response): Promise<any> {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length === 0) {
      if (res && typeof res.status === 'function') {
        res.status(HttpStatus.BAD_REQUEST).json({ message: 'Invalid or missing webhook payload' });
        return;
      }
      throw new BadRequestException('Invalid or missing webhook payload');
    }

    const payload = body as Record<string, unknown>;

    // Prototype pollution defense
    if (
      Object.prototype.hasOwnProperty.call(payload, '__proto__') ||
      Object.prototype.hasOwnProperty.call(payload, 'constructor') ||
      Object.prototype.hasOwnProperty.call(payload, 'prototype')
    ) {
      if (res && typeof res.status === 'function') {
        res.status(HttpStatus.BAD_REQUEST).json({ message: 'Malformed webhook data structure' });
        return;
      }
      throw new BadRequestException('Malformed webhook data structure');
    }

    // 1. Check if this is a Twilio Inbound Voice Webhook
    const isTwilio = Boolean(
      payload.CallSid ||
        payload.call_sid ||
        (typeof payload.AccountSid === 'string' && payload.AccountSid.startsWith('AC')) ||
        payload.Called ||
        payload.Caller,
    );

    if (isTwilio) {
      try {
        const twimlXml = await this.callsService.handleTwilioWebhook(payload);
        if (res && typeof res.type === 'function') {
          res.type('text/xml').status(HttpStatus.OK).send(twimlXml);
          return;
        }
        return twimlXml;
      } catch (err: unknown) {
        this.logger.error(`Error handling Twilio webhook: ${err}`);
        const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Aditi">An internal error occurred. Please try again later.</Say><Hangup/></Response>`;
        if (res && typeof res.type === 'function') {
          res.type('text/xml').status(HttpStatus.OK).send(fallbackTwiml);
          return;
        }
        return fallbackTwiml;
      }
    }

    // 2. Telnyx / Generic JSON webhook handling
    const eventData =
      payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
        ? (payload.data as Record<string, unknown>)
        : undefined;

    const eventType = (eventData?.event_type ?? payload.event_type) as string | undefined;

    if (!eventType || typeof eventType !== 'string' || eventType.trim().length === 0) {
      if (res && typeof res.status === 'function') {
        res.status(HttpStatus.BAD_REQUEST).json({ message: 'Missing or invalid event_type in webhook payload' });
        return;
      }
      throw new BadRequestException('Missing or invalid event_type in webhook payload');
    }

    try {
      const ack = await this.processWebhookPayload(body);
      if (res && typeof res.status === 'function') {
        res.status(HttpStatus.OK).json(ack);
        return;
      }
      return ack;
    } catch (error: unknown) {
      const rawMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Internal error processing voice webhook: ${this.sanitizeErrorMessage(rawMsg)}`);
      const fallbackAck: WebhookAcknowledgment = {
        received: true,
        status: 'error',
        message: 'Webhook received but internal processing encountered an error',
      };
      if (res && typeof res.status === 'function') {
        res.status(HttpStatus.OK).json(fallbackAck);
        return;
      }
      return fallbackAck;
    }
  }

  public processWebhookPayload(body: unknown): Promise<any> {
    return this.callsService.handleTelnyxWebhook(body);
  }

  public sanitizeErrorMessage(msg: string): string {
    if (!msg || typeof msg !== 'string') return '';
    return msg
      .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[REDACTED]')
      .replace(/sk_[a-zA-Z0-9_]+/g, '[REDACTED]')
      .replace(/Bearer\s+[^\s]+/g, 'Bearer [REDACTED]');
  }

  private async resolveAuthenticatedClientId(req: Request): Promise<string> {
    const reqUser = (req as unknown as { user?: { id?: string; sub?: string } })?.user;
    if (reqUser?.id) return reqUser.id;
    if (reqUser?.sub) return reqUser.sub;

    const authHeader = req.headers?.authorization;
    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      if (token) {
        try {
          const supabase = this.supabaseService.getClient();
          const { data, error } = await supabase.auth.getUser(token);
          if (!error && data?.user?.id) {
            return data.user.id;
          }
        } catch (err: unknown) {
          this.logger.warn(`Auth token verification failed: ${err}`);
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

    throw new UnauthorizedException('Authentication required');
  }
}
