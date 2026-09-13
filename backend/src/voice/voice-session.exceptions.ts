/**
 * Domain-specific exceptions for VoiceSessionModule.
 *
 * Security Guarantee:
 * These exceptions never expose API keys, bearer tokens, or sensitive caller data in messages.
 */

export class VoiceSessionException extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Thrown when trying to create a session with an ID that already exists.
 */
export class VoiceSessionConflictException extends VoiceSessionException {
  constructor(sessionId: string) {
    super(`Voice session already exists for sessionId: "${sessionId}"`);
  }
}

/**
 * Thrown when an operation is requested on a non-existent voice session.
 */
export class VoiceSessionNotFoundException extends VoiceSessionException {
  constructor(sessionId: string) {
    super(`Voice session not found for sessionId: "${sessionId}"`);
  }
}

/**
 * Thrown when a voice session has exceeded the maximum turn limit (10 turns).
 */
export class VoiceSessionMaxTurnsException extends VoiceSessionException {
  constructor(
    public readonly sessionId: string,
    public readonly currentTurns: number,
  ) {
    super(
      `Voice session "${sessionId}" reached maximum allowed turns (${currentTurns}/10).`,
    );
  }
}

/**
 * Thrown when a caller attempts to access a session belonging to another client.
 */
export class VoiceSessionForbiddenException extends VoiceSessionException {
  constructor(sessionId: string) {
    super(`Access to voice session "${sessionId}" is forbidden for the specified client.`);
  }
}
