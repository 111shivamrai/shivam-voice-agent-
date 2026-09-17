/**
 * Custom exceptions for Deepgram Nova-3 STT integration.
 * Safe for public and internal propagation — never includes API keys,
 * authorization headers, raw credentials, raw audio, or sensitive provider payloads.
 */

export class DeepgramSTTException extends Error {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    // Sanitize any potential sensitive leakage in message
    const sanitized = DeepgramSTTException.sanitizeMessage(message);
    super(sanitized);
    this.name = 'DeepgramSTTException';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, DeepgramSTTException.prototype);
  }

  private static sanitizeMessage(raw: string): string {
    if (!raw) return 'Deepgram STT error occurred.';
    return raw
      .replace(/bearer\s+[a-zA-Z0-9_.-]+/gi, 'Bearer [REDACTED]')
      .replace(/token\s*[:=]\s*[a-zA-Z0-9_.-]+/gi, 'token: [REDACTED]')
      .replace(/key\s*[:=]\s*[a-zA-Z0-9_.-]+/gi, 'key: [REDACTED]')
      .replace(/api[-_]?key\s*[:=]\s*[a-zA-Z0-9_.-]+/gi, 'apiKey: [REDACTED]');
  }
}

export class DeepgramConfigurationException extends DeepgramSTTException {
  constructor(message = 'Deepgram API key is not configured or invalid.') {
    super(message, 500);
    this.name = 'DeepgramConfigurationException';
    Object.setPrototypeOf(this, DeepgramConfigurationException.prototype);
  }
}

export class DeepgramTimeoutException extends DeepgramSTTException {
  constructor(timeoutMs = 8000) {
    super(`Deepgram STT request timed out after ${timeoutMs}ms.`, 504);
    this.name = 'DeepgramTimeoutException';
    Object.setPrototypeOf(this, DeepgramTimeoutException.prototype);
  }
}

export class DeepgramAuthenticationException extends DeepgramSTTException {
  constructor(message = 'Deepgram authentication failed. Verify API credentials.') {
    super(message, 401);
    this.name = 'DeepgramAuthenticationException';
    Object.setPrototypeOf(this, DeepgramAuthenticationException.prototype);
  }
}

export class DeepgramInvalidAudioException extends DeepgramSTTException {
  constructor(message = 'Invalid or unsupported audio buffer provided for transcription.') {
    super(message, 400);
    this.name = 'DeepgramInvalidAudioException';
    Object.setPrototypeOf(this, DeepgramInvalidAudioException.prototype);
  }
}
