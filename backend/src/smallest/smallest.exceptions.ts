/**
 * Custom exceptions for Smallest.ai Lightning V3 TTS integration.
 * Safe for public and internal propagation — never includes API keys,
 * authorization headers, raw credentials, raw audio, or sensitive provider payloads.
 */

export class SmallestTTSException extends Error {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    const sanitized = SmallestTTSException.sanitizeMessage(message);
    super(sanitized);
    this.name = 'SmallestTTSException';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, SmallestTTSException.prototype);
  }

  private static sanitizeMessage(raw: string): string {
    if (!raw) return 'Smallest.ai TTS error occurred.';
    return raw
      .replace(/bearer\s+[a-zA-Z0-9_.-]+/gi, 'Bearer [REDACTED]')
      .replace(/token\s*[:=]\s*[a-zA-Z0-9_.-]+/gi, 'token: [REDACTED]')
      .replace(/key\s*[:=]\s*[a-zA-Z0-9_.-]+/gi, 'key: [REDACTED]')
      .replace(/api[-_]?key\s*[:=]\s*[a-zA-Z0-9_.-]+/gi, 'apiKey: [REDACTED]')
      .replace(/sk_[a-zA-Z0-9_.-]+/gi, 'sk_[REDACTED]');
  }
}

export class SmallestConfigurationException extends SmallestTTSException {
  constructor(message = 'Smallest.ai API key is not configured or invalid.') {
    super(message, 500);
    this.name = 'SmallestConfigurationException';
    Object.setPrototypeOf(this, SmallestConfigurationException.prototype);
  }
}

export class SmallestTimeoutException extends SmallestTTSException {
  constructor(timeoutMs = 5000) {
    super(`Smallest.ai TTS request timed out after ${timeoutMs}ms.`, 504);
    this.name = 'SmallestTimeoutException';
    Object.setPrototypeOf(this, SmallestTimeoutException.prototype);
  }
}

export class SmallestAuthenticationException extends SmallestTTSException {
  constructor(message = 'Smallest.ai authentication failed. Verify API key.') {
    super(message, 401);
    this.name = 'SmallestAuthenticationException';
    Object.setPrototypeOf(this, SmallestAuthenticationException.prototype);
  }
}

export class SmallestInvalidInputException extends SmallestTTSException {
  constructor(message = 'Invalid text input provided for Smallest.ai TTS.') {
    super(message, 400);
    this.name = 'SmallestInvalidInputException';
    Object.setPrototypeOf(this, SmallestInvalidInputException.prototype);
  }
}

export class SmallestMalformedResponseException extends SmallestTTSException {
  constructor(message = 'Smallest.ai returned an invalid or unparseable audio response.') {
    super(message, 502);
    this.name = 'SmallestMalformedResponseException';
    Object.setPrototypeOf(this, SmallestMalformedResponseException.prototype);
  }
}

export class SmallestUnavailableException extends SmallestTTSException {
  constructor(message = 'Smallest.ai TTS service is temporarily unavailable.', statusCode = 503) {
    super(message, statusCode);
    this.name = 'SmallestUnavailableException';
    Object.setPrototypeOf(this, SmallestUnavailableException.prototype);
  }
}
