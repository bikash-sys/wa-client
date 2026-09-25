import { describe, it, expect } from "vitest";
import {
  WhatsAppError,
  ConnectionError,
  AuthenticationError,
  MessageError,
  InvalidPhoneNumberError,
  SessionError,
} from "../src/errors/errors.js";

describe("Error hierarchy", () => {
  it("WhatsAppError should be base error with code and cause", () => {
    const cause = new Error("Network timeout");
    const err = new WhatsAppError("General error", "ERR_CODE", cause);

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(WhatsAppError);
    expect(err.message).toBe("General error");
    expect(err.code).toBe("ERR_CODE");
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("WhatsAppError");
  });

  it("ConnectionError should inherit from WhatsAppError", () => {
    const err = new ConnectionError("Failed to connect");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(WhatsAppError);
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.code).toBe("ERR_CONNECTION_FAILED");
  });

  it("AuthenticationError should inherit from WhatsAppError", () => {
    const err = new AuthenticationError("QR scan timeout");
    expect(err).toBeInstanceOf(WhatsAppError);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.code).toBe("ERR_AUTHENTICATION_FAILED");
  });

  it("MessageError should inherit from WhatsAppError", () => {
    const err = new MessageError("Message recipient blocked");
    expect(err).toBeInstanceOf(WhatsAppError);
    expect(err).toBeInstanceOf(MessageError);
    expect(err.code).toBe("ERR_MESSAGE_SEND_FAILED");
  });

  it("InvalidPhoneNumberError should inherit from WhatsAppError", () => {
    const err = new InvalidPhoneNumberError("Missing country code");
    expect(err).toBeInstanceOf(WhatsAppError);
    expect(err).toBeInstanceOf(InvalidPhoneNumberError);
    expect(err.code).toBe("ERR_INVALID_PHONE_NUMBER");
  });

  it("SessionError should inherit from WhatsAppError", () => {
    const err = new SessionError("Session permission denied");
    expect(err).toBeInstanceOf(WhatsAppError);
    expect(err).toBeInstanceOf(SessionError);
    expect(err.code).toBe("ERR_SESSION_ERROR");
  });
});
