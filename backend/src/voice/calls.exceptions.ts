import { HttpException, HttpStatus } from '@nestjs/common';

export class CallException extends HttpException {
  constructor(message: string, status: HttpStatus = HttpStatus.BAD_REQUEST) {
    super(message, status);
    this.name = this.constructor.name;
  }
}

export class InsufficientBalanceException extends CallException {
  constructor(clientId: string, currentBalance: number = 0) {
    super(
      `Insufficient minute balance for client ${clientId}. Current balance: ${currentBalance} minute(s).`,
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

export class CallNotFoundException extends CallException {
  constructor(callId: string) {
    super(`Call record with ID "${callId}" was not found.`, HttpStatus.NOT_FOUND);
  }
}

export class TelnyxApiException extends CallException {
  constructor(message: string, statusCode: number = 502) {
    super(`Telnyx API error: ${message}`, statusCode);
  }
}

export class CallLimitExceededException extends CallException {
  constructor(reason: string) {
    super(`Call limit reached: ${reason}`, HttpStatus.TOO_MANY_REQUESTS);
  }
}

export class InvalidPhoneNumberException extends CallException {
  constructor(phoneNumber: string) {
    super(
      `Invalid phone number format: "${phoneNumber}". Must be a valid E.164 phone number.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class UnauthorizedCallAccessException extends CallException {
  constructor() {
    super('You do not have permission to access this call record.', HttpStatus.FORBIDDEN);
  }
}
