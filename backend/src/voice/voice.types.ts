/**
 * Types and DTOs for VoiceController and VoiceModule webhook processing.
 */

export interface TelnyxCallPayload {
  call_control_id?: string;
  call_leg_id?: string;
  call_session_id?: string;
  connection_id?: string;
  from?: string;
  to?: string;
  direction?: string;
  client_state?: string;
  hangup_cause?: string;
  hangup_source?: string;
  [key: string]: unknown;
}

export interface TelnyxEventData {
  event_type: string;
  id?: string;
  occurred_at?: string;
  record_type?: string;
  payload?: TelnyxCallPayload;
  [key: string]: unknown;
}

export interface VoiceWebhookDto {
  data?: TelnyxEventData;
  event_type?: string;
  call_control_id?: string;
  [key: string]: unknown;
}

export interface WebhookAcknowledgment {
  received: boolean;
  status: 'acknowledged' | 'ignored' | 'error';
  event?: string;
  call_control_id?: string;
  message?: string;
}

export const TELNYX_VOICE_EVENTS = {
  CALL_INITIATED: 'call.initiated',
  CALL_ANSWERED: 'call.answered',
  CALL_HANGUP: 'call.hangup',
  CALL_SPEAK_ENDED: 'call.speak.ended',
  CALL_GATHER_ENDED: 'call.gather.ended',
  CALL_PLAYBACK_ENDED: 'call.playback.ended',
} as const;
