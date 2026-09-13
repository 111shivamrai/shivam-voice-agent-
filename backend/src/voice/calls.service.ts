import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service.js';
import { SarvamService } from '../sarvam/sarvam.service.js';
import { VoiceSessionService } from './voice-session.service.js';
import { ConversationService } from './conversation.service.js';
import {
  CallRecord,
  CallTranscriptItem,
  CallStatus,
  InitiateOutboundCallDto,
  InitiateOutboundCallResponse,
  CallListQueryDto,
  CallListResponse,
  DeductMinutesResult,
  ProcessUtteranceResult,
  MAX_CALL_DURATION_SECONDS,
  WARNING_TRIGGER_ELAPSED_SECONDS,
  EMPTY_STT_PROMPT_THRESHOLD,
  EMPTY_STT_TERMINATE_THRESHOLD,
  CALL_MESSAGES,
} from './calls.types.js';
import {
  InsufficientBalanceException,
  CallNotFoundException,
  TelnyxApiException,
  InvalidPhoneNumberException,
  UnauthorizedCallAccessException,
} from './calls.exceptions.js';
import type { WebhookAcknowledgment } from './voice.types.js';

const E164_REGEX = /^\+?[1-9]\d{1,14}$/;

interface ActiveCallState {
  callRecordId: string;
  callControlId: string;
  clientId: string;
  direction: 'inbound' | 'outbound';
  callerNumber: string;
  calledNumber: string;
  startedAt: Date;
  warningGiven: boolean;
  language: string;
  status: CallStatus;
  transcript: CallTranscriptItem[];
}

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);
  private readonly telnyxBaseUrl = 'https://api.telnyx.com/v2';

  // In-memory active call states indexed by call_control_id
  private readonly activeCalls = new Map<string, ActiveCallState>();

  // Idempotency tracking for processed webhook event IDs
  private readonly processedEvents = new Map<string, number>();
  private readonly eventTtlMs = 60 * 60 * 1000; // 1 hour

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
    private readonly sarvamService: SarvamService,
    private readonly voiceSessionService: VoiceSessionService,
    private readonly conversationService: ConversationService,
  ) {}

  /**
   * Safe retrieval of Telnyx API Key from environment.
   */
  public getTelnyxApiKey(): string {
    const key =
      this.configService.get<string>('TELNYX_API_KEY') ??
      this.configService.get<string>('telnyx.apiKey');
    return key?.trim() ?? '';
  }

  /**
   * Safe retrieval of default Telnyx phone number.
   */
  public getDefaultTelnyxPhoneNumber(): string {
    const num =
      this.configService.get<string>('TELNYX_PHONE_NUMBER') ??
      this.configService.get<string>('telnyx.phoneNumber');
    return num?.trim() ?? '';
  }

  /**
   * Safe retrieval of default Telnyx connection ID / App ID.
   */
  public getTelnyxConnectionId(): string | undefined {
    const connId =
      this.configService.get<string>('TELNYX_CONNECTION_ID') ??
      this.configService.get<string>('TELNYX_APP_ID') ??
      this.configService.get<string>('telnyx.connectionId');
    return connId?.trim();
  }

  // ====================================================================
  // 1. Telnyx REST API Call Control Actions
  // ====================================================================

  /**
   * Answers an incoming Telnyx call.
   */
  public async answerCall(callControlId: string): Promise<boolean> {
    try {
      const res = await this.sendTelnyxAction(callControlId, 'answer', {});
      return res.ok;
    } catch (err: unknown) {
      this.logger.error(`Failed to answer call ${callControlId}: ${err}`);
      return false;
    }
  }

  /**
   * Hangs up an active Telnyx call.
   */
  public async hangupCall(callControlId: string): Promise<boolean> {
    try {
      const res = await this.sendTelnyxAction(callControlId, 'hangup', {});
      return res.ok;
    } catch (err: unknown) {
      this.logger.error(`Failed to hangup call ${callControlId}: ${err}`);
      return false;
    }
  }

  /**
   * Speaks text to the caller using Telnyx Call Control.
   */
  public async speakText(
    callControlId: string,
    payload: { payload: string; voice?: string; language?: string },
  ): Promise<boolean> {
    try {
      const res = await this.sendTelnyxAction(callControlId, 'speak', {
        payload: payload.payload,
        voice: payload.voice ?? 'female',
        language: payload.language ?? 'en-US',
      });
      return res.ok;
    } catch (err: unknown) {
      this.logger.error(`Failed to speak on call ${callControlId}: ${err}`);
      return false;
    }
  }

  /**
   * Plays back an audio URL to the caller.
   */
  public async playbackAudio(callControlId: string, audioUrl: string): Promise<boolean> {
    try {
      const res = await this.sendTelnyxAction(callControlId, 'playback_start', {
        audio_url: audioUrl,
      });
      return res.ok;
    } catch (err: unknown) {
      this.logger.error(`Failed to playback audio on call ${callControlId}: ${err}`);
      return false;
    }
  }

  /**
   * Helper to send action POST request to Telnyx Call Control API.
   */
  private async sendTelnyxAction(
    callControlId: string,
    action: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const apiKey = this.getTelnyxApiKey();
    if (!apiKey) {
      this.logger.warn(`TELNYX_API_KEY is not configured. Action "${action}" skipped in mock mode.`);
      return new Response(JSON.stringify({ status: 'mock_ok' }), { status: 200 });
    }

    const url = `${this.telnyxBaseUrl}/calls/${callControlId}/actions/${action}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok && response.status !== 422) {
      const errText = await response.text().catch(() => '');
      this.logger.warn(`Telnyx action "${action}" responded with status ${response.status}: ${errText}`);
    }

    return response;
  }

  // ====================================================================
  // 2. Webhook Ingestion & Orchestration
  // ====================================================================

  /**
   * Central entry point for handling Telnyx webhook payloads.
   * Guarantees idempotency and safe error recovery.
   */
  public async handleTelnyxWebhook(body: unknown): Promise<WebhookAcknowledgment> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {
        received: false,
        status: 'error',
        message: 'Invalid webhook payload structure',
      };
    }

    const payload = body as Record<string, unknown>;
    const eventData = (payload.data ?? payload) as Record<string, unknown>;
    const eventType = (eventData.event_type ?? payload.event_type) as string | undefined;
    const eventId = (eventData.id ?? payload.id) as string | undefined;

    const callPayload = (eventData.payload ?? payload) as Record<string, unknown>;
    const callControlId = (callPayload.call_control_id ?? payload.call_control_id) as
      | string
      | undefined;

    if (!eventType) {
      return {
        received: false,
        status: 'error',
        message: 'Missing event_type',
      };
    }

    // Webhook Idempotency Check
    if (eventId && this.processedEvents.has(eventId)) {
      return {
        received: true,
        status: 'acknowledged',
        event: eventType,
        call_control_id: callControlId,
        message: 'Duplicate event ignored',
      };
    }

    if (eventId) {
      this.processedEvents.set(eventId, Date.now());
      this.cleanOldProcessedEvents();
    }

    try {
      switch (eventType) {
        case 'call.initiated':
        case 'call.incoming':
          await this.handleCallInitiated(callPayload);
          break;

        case 'call.answered':
          await this.handleCallAnswered(callPayload);
          break;

        case 'call.hangup':
        case 'call.session.ended':
          await this.handleCallHangup(callPayload);
          break;

        default:
          this.logger.debug?.(`Unhandled Telnyx event: ${eventType}`);
          break;
      }

      return {
        received: true,
        status: 'acknowledged',
        event: eventType,
        call_control_id: callControlId,
        message: 'Webhook processed successfully',
      };
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error processing webhook event ${eventType}: ${rawMsg}`);

      return {
        received: true,
        status: 'error',
        event: eventType,
        call_control_id: callControlId,
        message: 'Error during webhook processing',
      };
    }
  }

  /**
   * Handles incoming / initiated call:
   * 1. Resolves tenant client by called number (profiles.telnyx_number).
   * 2. Checks token balance > 0 (prevents zero-balance calls).
   * 3. Answers call and creates database record & voice session.
   */
  public async handleCallInitiated(callPayload: Record<string, unknown>): Promise<void> {
    const callControlId = String(callPayload.call_control_id ?? '');
    const to = String(callPayload.to ?? '');
    const from = String(callPayload.from ?? '');

    if (!callControlId) {
      this.logger.warn('call.initiated missing call_control_id');
      return;
    }

    // Look up client by assigned phone number
    const profile = await this.findClientByPhoneNumber(to);
    if (!profile) {
      this.logger.warn(`No client profile found for called number "${to}". Rejecting call.`);
      await this.hangupCall(callControlId);
      return;
    }

    const clientId = profile.id;
    const balance = profile.token_balance ?? 0;

    // Check zero-balance rule
    if (balance <= 0) {
      this.logger.warn(`Client ${clientId} has 0 balance. Rejecting incoming call.`);
      const isHindi = (profile.agent_language ?? '').toLowerCase().includes('hindi');
      const msg = isHindi
        ? CALL_MESSAGES.INSUFFICIENT_BALANCE_HI
        : CALL_MESSAGES.INSUFFICIENT_BALANCE_EN;

      await this.speakText(callControlId, {
        payload: msg,
        language: isHindi ? 'hi-IN' : 'en-US',
      });
      await this.hangupCall(callControlId);
      return;
    }

    // Answer call
    await this.answerCall(callControlId);

    const now = new Date();
    const language = (profile.agent_language ?? 'english').toLowerCase();

    // Create DB call record
    const callRecord = await this.createCallRecordInDb({
      client_id: clientId,
      direction: 'inbound',
      caller_number: from,
      called_number: to,
      telnyx_call_id: callControlId,
      status: 'in-progress',
      language_used: language,
      started_at: now,
      transcript: [],
    });

    // Create session in VoiceSessionService
    this.voiceSessionService.createSession({
      sessionId: callControlId,
      clientId,
      telnyxCallId: callControlId,
      callerNumber: from,
      calledNumber: to,
      language: language.includes('hindi') ? 'hindi' : 'english',
      status: 'active',
    });

    // Track active call state in-memory
    this.activeCalls.set(callControlId, {
      callRecordId: callRecord.id,
      callControlId,
      clientId,
      direction: 'inbound',
      callerNumber: from,
      calledNumber: to,
      startedAt: now,
      warningGiven: false,
      language,
      status: 'in-progress',
      transcript: [],
    });

    this.logger.log(`Inbound call connected for client ${clientId} (ControlId: ${callControlId})`);
  }

  /**
   * Handles call answered event:
   * Greets caller in configured language.
   */
  public async handleCallAnswered(callPayload: Record<string, unknown>): Promise<void> {
    const callControlId = String(callPayload.call_control_id ?? '');
    const activeCall = this.activeCalls.get(callControlId);

    if (!activeCall) {
      return;
    }

    const isHindi = activeCall.language.includes('hindi');
    const greeting = isHindi ? CALL_MESSAGES.GREETING_HI : CALL_MESSAGES.GREETING_EN;

    const transcriptItem: CallTranscriptItem = {
      role: 'assistant',
      content: greeting,
      timestamp: new Date().toISOString(),
      source: 'greeting',
    };

    activeCall.transcript.push(transcriptItem);

    // Speak initial greeting
    await this.speakText(callControlId, {
      payload: greeting,
      language: isHindi ? 'hi-IN' : 'en-US',
    });
  }

  /**
   * Handles call hangup:
   * 1. Calculates call duration and minutes used.
   * 2. Atomically deducts minutes via Supabase deduct_minutes RPC.
   * 3. Updates database call record with final status and transcript.
   * 4. Removes session from VoiceSessionService and active call state.
   */
  public async handleCallHangup(callPayload: Record<string, unknown>): Promise<void> {
    const callControlId = String(callPayload.call_control_id ?? '');
    const activeCall = this.activeCalls.get(callControlId);

    const endedAt = new Date();
    let startedAt = activeCall ? activeCall.startedAt : endedAt;
    const clientId = activeCall ? activeCall.clientId : null;

    // Calculate duration
    const durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));
    // Telephony billing: ceiling of minutes (minimum 1 minute if connected)
    const minutesUsed = durationSeconds > 0 ? Math.ceil(durationSeconds / 60) : 0;

    if (clientId && minutesUsed > 0) {
      // Atomic minute deduction
      await this.deductMinutes(clientId, minutesUsed);
    }

    // Update database call record
    if (activeCall) {
      await this.updateCallRecordInDb(activeCall.callRecordId, {
        status: 'completed',
        duration_seconds: durationSeconds,
        minutes_used: minutesUsed,
        ended_at: endedAt,
        transcript: activeCall.transcript,
      });

      this.activeCalls.delete(callControlId);
    }

    // Remove from VoiceSessionService
    this.voiceSessionService.removeSession(callControlId);

    this.logger.log(
      `Call ended (ControlId: ${callControlId}): duration=${durationSeconds}s, minutes=${minutesUsed}`,
    );
  }

  // ====================================================================
  // 3. Conversation Turn & Utterance Processing
  // ====================================================================

  /**
   * Processes caller speech utterance (audio buffer or text):
   * Enforces:
   * - 10-minute maximum call duration limit
   * - 3-minute remaining duration warning
   * - Consecutive empty STT safety (3 = prompt, 5 = terminate)
   * - 10 conversation turns limit
   * - Document-only RAG response via ConversationService
   * - Sarvam TTS audio synthesis
   */
  public async processCallerUtterance(
    callControlId: string,
    input: { audioBuffer?: Buffer; transcript?: string },
  ): Promise<ProcessUtteranceResult> {
    const activeCall = this.activeCalls.get(callControlId);
    const session = this.voiceSessionService.getSession(callControlId);

    if (!activeCall || !session) {
      return {
        responseText: 'Session not found',
        source: 'system',
        hangup: true,
      };
    }

    const now = Date.now();
    const elapsedSeconds = Math.floor((now - activeCall.startedAt.getTime()) / 1000);
    const isHindi = activeCall.language.includes('hindi');

    // 1. Check 10-Minute Call Limit
    if (elapsedSeconds >= MAX_CALL_DURATION_SECONDS) {
      const maxMsg = isHindi ? CALL_MESSAGES.MAX_DURATION_HI : CALL_MESSAGES.MAX_DURATION_EN;
      activeCall.transcript.push({
        role: 'assistant',
        content: maxMsg,
        timestamp: new Date().toISOString(),
        source: 'limit',
      });

      await this.speakText(callControlId, {
        payload: maxMsg,
        language: isHindi ? 'hi-IN' : 'en-US',
      });
      await this.hangupCall(callControlId);

      return {
        responseText: maxMsg,
        source: 'limit',
        hangup: true,
      };
    }

    // 2. Transcribe Audio if buffer provided
    let transcriptText = input.transcript ?? '';
    if (!transcriptText && input.audioBuffer && input.audioBuffer.length > 0) {
      try {
        const sttResult = await this.sarvamService.speechToText(input.audioBuffer);
        transcriptText = (typeof sttResult === 'string' ? sttResult : (sttResult as any)?.transcript ?? '').trim();
      } catch (err: unknown) {
        this.logger.warn(`STT transcription failed for call ${callControlId}: ${err}`);
        transcriptText = '';
      }
    }

    // 3. Handle Empty STT Detection (Silence / Noise)
    if (!transcriptText || transcriptText.trim().length === 0) {
      const emptyCount = this.voiceSessionService.incrementEmptySttCount(callControlId);

      if (emptyCount >= EMPTY_STT_TERMINATE_THRESHOLD) {
        const termMsg = isHindi
          ? CALL_MESSAGES.EMPTY_STT_TERMINATE_HI
          : CALL_MESSAGES.EMPTY_STT_TERMINATE_EN;

        activeCall.transcript.push({
          role: 'assistant',
          content: termMsg,
          timestamp: new Date().toISOString(),
          source: 'system',
        });

        await this.speakText(callControlId, {
          payload: termMsg,
          language: isHindi ? 'hi-IN' : 'en-US',
        });
        await this.hangupCall(callControlId);

        return {
          responseText: termMsg,
          source: 'system',
          hangup: true,
        };
      }

      if (emptyCount >= EMPTY_STT_PROMPT_THRESHOLD) {
        const promptMsg = isHindi
          ? CALL_MESSAGES.EMPTY_STT_PROMPT_HI
          : CALL_MESSAGES.EMPTY_STT_PROMPT_EN;

        activeCall.transcript.push({
          role: 'assistant',
          content: promptMsg,
          timestamp: new Date().toISOString(),
          source: 'system',
        });

        await this.speakText(callControlId, {
          payload: promptMsg,
          language: isHindi ? 'hi-IN' : 'en-US',
        });

        return {
          responseText: promptMsg,
          source: 'system',
          hangup: false,
        };
      }

      return {
        responseText: '',
        source: 'system',
        hangup: false,
      };
    }

    // Valid speech received -> reset empty STT count
    this.voiceSessionService.resetEmptySttCount(callControlId);

    // 4. Conversation Turn Limit Check (Max 10 turns)
    const turnResult = this.voiceSessionService.incrementTurn(callControlId);
    if (!turnResult.allowed) {
      const maxTurnMsg = isHindi ? CALL_MESSAGES.MAX_TURNS_HI : CALL_MESSAGES.MAX_TURNS_EN;
      activeCall.transcript.push({
        role: 'assistant',
        content: maxTurnMsg,
        timestamp: new Date().toISOString(),
        source: 'limit',
      });

      await this.speakText(callControlId, {
        payload: maxTurnMsg,
        language: isHindi ? 'hi-IN' : 'en-US',
      });
      await this.hangupCall(callControlId);

      return {
        responseText: maxTurnMsg,
        source: 'limit',
        hangup: true,
      };
    }

    // Record caller message in transcript
    activeCall.transcript.push({
      role: 'user',
      content: transcriptText,
      timestamp: new Date().toISOString(),
    });

    // 5. Generate RAG Answer from uploaded documents
    const conversationRes = await this.conversationService.generateResponse({
      clientId: activeCall.clientId,
      question: transcriptText,
      language: isHindi ? 'hindi' : 'english',
    });

    let finalAnswer = conversationRes.answer;
    let warningGivenNow = false;

    // 6. Check 3-Minute Warning (triggers after 7 minutes / 420s)
    if (elapsedSeconds >= WARNING_TRIGGER_ELAPSED_SECONDS && !activeCall.warningGiven) {
      activeCall.warningGiven = true;
      warningGivenNow = true;
      const warnMsg = isHindi ? CALL_MESSAGES.WARNING_3MIN_HI : CALL_MESSAGES.WARNING_3MIN_EN;
      finalAnswer = `${finalAnswer} ${warnMsg}`;
    }

    // Record assistant response in transcript
    activeCall.transcript.push({
      role: 'assistant',
      content: finalAnswer,
      timestamp: new Date().toISOString(),
      source: conversationRes.source,
    });

    // 7. Synthesize Audio via Sarvam TTS
    let audioBuffer: Buffer | undefined;
    try {
      const ttsResult = await this.sarvamService.textToSpeech(
        finalAnswer,
        isHindi ? 'hi-IN' : 'en-IN',
      );
      audioBuffer = ttsResult.audioBuffer;
    } catch (err: unknown) {
      this.logger.warn(`Sarvam TTS synthesis failed, fallback to Telnyx speak: ${err}`);
      await this.speakText(callControlId, {
        payload: finalAnswer,
        language: isHindi ? 'hi-IN' : 'en-US',
      });
    }

    return {
      responseAudio: audioBuffer,
      responseText: finalAnswer,
      source: conversationRes.source,
      hangup: false,
      warningGiven: warningGivenNow,
    };
  }

  // ====================================================================
  // 4. Outbound Calling
  // ====================================================================

  /**
   * Initiates an outbound call:
   * 1. Validates client balance > 0.
   * 2. Validates destination phone number (E.164).
   * 3. Calls Telnyx API to dial destination.
   * 4. Stores outbound call record in database.
   */
  public async initiateOutboundCall(
    clientId: string,
    dto: InitiateOutboundCallDto,
  ): Promise<InitiateOutboundCallResponse> {
    if (!dto.to || !E164_REGEX.test(dto.to.replace(/\s+/g, ''))) {
      throw new InvalidPhoneNumberException(dto.to ?? '');
    }

    const supabase = this.supabaseService.getAdminClient();
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id, token_balance, telnyx_number, agent_language')
      .eq('id', clientId)
      .maybeSingle();

    if (profileErr || !profile) {
      throw new InsufficientBalanceException(clientId, 0);
    }

    const balance = profile.token_balance ?? 0;
    if (balance <= 0) {
      throw new InsufficientBalanceException(clientId, balance);
    }

    const fromNumber =
      dto.from || profile.telnyx_number || this.getDefaultTelnyxPhoneNumber();

    if (!fromNumber) {
      throw new InvalidPhoneNumberException('No valid caller ID (from) phone number configured');
    }

    const toNumber = dto.to.replace(/\s+/g, '');
    const apiKey = this.getTelnyxApiKey();
    const connectionId = this.getTelnyxConnectionId();

    let telnyxCallControlId: string | null = null;

    if (apiKey) {
      try {
        const telnyxRes = await fetch(`${this.telnyxBaseUrl}/calls`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            to: toNumber,
            from: fromNumber,
            connection_id: connectionId,
          }),
        });

        if (!telnyxRes.ok) {
          const errBody = await telnyxRes.text().catch(() => '');
          throw new TelnyxApiException(`Failed to initiate outbound call: ${errBody}`, telnyxRes.status);
        }

        const resData = (await telnyxRes.json()) as { data?: { call_control_id?: string } };
        telnyxCallControlId = resData?.data?.call_control_id ?? null;
      } catch (err: unknown) {
        if (err instanceof TelnyxApiException) {
          throw err;
        }
        throw new TelnyxApiException(err instanceof Error ? err.message : String(err));
      }
    } else {
      // Mock mode for local testing without Telnyx credentials
      telnyxCallControlId = `mock-telnyx-${Date.now()}`;
    }

    // Insert call record
    const callRecord = await this.createCallRecordInDb({
      client_id: clientId,
      direction: 'outbound',
      caller_number: fromNumber,
      called_number: toNumber,
      telnyx_call_id: telnyxCallControlId,
      status: 'initiated',
      language_used: (profile.agent_language ?? 'english').toLowerCase(),
      started_at: new Date(),
      transcript: [],
    });

    return {
      callId: callRecord.id,
      telnyxCallId: telnyxCallControlId,
      status: 'initiated',
      direction: 'outbound',
      callerNumber: fromNumber,
      calledNumber: toNumber,
    };
  }

  // ====================================================================
  // 5. Call History & Retrieval (Tenant-Isolated)
  // ====================================================================

  /**
   * Retrieves paginated list of calls for a specific authenticated client.
   */
  public async listCalls(
    clientId: string,
    query?: CallListQueryDto,
  ): Promise<CallListResponse> {
    const page = Math.max(1, query?.page ?? 1);
    const limit = Math.min(100, Math.max(1, query?.limit ?? 20));
    const offset = (page - 1) * limit;

    const supabase = this.supabaseService.getAdminClient();
    let dbQuery = supabase
      .from('calls')
      .select('*', { count: 'exact' })
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (query?.status) {
      dbQuery = dbQuery.eq('status', query.status);
    }
    if (query?.direction) {
      dbQuery = dbQuery.eq('direction', query.direction);
    }

    const { data, count, error } = await dbQuery;

    if (error) {
      this.logger.error(`Failed to list calls for client ${clientId}: ${error.message}`);
      return { calls: [], total: 0, page, limit };
    }

    return {
      calls: (data ?? []) as CallRecord[],
      total: count ?? 0,
      page,
      limit,
    };
  }

  /**
   * Retrieves a single call record with strict ownership verification.
   */
  public async getCallById(clientId: string, callId: string): Promise<CallRecord> {
    const supabase = this.supabaseService.getAdminClient();
    const { data, error } = await supabase
      .from('calls')
      .select('*')
      .eq('id', callId)
      .maybeSingle();

    if (error || !data) {
      throw new CallNotFoundException(callId);
    }

    if (data.client_id !== clientId) {
      throw new UnauthorizedCallAccessException();
    }

    return data as CallRecord;
  }

  // ====================================================================
  // 6. Database Helpers & Atomic Billing
  // ====================================================================

  /**
   * Atomically deducts minutes using the deduct_minutes RPC.
   */
  public async deductMinutes(clientId: string, minutes: number): Promise<DeductMinutesResult> {
    const supabase = this.supabaseService.getAdminClient();
    try {
      const { data, error } = await supabase.rpc('deduct_minutes', {
        p_client_id: clientId,
        p_minutes: minutes,
      });

      if (error) {
        this.logger.error(`Error executing deduct_minutes RPC for client ${clientId}: ${error.message}`);
        return {
          success: false,
          deducted: 0,
          minutes_requested: minutes,
          remaining_balance: 0,
          client_id: clientId,
          error: error.message,
        };
      }

      return data as DeductMinutesResult;
    } catch (err: unknown) {
      this.logger.error(`Exception during deductMinutes: ${err}`);
      return {
        success: false,
        deducted: 0,
        minutes_requested: minutes,
        remaining_balance: 0,
        client_id: clientId,
        error: String(err),
      };
    }
  }

  /**
   * Creates a new record in public.calls.
   */
  private async createCallRecordInDb(record: Partial<CallRecord>): Promise<CallRecord> {
    const supabase = this.supabaseService.getAdminClient();
    const { data, error } = await supabase
      .from('calls')
      .insert({
        client_id: record.client_id,
        direction: record.direction,
        caller_number: record.caller_number ?? '',
        called_number: record.called_number ?? '',
        telnyx_call_id: record.telnyx_call_id ?? null,
        duration_seconds: record.duration_seconds ?? 0,
        minutes_used: record.minutes_used ?? 0,
        transcript: record.transcript ?? [],
        status: record.status ?? 'initiated',
        language_used: record.language_used ?? 'english',
        started_at: record.started_at ?? new Date(),
      })
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Failed to insert call record: ${error?.message}`);
      return {
        id: `mock-call-${Date.now()}`,
        client_id: record.client_id!,
        direction: record.direction!,
        caller_number: record.caller_number ?? '',
        called_number: record.called_number ?? '',
        telnyx_call_id: record.telnyx_call_id ?? null,
        duration_seconds: record.duration_seconds ?? 0,
        minutes_used: record.minutes_used ?? 0,
        transcript: record.transcript ?? [],
        recording_url: null,
        status: record.status ?? 'initiated',
        language_used: record.language_used ?? 'english',
        started_at: record.started_at ?? new Date(),
        ended_at: null,
        created_at: new Date(),
      };
    }

    return data as CallRecord;
  }

  /**
   * Updates an existing record in public.calls.
   */
  private async updateCallRecordInDb(
    callId: string,
    updates: Partial<CallRecord>,
  ): Promise<void> {
    const supabase = this.supabaseService.getAdminClient();
    const updatePayload: Record<string, unknown> = {};

    if (updates.status !== undefined) updatePayload.status = updates.status;
    if (updates.duration_seconds !== undefined)
      updatePayload.duration_seconds = updates.duration_seconds;
    if (updates.minutes_used !== undefined)
      updatePayload.minutes_used = updates.minutes_used;
    if (updates.transcript !== undefined)
      updatePayload.transcript = updates.transcript;
    if (updates.ended_at !== undefined) updatePayload.ended_at = updates.ended_at;

    const { error } = await supabase.from('calls').update(updatePayload).eq('id', callId);
    if (error) {
      this.logger.error(`Failed to update call record ${callId}: ${error.message}`);
    }
  }

  /**
   * Finds a client profile by assigned Telnyx phone number.
   */
  private async findClientByPhoneNumber(
    phoneNumber: string,
  ): Promise<{ id: string; token_balance: number; agent_language?: string } | null> {
    if (!phoneNumber) return null;
    const cleanNum = phoneNumber.replace(/\s+/g, '');
    const supabase = this.supabaseService.getAdminClient();

    // Exact match
    const { data: exact } = await supabase
      .from('profiles')
      .select('id, token_balance, agent_language, telnyx_number')
      .eq('telnyx_number', cleanNum)
      .maybeSingle();

    if (exact) return exact;

    // Match without leading '+'
    const noPlus = cleanNum.startsWith('+') ? cleanNum.slice(1) : cleanNum;
    const { data: withoutPlus } = await supabase
      .from('profiles')
      .select('id, token_balance, agent_language, telnyx_number')
      .eq('telnyx_number', noPlus)
      .maybeSingle();

    if (withoutPlus) return withoutPlus;

    return null;
  }

  private cleanOldProcessedEvents(): void {
    const now = Date.now();
    for (const [eventId, time] of this.processedEvents.entries()) {
      if (now - time > this.eventTtlMs) {
        this.processedEvents.delete(eventId);
      }
    }
  }

  // Testing helpers
  public getActiveCall(callControlId: string): ActiveCallState | undefined {
    return this.activeCalls.get(callControlId);
  }

  public clearActiveCalls(): void {
    this.activeCalls.clear();
    this.processedEvents.clear();
  }
}
