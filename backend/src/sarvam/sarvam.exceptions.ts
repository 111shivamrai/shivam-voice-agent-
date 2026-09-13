/**
 * Provider-specific exceptions for Sarvam AI integration.
 *
 * Security Guarantee:
 * These exceptions NEVER expose API subscription keys, authorization headers,
 * or raw sensitive telephony data in error messages or stack traces.
 */

export class SarvamException extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Thrown when required Sarvam configuration or API key is missing.
 */
export class SarvamConfigurationException extends SarvamException {
  constructor(message = 'Sarvam API key is not configured.') {
    super(message);
  }
}

/**
 * Thrown when caller provides invalid input (e.g. empty audio buffer, empty text, unsupported language).
 */
export class SarvamInvalidInputException extends SarvamException {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when Sarvam rejects a request with an HTTP 4xx error.
 */
export class SarvamRequestRejectedException extends SarvamException {
  constructor(
    public readonly statusCode: number,
    message = 'Sarvam API rejected the request.',
  ) {
    super(`Sarvam API request rejected (HTTP ${statusCode}): ${message}`);
  }
}

/**
 * Thrown when Sarvam service is unavailable (HTTP 5xx, network failure, connection refused).
 */
export class SarvamUnavailableException extends SarvamException {
  constructor(
    message = 'Sarvam service is currently unavailable. Please try again later.',
    public readonly statusCode?: number,
  ) {
    super(
      statusCode
        ? `Sarvam service unavailable (HTTP ${statusCode}): ${message}`
        : `Sarvam service unavailable: ${message}`,
    );
  }
}

/**
 * Thrown when an HTTP request to Sarvam exceeds the configured timeout threshold.
 */
export class SarvamTimeoutException extends SarvamException {
  constructor(timeoutMs: number) {
    super(`Sarvam API request timed out after ${timeoutMs}ms.`);
  }
}

/**
 * Thrown when Sarvam returns a payload that does not match the expected schema
 * (e.g. missing transcript or missing audios array).
 */
export class SarvamMalformedResponseException extends SarvamException {
  constructor(message = 'Sarvam API returned an unexpected or malformed response.') {
    super(message);
  }
}
