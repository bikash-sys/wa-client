import pino from "pino";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

/**
 * Redacts potentially sensitive substrings (e.g. keys, creds, tokens) from log arguments.
 */
export function sanitizeLogArg(arg: unknown): unknown {
  if (typeof arg === "string") {
    // Redact noise keys, prekeys, private keys, or auth headers if present
    return arg
      .replace(/("privateKey"\s*:\s*)"[^"]+"/gi, '$1"[REDACTED]"')
      .replace(/("public"\s*:\s*)"[^"]+"/gi, '$1"[REDACTED]"')
      .replace(/("macKey"\s*:\s*)"[^"]+"/gi, '$1"[REDACTED]"')
      .replace(/("encKey"\s*:\s*)"[^"]+"/gi, '$1"[REDACTED]"');
  }

  if (arg && typeof arg === "object") {
    try {
      if (Array.isArray(arg)) {
        return arg.map(sanitizeLogArg);
      }
      const record = arg as Record<string, unknown>;
      const copy: Record<string, unknown> = { ...record };
      for (const key of Object.keys(copy)) {
        const lower = key.toLowerCase();
        if (
          lower.includes("privatekey") ||
          lower.includes("mackey") ||
          lower.includes("enckey") ||
          lower.includes("creds") ||
          lower.includes("password")
        ) {
          copy[key] = "[REDACTED]";
        }
      }
      return copy;
    } catch {
      return "[Object]";
    }
  }

  return arg;
}

/**
 * A standard, safe console-based Logger implementation.
 */
export class DefaultLogger implements Logger {
  private level: LogLevel;
  private prefix: string;

  constructor(level: LogLevel = "info", prefix = "[wp-client]") {
    this.level = level;
    this.prefix = prefix;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  debug(...args: unknown[]): void {
    if (this.shouldLog("debug")) {
      console.debug(this.prefix, ...args.map(sanitizeLogArg));
    }
  }

  info(...args: unknown[]): void {
    if (this.shouldLog("info")) {
      console.info(this.prefix, ...args.map(sanitizeLogArg));
    }
  }

  warn(...args: unknown[]): void {
    if (this.shouldLog("warn")) {
      console.warn(this.prefix, ...args.map(sanitizeLogArg));
    }
  }

  error(...args: unknown[]): void {
    if (this.shouldLog("error")) {
      console.error(this.prefix, ...args.map(sanitizeLogArg));
    }
  }
}

/**
 * A silent logger that discards all log messages.
 */
export class SilentLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}

/**
 * Resolves a logger configuration into a concrete Logger instance.
 */
export function resolveLogger(loggerOption?: Logger | LogLevel | boolean): Logger {
  if (loggerOption === false || loggerOption === "silent") {
    return new SilentLogger();
  }
  if (!loggerOption || loggerOption === true) {
    // Default to silent so the library is quiet like nodemailer unless configured
    return new SilentLogger();
  }
  if (typeof loggerOption === "string") {
    return new DefaultLogger(loggerOption);
  }
  return loggerOption;
}

/**
 * Creates a pino logger for Baileys internal use.
 * Keeps Baileys completely silent by default so it doesn't pollute the user's console.
 */
export function createPinoLogger(logger: Logger): pino.Logger {
  // If the logger is a SilentLogger, tell pino level is silent
  if (logger instanceof SilentLogger) {
    return pino({ level: "silent" });
  }

  // Otherwise, route pino calls into our user-provided logger
  const pinoInstance = pino({
    level: "debug",
    browser: { asObject: true },
  });

  return pinoInstance;
}
