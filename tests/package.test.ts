import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  WhatsApp,
  WhatsAppError,
  ConnectionError,
  AuthenticationError,
  MessageError,
  InvalidPhoneNumberError,
  SessionError,
  SessionStore,
  validateSessionName,
  normalizePhoneNumber,
  cleanPhoneNumber,
  toWhatsAppJid,
  jidToPhoneNumber,
  isWhatsAppJid,
  isGroupJid,
  patchLibsignalLogs,
} from "../src/index.js";

describe("Package Exports & Packaging Integrity", () => {
  it("should export all documented public classes, errors, and utility functions", () => {
    expect(WhatsApp).toBeDefined();
    expect(WhatsAppError).toBeDefined();
    expect(ConnectionError).toBeDefined();
    expect(AuthenticationError).toBeDefined();
    expect(MessageError).toBeDefined();
    expect(InvalidPhoneNumberError).toBeDefined();
    expect(SessionError).toBeDefined();
    expect(SessionStore).toBeDefined();
    expect(validateSessionName).toBeDefined();
    expect(normalizePhoneNumber).toBeDefined();
    expect(cleanPhoneNumber).toBeDefined();
    expect(toWhatsAppJid).toBeDefined();
    expect(jidToPhoneNumber).toBeDefined();
    expect(isWhatsAppJid).toBeDefined();
    expect(isGroupJid).toBeDefined();
    expect(patchLibsignalLogs).toBeDefined();
  });

  it("should have correct package.json configuration and file safety", () => {
    const pkgPath = path.resolve("./package.json");
    const pkgContent = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

    expect(pkgContent.name).toBe("whatsapp-msg-client");
    expect(pkgContent.main).toBe("./dist/index.cjs");
    expect(pkgContent.module).toBe("./dist/index.js");
    expect(pkgContent.types).toBe("./dist/index.d.ts");
    expect(pkgContent.exports["."].import).toBe("./dist/index.js");
    expect(pkgContent.exports["."].require).toBe("./dist/index.cjs");

    // Only dist should be included in files to prevent publishing auth/credentials
    expect(pkgContent.files).toEqual(["dist"]);
    expect(pkgContent.files).not.toContain("auth");
    expect(pkgContent.files).not.toContain(".env");
  });

  it("should ensure error classes inherit properly from WhatsAppError and Error", () => {
    const connErr = new ConnectionError("Connection failed", "ERR_CONN");
    expect(connErr).toBeInstanceOf(Error);
    expect(connErr).toBeInstanceOf(WhatsAppError);
    expect(connErr).toBeInstanceOf(ConnectionError);
    expect(connErr.code).toBe("ERR_CONN");

    const authErr = new AuthenticationError("Auth failed", "ERR_AUTH");
    expect(authErr).toBeInstanceOf(WhatsAppError);
    expect(authErr.code).toBe("ERR_AUTH");

    const msgErr = new MessageError("Message failed", "ERR_MSG");
    expect(msgErr).toBeInstanceOf(WhatsAppError);
    expect(msgErr.code).toBe("ERR_MSG");

    const phoneErr = new InvalidPhoneNumberError("Phone failed", "ERR_PHONE");
    expect(phoneErr).toBeInstanceOf(WhatsAppError);
    expect(phoneErr.code).toBe("ERR_PHONE");

    const sessionErr = new SessionError("Session failed", "ERR_SESSION");
    expect(sessionErr).toBeInstanceOf(WhatsAppError);
    expect(sessionErr.code).toBe("ERR_SESSION");
  });
});
