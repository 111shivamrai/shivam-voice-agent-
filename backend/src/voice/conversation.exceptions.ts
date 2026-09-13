/**
 * Domain-specific exceptions for ConversationModule.
 *
 * Security Guarantee:
 * Error messages never leak API keys, authorization tokens, or cross-tenant document content.
 */

export class ConversationException extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class InvalidInputException extends ConversationException {
  constructor(message: string) {
    super(message);
  }
}

export class EmbeddingException extends ConversationException {
  constructor(message: string) {
    super(message);
  }
}

export class VectorSearchException extends ConversationException {
  constructor(message: string) {
    super(message);
  }
}
