import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  VoiceSession,
  CreateVoiceSessionDto,
  UpdateVoiceSessionDto,
  TurnIncrementResult,
  IncrementTurnOptions,
  SessionLanguage,
  SessionStatus,
  MAX_CONVERSATION_TURNS,
  DEFAULT_STALE_TIMEOUT_MS,
  DEFAULT_CLEANUP_INTERVAL_MS,
} from './voice-session.types.js';
import {
  VoiceSessionConflictException,
  VoiceSessionMaxTurnsException,
} from './voice-session.exceptions.js';

interface VoiceSessionInternal {
  sessionId: string;
  clientId: string;
  telnyxCallId: string | null;
  callerNumber: string | null;
  calledNumber: string | null;
  language: SessionLanguage;
  turnCount: number;
  emptySttCount: number;
  createdAt: Date;
  lastActivityAt: Date;
  status: SessionStatus;
  metadata?: Record<string, string | number | boolean>;
}

@Injectable()
export class VoiceSessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceSessionService.name);
  private readonly sessions = new Map<string, VoiceSessionInternal>();

  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly staleTimeoutMs: number = DEFAULT_STALE_TIMEOUT_MS;
  private readonly cleanupIntervalMs: number = DEFAULT_CLEANUP_INTERVAL_MS;

  constructor() {}

  onModuleInit(): void {
    this.startCleanupInterval();
  }

  onModuleDestroy(): void {
    this.stopCleanupInterval();
  }

  /**
   * Start the recurring interval for stale session cleanup.
   */
  public startCleanupInterval(): void {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleSessions();
    }, this.cleanupIntervalMs);

    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      (this.cleanupTimer as NodeJS.Timeout).unref();
    }
  }

  /**
   * Stop and clear the recurring cleanup interval.
   */
  public stopCleanupInterval(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Create a new isolated voice session.
   *
   * @throws VoiceSessionConflictException if a session with this sessionId already exists.
   */
  public createSession(dto: CreateVoiceSessionDto): VoiceSession {
    if (!dto.sessionId || typeof dto.sessionId !== 'string') {
      throw new Error('sessionId must be a non-empty string');
    }
    if (!dto.clientId || typeof dto.clientId !== 'string') {
      throw new Error('clientId must be a non-empty string');
    }

    if (this.sessions.has(dto.sessionId)) {
      throw new VoiceSessionConflictException(dto.sessionId);
    }

    const now = new Date();
    const internal: VoiceSessionInternal = {
      sessionId: dto.sessionId,
      clientId: dto.clientId,
      telnyxCallId: dto.telnyxCallId ?? null,
      callerNumber: dto.callerNumber ?? null,
      calledNumber: dto.calledNumber ?? null,
      language: dto.language ?? 'english',
      turnCount: 0,
      emptySttCount: 0,
      createdAt: now,
      lastActivityAt: now,
      status: dto.status ?? 'active',
      metadata: dto.metadata ? { ...dto.metadata } : undefined,
    };

    this.sessions.set(dto.sessionId, internal);
    this.logger.debug?.(`Created voice session for client ${dto.clientId}`);

    return this.cloneSession(internal);
  }

  /**
   * Retrieve a voice session by ID.
   * If clientId is specified, verifies that the session belongs to that client.
   * Returns null safely if the session is not found or client does not match.
   */
  public getSession(sessionId: string, clientId?: string): VoiceSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    if (clientId && session.clientId !== clientId) {
      return null;
    }
    return this.cloneSession(session);
  }

  /**
   * Check whether an active session exists.
   * Optionally verifies ownership against clientId.
   */
  public hasSession(sessionId: string, clientId?: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    if (clientId && session.clientId !== clientId) {
      return false;
    }
    return true;
  }

  /**
   * Update mutable attributes of an existing session.
   * Returns the updated session or null if the session is missing or client mismatches.
   */
  public updateSession(
    sessionId: string,
    updates: UpdateVoiceSessionDto,
    clientId?: string,
  ): VoiceSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    if (clientId && session.clientId !== clientId) {
      return null;
    }

    if (updates.language !== undefined) {
      session.language = updates.language;
    }
    if (updates.telnyxCallId !== undefined) {
      session.telnyxCallId = updates.telnyxCallId;
    }
    if (updates.callerNumber !== undefined) {
      session.callerNumber = updates.callerNumber;
    }
    if (updates.calledNumber !== undefined) {
      session.calledNumber = updates.calledNumber;
    }
    if (updates.status !== undefined) {
      session.status = updates.status;
    }
    if (updates.metadata !== undefined) {
      session.metadata = { ...session.metadata, ...updates.metadata };
    }

    session.lastActivityAt = new Date();
    return this.cloneSession(session);
  }

  /**
   * Remove a voice session from memory (e.g. after call completion or termination).
   * Returns true if removed, false if not found.
   */
  public removeSession(sessionId: string, clientId?: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    if (clientId && session.clientId !== clientId) {
      return false;
    }

    this.sessions.delete(sessionId);
    return true;
  }

  /**
   * Increment conversation turn counter.
   *
   * LOCKED PRODUCT RULE: Maximum 10 conversation turns per session.
   *
   * - Turns 1 through 10 are allowed.
   * - On the 11th turn attempt, the increment is blocked and rejected with a controlled result.
   * - If throwOnLimit option is enabled, throws VoiceSessionMaxTurnsException.
   */
  public incrementTurn(
    sessionId: string,
    options?: IncrementTurnOptions,
  ): TurnIncrementResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        allowed: false,
        turnCount: 0,
        maxTurnsReached: false,
        error: 'SESSION_NOT_FOUND',
      };
    }

    if (session.turnCount >= MAX_CONVERSATION_TURNS) {
      session.lastActivityAt = new Date();

      if (options?.throwOnLimit) {
        throw new VoiceSessionMaxTurnsException(sessionId, session.turnCount);
      }

      return {
        allowed: false,
        turnCount: session.turnCount,
        maxTurnsReached: true,
        error: 'MAX_TURNS_REACHED',
      };
    }

    session.turnCount += 1;
    session.lastActivityAt = new Date();

    return {
      allowed: true,
      turnCount: session.turnCount,
      maxTurnsReached: session.turnCount === MAX_CONVERSATION_TURNS,
    };
  }

  /**
   * Increment consecutive empty STT results counter.
   * Returns the new counter value, or -1 if the session does not exist.
   */
  public incrementEmptySttCount(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return -1;
    }

    session.emptySttCount += 1;
    session.lastActivityAt = new Date();
    return session.emptySttCount;
  }

  /**
   * Reset consecutive empty STT counter to 0 (called after speech is successfully transcribed).
   * Returns 0 on success, or -1 if the session does not exist.
   */
  public resetEmptySttCount(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return -1;
    }

    session.emptySttCount = 0;
    session.lastActivityAt = new Date();
    return 0;
  }

  /**
   * Update the session's last activity timestamp to prevent premature stale cleanup.
   * Returns true if updated, false if the session does not exist.
   */
  public updateActivity(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.lastActivityAt = new Date();
    return true;
  }

  /**
   * Clean up sessions that have been inactive beyond the stale timeout.
   *
   * @param customThresholdMs Optional threshold in milliseconds to override default.
   * @returns The number of removed stale sessions.
   */
  public cleanupStaleSessions(customThresholdMs?: number): number {
    const threshold = customThresholdMs ?? this.staleTimeoutMs;
    const now = Date.now();
    let removedCount = 0;

    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActivityAt.getTime() > threshold) {
        this.sessions.delete(id);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.logger.log(
        `Cleaned up ${removedCount} stale voice session(s). Active sessions: ${this.sessions.size}`,
      );
    }

    return removedCount;
  }

  /**
   * Return the count of currently active sessions.
   */
  public getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Retrieve all active sessions for a specific client.
   */
  public getSessionsForClient(clientId: string): VoiceSession[] {
    const clientSessions: VoiceSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.clientId === clientId) {
        clientSessions.push(this.cloneSession(session));
      }
    }
    return clientSessions;
  }

  /**
   * Clear all sessions in memory (useful for testing).
   */
  public clearAllSessions(): void {
    this.sessions.clear();
  }

  /**
   * Defensive deep copy & freeze to prevent external callers from mutating internal state.
   */
  private cloneSession(session: VoiceSessionInternal): VoiceSession {
    return Object.freeze({
      sessionId: session.sessionId,
      clientId: session.clientId,
      telnyxCallId: session.telnyxCallId,
      callerNumber: session.callerNumber,
      calledNumber: session.calledNumber,
      language: session.language,
      turnCount: session.turnCount,
      emptySttCount: session.emptySttCount,
      createdAt: new Date(session.createdAt.getTime()),
      lastActivityAt: new Date(session.lastActivityAt.getTime()),
      status: session.status,
      metadata: session.metadata ? Object.freeze({ ...session.metadata }) : undefined,
    });
  }
}
