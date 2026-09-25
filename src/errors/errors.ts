/**
 * Base error class for all whatsapp-mailer errors.
 */
export class WhatsAppError extends Error {
  /** Machine-readable error code */
  public readonly code: string;
  /** Underlying cause if any */
  public override readonly cause?: unknown;

  constructor(message: string, code = "ERR_WHATSAPP_GENERAL", cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when connection establishment or maintenance fails.
 */
export class ConnectionError extends WhatsAppError {
  constructor(message: string, code = "ERR_CONNECTION_FAILED", cause?: unknown) {
    super(message, code, cause);
  }
}

/**
 * Thrown when authentication fails or session is revoked/invalid.
 */
export class AuthenticationError extends WhatsAppError {
  constructor(message: string, code = "ERR_AUTHENTICATION_FAILED", cause?: unknown) {
    super(message, code, cause);
  }
}

/**
 * Thrown when sending, preparing, or validating a message fails.
 */
export class MessageError extends WhatsAppError {
  constructor(message: string, code = "ERR_MESSAGE_SEND_FAILED", cause?: unknown) {
    super(message, code, cause);
  }
}

/**
 * Thrown when an invalid phone number or recipient identifier is provided.
 */
export class InvalidPhoneNumberError extends WhatsAppError {
  constructor(message: string, code = "ERR_INVALID_PHONE_NUMBER", cause?: unknown) {
    super(message, code, cause);
  }
}

/**
 * Thrown when a session directory is invalid, corrupt, or inaccessible.
 */
export class SessionError extends WhatsAppError {
  constructor(message: string, code = "ERR_SESSION_ERROR", cause?: unknown) {
    super(message, code, cause);
  }
}
