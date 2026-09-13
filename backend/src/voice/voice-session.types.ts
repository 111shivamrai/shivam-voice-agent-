/**
 * Types and interfaces for the VoiceSessionModule.
 */

export type SessionLanguage = 'hindi' | 'hinglish' | 'english';
export type SessionStatus = 'active' | 'completed' | 'terminated';

/**
 * Locked product rule: Maximum 10 conversation turns per voice session.
 */
export const MAX_CONVERSATION_TURNS = 10;

/**
 * Consecutive empty STT result thresholds for conversation recovery and termination.
 */
export const EMPTY_STT_PROMPT_THRESHOLD = 3;
export const EMPTY_STT_TERMINATE_THRESHOLD = 5;

/**
 * Inactivity threshold:
 * 15 minutes (900,000 ms).
 * Telephony voice calls have a maximum of 10 turns and typically conclude within
 * 2-5 minutes. A session with no interaction for 15 minutes is considered orphaned/stale
 * (e.g., caller hung up without triggering disconnect webhook).
 */
export const DEFAULT_STALE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Stale session cleanup interval:
 * Runs every 5 minutes (300,000 ms) to garbage-collect abandoned sessions.
 */
export const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export interface VoiceSession {
  readonly sessionId: string;
  readonly clientId: string;
  readonly telnyxCallId: string | null;
  readonly callerNumber: string | null;
  readonly calledNumber: string | null;
  readonly language: SessionLanguage;
  readonly turnCount: number;
  readonly emptySttCount: number;
  readonly createdAt: Date;
  readonly lastActivityAt: Date;
  readonly status: SessionStatus;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface CreateVoiceSessionDto {
  sessionId: string;
  clientId: string;
  telnyxCallId?: string | null;
  callerNumber?: string | null;
  calledNumber?: string | null;
  language?: SessionLanguage;
  status?: SessionStatus;
  metadata?: Record<string, string | number | boolean>;
}

export interface UpdateVoiceSessionDto {
  language?: SessionLanguage;
  telnyxCallId?: string | null;
  callerNumber?: string | null;
  calledNumber?: string | null;
  status?: SessionStatus;
  metadata?: Record<string, string | number | boolean>;
}

export interface TurnIncrementResult {
  readonly allowed: boolean;
  readonly turnCount: number;
  readonly maxTurnsReached: boolean;
  readonly error?: string;
}

export interface IncrementTurnOptions {
  throwOnLimit?: boolean;
}
