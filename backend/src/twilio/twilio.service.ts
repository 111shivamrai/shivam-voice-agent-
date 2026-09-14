import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import twilio from 'twilio';

@Injectable()
export class TwilioService {
  private readonly logger = new Logger(TwilioService.name);
  private client: twilio.Twilio;

  constructor(private readonly configService: ConfigService) {
    const accountSid =
      this.configService.get<string>('TWILIO_ACCOUNT_SID') ??
      this.configService.get<string>('twilio.accountSid') ??
      '';
    const authToken =
      this.configService.get<string>('TWILIO_AUTH_TOKEN') ??
      this.configService.get<string>('twilio.authToken') ??
      '';

    if (accountSid && authToken) {
      this.client = twilio(accountSid, authToken);
    } else {
      this.logger.warn('Twilio credentials missing. Running in mock client mode.');
      this.client = twilio('AC00000000000000000000000000000000', 'mock_auth_token');
    }
  }

  /**
   * Safe retrieval of default Twilio phone number.
   */
  public getDefaultPhoneNumber(): string {
    const num =
      this.configService.get<string>('TWILIO_PHONE_NUMBER') ??
      this.configService.get<string>('twilio.phoneNumber');
    return num?.trim() ?? '';
  }

  /**
   * Retrieves the WebSocket stream URL host for TwiML Connect Stream.
   */
  public getStreamUrl(): string {
    const backendUrl =
      this.configService.get<string>('BACKEND_URL') ??
      this.configService.get<string>('APP_URL') ??
      'http://localhost:3001';

    const cleanUrl = backendUrl.replace(/\/+$/, '');
    const wsUrl = cleanUrl
      .replace(/^https:\/\//i, 'wss://')
      .replace(/^http:\/\//i, 'ws://');

    return `${wsUrl}/voice/stream`;
  }

  /**
   * Generates TwiML XML to answer an inbound call and connect it to our WebSocket media stream.
   */
  public answerCall(callSid: string): string {
    const streamUrl = this.getStreamUrl();
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="call_control_id" value="${callSid}"/>
    </Stream>
  </Connect>
</Response>`;
  }

  /**
   * Terminates an active call using Twilio REST API.
   */
  public async hangupCall(callSid: string): Promise<void> {
    try {
      if (!this.client) return;
      await this.client.calls(callSid).update({ status: 'completed' });
      this.logger.log(`Call ${callSid} terminated via Twilio REST API`);
    } catch (err: unknown) {
      this.logger.warn(`Failed to hangup call ${callSid} via Twilio: ${err}`);
    }
  }

  /**
   * Initiates an outbound call via Twilio REST API.
   */
  public async makeOutboundCall(params: {
    to: string;
    from: string;
    webhookUrl: string;
  }): Promise<string> {
    try {
      const call = await this.client.calls.create({
        to: params.to,
        from: params.from,
        url: params.webhookUrl,
      });
      this.logger.log(`Outbound call initiated to ${params.to} (Sid: ${call.sid})`);
      return call.sid;
    } catch (err: unknown) {
      this.logger.error(`Twilio outbound call failure to ${params.to}: ${err}`);
      throw err;
    }
  }

  /**
   * Generates TwiML to speak an announcement message and hang up.
   * Uses Polly.Aditi voice for clear Indian/Global English diction.
   */
  public generateTwiML(message: string): string {
    const escaped = this.escapeXml(message);
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Aditi">${escaped}</Say>
  <Hangup/>
</Response>`;
  }

  private escapeXml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
