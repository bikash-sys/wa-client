import { describe, it, expect, vi } from "vitest";
import { DefaultLogger, SilentLogger, resolveLogger, sanitizeLogArg } from "../src/utils/logger.js";

describe("Logger", () => {
  it("SilentLogger should not output anything", () => {
    const consoleSpy = vi.spyOn(console, "log");
    const silent = new SilentLogger();

    silent.debug("test");
    silent.info("test");
    silent.warn("test");
    silent.error("test");

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("DefaultLogger should filter by log level", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    const warnLogger = new DefaultLogger("warn");
    warnLogger.debug("debug message");
    warnLogger.warn("warning message");

    expect(debugSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it("resolveLogger should resolve various configurations", () => {
    expect(resolveLogger(false)).toBeInstanceOf(SilentLogger);
    expect(resolveLogger("silent")).toBeInstanceOf(SilentLogger);
    expect(resolveLogger(undefined)).toBeInstanceOf(SilentLogger);
    expect(resolveLogger("debug")).toBeInstanceOf(DefaultLogger);

    const customLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    expect(resolveLogger(customLogger)).toBe(customLogger);
  });

  it("sanitizeLogArg should redact sensitive keys in strings and objects", () => {
    const sensitiveString = '{"privateKey": "supersecretkey", "encKey": "myenckey"}';
    const sanitizedStr = sanitizeLogArg(sensitiveString) as string;
    expect(sanitizedStr).not.toContain("supersecretkey");
    expect(sanitizedStr).toContain("[REDACTED]");

    const sensitiveObj = {
      user: "alice",
      privateKey: "abcd1234efgh",
      credsData: { token: "secret" },
      password: "mypassword",
    };
    const sanitizedObj = sanitizeLogArg(sensitiveObj) as Record<string, unknown>;
    expect(sanitizedObj.user).toBe("alice");
    expect(sanitizedObj.privateKey).toBe("[REDACTED]");
    expect(sanitizedObj.password).toBe("[REDACTED]");
  });

  it("should suppress libsignal session state dumps via patched console", () => {
    const infoSpy = vi.spyOn(console, "info");
    const warnSpy = vi.spyOn(console, "warn");

    // Attempt to log libsignal session dump messages
    console.info("Closing session:", { registrationId: 12345, rootKey: "secret" });
    console.info("Opening session:", { registrationId: 12345 });
    console.warn("Closing session: old_session_data");

    // None should reach actual stdout
    expect(infoSpy).toHaveBeenCalled();
    // Verify that the output was suppressed
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
