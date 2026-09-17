import { Test, TestingModule } from '@nestjs/testing';
import { VoiceSessionService } from './voice-session.service.js';
import {
  MAX_CONVERSATION_TURNS,
  DEFAULT_STALE_TIMEOUT_MS,
  DEFAULT_CLEANUP_INTERVAL_MS,
} from './voice-session.types.js';
import {
  VoiceSessionConflictException,
  VoiceSessionMaxTurnsException,
} from './voice-session.exceptions.js';

describe('VoiceSessionService', () => {
  let service: VoiceSessionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VoiceSessionService],
    }).compile();

    service = module.get<VoiceSessionService>(VoiceSessionService);
  });

  afterEach(() => {
    service.stopCleanupInterval();
    service.clearAllSessions();
  });

  describe('Session Creation', () => {
    it('should create a session with valid parameters and initial state', () => {
      const session = service.createSession({
        sessionId: 'session-101',
        clientId: 'client-aaa',
        telnyxCallId: 'telnyx-call-1',
        callerNumber: '+919876543210',
        calledNumber: '+911234567890',
        language: 'hindi',
        status: 'active',
        metadata: { campaign: 'onboarding' },
      });

      expect(session).toBeDefined();
      expect(session.sessionId).toBe('session-101');
      expect(session.clientId).toBe('client-aaa');
      expect(session.telnyxCallId).toBe('telnyx-call-1');
      expect(session.callerNumber).toBe('+919876543210');
      expect(session.calledNumber).toBe('+911234567890');
      expect(session.language).toBe('hindi');
      expect(session.turnCount).toBe(0);
      expect(session.emptySttCount).toBe(0);
      expect(session.status).toBe('active');
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActivityAt).toBeInstanceOf(Date);
      expect(session.metadata).toEqual({ campaign: 'onboarding' });
    });

    it('should apply defaults for optional parameters', () => {
      const session = service.createSession({
        sessionId: 'session-default',
        clientId: 'client-bbb',
      });

      expect(session.language).toBe('english');
      expect(session.status).toBe('active');
      expect(session.telnyxCallId).toBeNull();
      expect(session.callerNumber).toBeNull();
      expect(session.calledNumber).toBeNull();
      expect(session.turnCount).toBe(0);
      expect(session.emptySttCount).toBe(0);
      expect(session.metadata).toBeUndefined();
    });

    it('should isolate sessions with unique identifiers', () => {
      service.createSession({ sessionId: 'session-1', clientId: 'client-1' });
      service.createSession({ sessionId: 'session-2', clientId: 'client-1' });

      expect(service.getActiveSessionCount()).toBe(2);
      expect(service.hasSession('session-1')).toBe(true);
      expect(service.hasSession('session-2')).toBe(true);
    });

    it('should throw VoiceSessionConflictException on duplicate session creation', () => {
      service.createSession({ sessionId: 'session-dup', clientId: 'client-1' });

      expect(() => {
        service.createSession({ sessionId: 'session-dup', clientId: 'client-2' });
      }).toThrow(VoiceSessionConflictException);
    });

    it('should reject creation with empty or missing sessionId', () => {
      expect(() => {
        service.createSession({ sessionId: '', clientId: 'client-1' });
      }).toThrow('sessionId must be a non-empty string');
    });

    it('should reject creation with empty or missing clientId', () => {
      expect(() => {
        service.createSession({ sessionId: 'valid-id', clientId: '' });
      }).toThrow('clientId must be a non-empty string');
    });
  });

  describe('Session Retrieval', () => {
    it('should retrieve an existing session', () => {
      service.createSession({ sessionId: 'sess-retrieve', clientId: 'client-ret' });

      const retrieved = service.getSession('sess-retrieve');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.sessionId).toBe('sess-retrieve');
      expect(retrieved?.clientId).toBe('client-ret');
    });

    it('should return null when retrieving a non-existent session', () => {
      const retrieved = service.getSession('non-existent');
      expect(retrieved).toBeNull();
    });

    it('should correctly report hasSession for existing and non-existent sessions', () => {
      service.createSession({ sessionId: 'sess-exists', clientId: 'client-1' });

      expect(service.hasSession('sess-exists')).toBe(true);
      expect(service.hasSession('sess-missing')).toBe(false);
    });

    it('should enforce client tenant isolation when retrieving with clientId', () => {
      service.createSession({ sessionId: 'sess-tenant', clientId: 'client-legit' });

      // Owner client retrieval succeeds
      expect(service.getSession('sess-tenant', 'client-legit')).not.toBeNull();
      expect(service.hasSession('sess-tenant', 'client-legit')).toBe(true);

      // Foreign client retrieval safely returns null / false
      expect(service.getSession('sess-tenant', 'client-attacker')).toBeNull();
      expect(service.hasSession('sess-tenant', 'client-attacker')).toBe(false);
    });

    it('should retrieve all sessions belonging to a specific client', () => {
      service.createSession({ sessionId: 'sess-c1-1', clientId: 'client-1' });
      service.createSession({ sessionId: 'sess-c1-2', clientId: 'client-1' });
      service.createSession({ sessionId: 'sess-c2-1', clientId: 'client-2' });

      const c1Sessions = service.getSessionsForClient('client-1');
      expect(c1Sessions).toHaveLength(2);
      expect(c1Sessions.map((s) => s.sessionId)).toEqual(['sess-c1-1', 'sess-c1-2']);

      const c2Sessions = service.getSessionsForClient('client-2');
      expect(c2Sessions).toHaveLength(1);
      expect(c2Sessions[0].sessionId).toBe('sess-c2-1');
    });
  });

  describe('Session Updates', () => {
    it('should update session language and telephony metadata', () => {
      service.createSession({
        sessionId: 'sess-update',
        clientId: 'client-upd',
        language: 'english',
      });

      const updated = service.updateSession('sess-update', {
        language: 'hinglish',
        telnyxCallId: 'call-control-456',
        callerNumber: '+919999999999',
        calledNumber: '+918888888888',
        status: 'active',
        metadata: { stage: 'collecting_name' },
      });

      expect(updated).not.toBeNull();
      expect(updated?.language).toBe('hinglish');
      expect(updated?.telnyxCallId).toBe('call-control-456');
      expect(updated?.callerNumber).toBe('+919999999999');
      expect(updated?.calledNumber).toBe('+918888888888');
      expect(updated?.metadata).toEqual({ stage: 'collecting_name' });
    });

    it('should advance lastActivityAt on update', async () => {
      const initial = service.createSession({
        sessionId: 'sess-activity',
        clientId: 'client-act',
      });
      const initialActivity = initial.lastActivityAt.getTime();

      await new Promise((resolve) => setTimeout(resolve, 15));

      const updated = service.updateSession('sess-activity', { language: 'hindi' });
      expect(updated?.lastActivityAt.getTime()).toBeGreaterThan(initialActivity);
    });

    it('should handle missing session updates safely by returning null', () => {
      const result = service.updateSession('non-existent', { language: 'hindi' });
      expect(result).toBeNull();
    });

    it('should prevent cross-client update attempts', () => {
      service.createSession({ sessionId: 'sess-cross-upd', clientId: 'client-owner' });

      const result = service.updateSession(
        'sess-cross-upd',
        { language: 'hindi' },
        'client-intruder',
      );
      expect(result).toBeNull();

      // Original session remains unchanged
      const original = service.getSession('sess-cross-upd');
      expect(original?.language).toBe('english');
    });

    it('should safely update activity timestamp via updateActivity', async () => {
      const session = service.createSession({ sessionId: 'sess-touch', clientId: 'client-1' });
      const initialTime = session.lastActivityAt.getTime();

      await new Promise((resolve) => setTimeout(resolve, 15));

      const updated = service.updateActivity('sess-touch');
      expect(updated).toBe(true);

      const refreshed = service.getSession('sess-touch');
      expect(refreshed?.lastActivityAt.getTime()).toBeGreaterThan(initialTime);

      expect(service.updateActivity('non-existent')).toBe(false);
    });
  });

  describe('Turn Limit Enforcement (Locked Product Rule: Max 10 Turns)', () => {
    it('should enforce MAX_CONVERSATION_TURNS constant at exactly 10', () => {
      expect(MAX_CONVERSATION_TURNS).toBe(10);
    });

    it('should start with initial turnCount of 0', () => {
      const session = service.createSession({ sessionId: 'sess-turns', clientId: 'client-turns' });
      expect(session.turnCount).toBe(0);
    });

    it('should increment turns from 1 to 10 successfully', () => {
      service.createSession({ sessionId: 'sess-10-turns', clientId: 'client-1' });

      for (let turn = 1; turn <= 9; turn++) {
        const result = service.incrementTurn('sess-10-turns');
        expect(result.allowed).toBe(true);
        expect(result.turnCount).toBe(turn);
        expect(result.maxTurnsReached).toBe(false);
      }

      // 10th turn is allowed and signals maxTurnsReached
      const tenthTurn = service.incrementTurn('sess-10-turns');
      expect(tenthTurn.allowed).toBe(true);
      expect(tenthTurn.turnCount).toBe(10);
      expect(tenthTurn.maxTurnsReached).toBe(true);
    });

    it('should reject and block 11th turn with controlled result', () => {
      service.createSession({ sessionId: 'sess-limit', clientId: 'client-1' });

      // Run 10 turns
      for (let turn = 1; turn <= 10; turn++) {
        service.incrementTurn('sess-limit');
      }

      // 11th turn attempt
      const eleventhTurn = service.incrementTurn('sess-limit');
      expect(eleventhTurn.allowed).toBe(false);
      expect(eleventhTurn.turnCount).toBe(10);
      expect(eleventhTurn.maxTurnsReached).toBe(true);
      expect(eleventhTurn.error).toBe('MAX_TURNS_REACHED');

      // Subsequent turns remain capped at 10 and rejected
      const twelfthTurn = service.incrementTurn('sess-limit');
      expect(twelfthTurn.allowed).toBe(false);
      expect(twelfthTurn.turnCount).toBe(10);
    });

    it('should throw VoiceSessionMaxTurnsException when throwOnLimit option is specified', () => {
      service.createSession({ sessionId: 'sess-opt-throw', clientId: 'client-1' });

      for (let turn = 1; turn <= 10; turn++) {
        service.incrementTurn('sess-opt-throw');
      }

      expect(() => {
        service.incrementTurn('sess-opt-throw', { throwOnLimit: true });
      }).toThrow(VoiceSessionMaxTurnsException);
    });

    it('should keep session usable for non-turn operations even after 10 turns', () => {
      service.createSession({ sessionId: 'sess-usable', clientId: 'client-1' });

      for (let turn = 1; turn <= 10; turn++) {
        service.incrementTurn('sess-usable');
      }

      // Read session
      const session = service.getSession('sess-usable');
      expect(session).not.toBeNull();
      expect(session?.turnCount).toBe(10);

      // Update metadata/status
      const updated = service.updateSession('sess-usable', {
        status: 'completed',
        metadata: { reason: 'max_turns_completed' },
      });
      expect(updated?.status).toBe('completed');
      expect(updated?.metadata?.reason).toBe('max_turns_completed');

      // Activity update
      expect(service.updateActivity('sess-usable')).toBe(true);

      // Clean removal
      expect(service.removeSession('sess-usable')).toBe(true);
    });

    it('should return controlled error when incrementing turns on missing session', () => {
      const result = service.incrementTurn('non-existent');
      expect(result.allowed).toBe(false);
      expect(result.turnCount).toBe(0);
      expect(result.maxTurnsReached).toBe(false);
      expect(result.error).toBe('SESSION_NOT_FOUND');
    });
  });

  describe('Consecutive Empty STT Tracking', () => {
    it('should start with initial emptySttCount of 0', () => {
      const session = service.createSession({ sessionId: 'sess-stt', clientId: 'client-1' });
      expect(session.emptySttCount).toBe(0);
    });

    it('should increment emptySttCount consecutively to 3 and 5', () => {
      service.createSession({ sessionId: 'sess-stt-inc', clientId: 'client-1' });

      expect(service.incrementEmptySttCount('sess-stt-inc')).toBe(1);
      expect(service.incrementEmptySttCount('sess-stt-inc')).toBe(2);

      // Threshold for "I didn't catch that. Could you please repeat?"
      const third = service.incrementEmptySttCount('sess-stt-inc');
      expect(third).toBe(3);

      expect(service.incrementEmptySttCount('sess-stt-inc')).toBe(4);

      // Threshold for "Having trouble hearing you. Please call back."
      const fifth = service.incrementEmptySttCount('sess-stt-inc');
      expect(fifth).toBe(5);

      const session = service.getSession('sess-stt-inc');
      expect(session?.emptySttCount).toBe(5);
    });

    it('should reset emptySttCount to 0 after successful speech recognition', () => {
      service.createSession({ sessionId: 'sess-stt-reset', clientId: 'client-1' });

      service.incrementEmptySttCount('sess-stt-reset');
      service.incrementEmptySttCount('sess-stt-reset');
      expect(service.getSession('sess-stt-reset')?.emptySttCount).toBe(2);

      const resetResult = service.resetEmptySttCount('sess-stt-reset');
      expect(resetResult).toBe(0);

      const session = service.getSession('sess-stt-reset');
      expect(session?.emptySttCount).toBe(0);
    });

    it('should handle missing session in empty STT operations safely', () => {
      expect(service.incrementEmptySttCount('non-existent')).toBe(-1);
      expect(service.resetEmptySttCount('non-existent')).toBe(-1);
    });
  });

  describe('Session Removal', () => {
    it('should remove existing session and decrement active session count', () => {
      service.createSession({ sessionId: 'sess-rem', clientId: 'client-1' });
      expect(service.getActiveSessionCount()).toBe(1);

      const removed = service.removeSession('sess-rem');
      expect(removed).toBe(true);
      expect(service.getActiveSessionCount()).toBe(0);
      expect(service.getSession('sess-rem')).toBeNull();
      expect(service.hasSession('sess-rem')).toBe(false);
    });

    it('should return false safely when removing non-existent session', () => {
      expect(service.removeSession('non-existent')).toBe(false);
    });

    it('should prevent cross-client session deletion', () => {
      service.createSession({ sessionId: 'sess-protect-del', clientId: 'client-owner' });

      const removed = service.removeSession('sess-protect-del', 'client-attacker');
      expect(removed).toBe(false);

      expect(service.hasSession('sess-protect-del')).toBe(true);
    });
  });

  describe('Stale Session Cleanup', () => {
    it('should remove stale sessions while keeping active sessions', () => {
      service.createSession({ sessionId: 'sess-stale-1', clientId: 'client-1' });
      service.createSession({ sessionId: 'sess-stale-2', clientId: 'client-2' });
      service.createSession({ sessionId: 'sess-active', clientId: 'client-3' });

      // Simulate age deterministically
      const customThresholdMs = 5000;
      const now = Date.now();
      const internalMap = (service as any).sessions as Map<string, any>;
      const s1 = internalMap.get('sess-stale-1');
      const s2 = internalMap.get('sess-stale-2');
      const sActive = internalMap.get('sess-active');

      if (s1) s1.lastActivityAt = new Date(now - 10000);
      if (s2) s2.lastActivityAt = new Date(now - 10000);
      if (sActive) sActive.lastActivityAt = new Date(now);

      const removed = service.cleanupStaleSessions(customThresholdMs);

      expect(removed).toBe(2);
      expect(service.hasSession('sess-stale-1')).toBe(false);
      expect(service.hasSession('sess-stale-2')).toBe(false);
      expect(service.hasSession('sess-active')).toBe(true);
      expect(service.getActiveSessionCount()).toBe(1);
    });

    it('should not crash on empty session map during cleanup', () => {
      expect(service.cleanupStaleSessions()).toBe(0);
    });
  });

  describe('Lifecycle and Timer Management', () => {
    it('should define sensible production default cleanup constants', () => {
      expect(DEFAULT_STALE_TIMEOUT_MS).toBe(15 * 60 * 1000); // 15 minutes
      expect(DEFAULT_CLEANUP_INTERVAL_MS).toBe(5 * 60 * 1000); // 5 minutes
    });

    it('should start timer on onModuleInit and clear on onModuleDestroy', () => {
      service.onModuleInit();
      // Calling start again is idempotent
      service.startCleanupInterval();

      // Stop timer cleanly
      service.onModuleDestroy();
      // Calling stop again is idempotent
      service.stopCleanupInterval();
    });
  });

  describe('Concurrency & Tenant Isolation', () => {
    it('should maintain independent state across two concurrent calls from different clients', () => {
      service.createSession({ sessionId: 'call-client-A', clientId: 'client-A' });
      service.createSession({ sessionId: 'call-client-B', clientId: 'client-B' });

      // Advance turns on Session A
      service.incrementTurn('call-client-A');
      service.incrementTurn('call-client-A');
      service.incrementEmptySttCount('call-client-A');

      const sessionA = service.getSession('call-client-A');
      const sessionB = service.getSession('call-client-B');

      expect(sessionA?.turnCount).toBe(2);
      expect(sessionA?.emptySttCount).toBe(1);

      // Session B must remain pristine
      expect(sessionB?.turnCount).toBe(0);
      expect(sessionB?.emptySttCount).toBe(0);
    });

    it('should maintain independent state across two simultaneous calls from the same client', () => {
      service.createSession({ sessionId: 'call-1', clientId: 'client-same' });
      service.createSession({ sessionId: 'call-2', clientId: 'client-same' });

      service.incrementTurn('call-1');
      service.updateSession('call-1', { language: 'hindi' });

      const call1 = service.getSession('call-1');
      const call2 = service.getSession('call-2');

      expect(call1?.turnCount).toBe(1);
      expect(call1?.language).toBe('hindi');

      expect(call2?.turnCount).toBe(0);
      expect(call2?.language).toBe('english');
    });
  });

  describe('Memory Safety & Defensive Copying', () => {
    it('should prevent external mutation of returned session objects', () => {
      service.createSession({ sessionId: 'sess-defensive', clientId: 'client-1' });

      const retrieved = service.getSession('sess-defensive');
      expect(retrieved).not.toBeNull();

      // Attempt mutation on returned object in runtime
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (retrieved as any).turnCount = 999;
      }).toThrow();

      // Internal state remains 0
      const internalSession = service.getSession('sess-defensive');
      expect(internalSession?.turnCount).toBe(0);
    });

    it('should not store audio buffers or authorization tokens in session state', () => {
      const session = service.createSession({
        sessionId: 'sess-lean',
        clientId: 'client-lean',
      });

      const keys = Object.keys(session);
      expect(keys).not.toContain('audio');
      expect(keys).not.toContain('audioBuffer');
      expect(keys).not.toContain('apiKey');
      expect(keys).not.toContain('token');
      expect(keys).not.toContain('auth');
    });
  });
});
