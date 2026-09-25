import fs from "node:fs";
import path from "node:path";
import { SessionError } from "../errors/errors.js";
import type { Logger } from "../utils/logger.js";

/**
 * Validates a session profile name to prevent directory traversal and illegal characters.
 *
 * Rules:
 * - Must be a non-empty string
 * - May not contain `/`, `\`, null bytes, or `..` path traversal segments
 * - May not be an absolute path
 * - May only contain alphanumeric characters, hyphens, and underscores (`^[a-zA-Z0-9_-]+$`)
 *
 * @param name - The session name to validate
 * @returns The sanitized, trimmed session name
 * @throws {SessionError} If the session name fails validation
 */
export function validateSessionName(name: string): string {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new SessionError("Session name must be a non-empty string", "ERR_INVALID_SESSION_NAME");
  }

  const trimmed = name.trim();

  // Explicit checks for path traversal patterns, directory separators, and control characters
  if (
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0") ||
    trimmed.includes("..") ||
    path.isAbsolute(trimmed)
  ) {
    throw new SessionError(
      `Invalid session name "${name}": path traversal characters are not allowed`,
      "ERR_INVALID_SESSION_NAME",
    );
  }

  // Allow standard safe session names (alphanumerics, underscores, hyphens)
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new SessionError(
      `Invalid session name "${name}": session name may only contain alphanumeric characters, underscores, and hyphens`,
      "ERR_INVALID_SESSION_NAME",
    );
  }

  return trimmed;
}

/**
 * Asserts that a session profile name combined with an auth root directory
 * strictly resolves to a subpath inside the auth root directory without escaping.
 *
 * @param authRoot - Root authentication directory
 * @param sessionName - The session name to validate and resolve
 * @returns The fully resolved, verified session directory path
 */
export function assertSafeSessionPath(authRoot: string, sessionName: string): string {
  const validName = validateSessionName(sessionName);
  const resolvedAuthRoot = path.resolve(authRoot);
  const resolvedSessionPath = path.resolve(resolvedAuthRoot, validName);

  const relative = path.relative(resolvedAuthRoot, resolvedSessionPath);

  if (relative.startsWith("..") || path.isAbsolute(relative) || relative !== validName) {
    throw new SessionError(
      `Session path "${sessionName}" escapes the configured auth directory "${authRoot}"`,
      "ERR_INVALID_SESSION_PATH",
    );
  }

  return resolvedSessionPath;
}

/**
 * Manages physical storage, directory creation, validation, and lifecycle of WhatsApp session files.
 */
export class SessionStore {
  private readonly sessionPath: string;
  private readonly logger: Logger;

  constructor(sessionPath: string, logger: Logger) {
    this.sessionPath = path.resolve(sessionPath);
    this.logger = logger;
  }

  /**
   * Returns the absolute path of the session directory.
   */
  public getPath(): string {
    return this.sessionPath;
  }

  /**
   * Ensures the session directory exists with restricted filesystem permissions.
   */
  public ensureDirectory(): void {
    try {
      if (!fs.existsSync(this.sessionPath)) {
        // Create directory with owner-only read/write/execute permissions (0o700)
        fs.mkdirSync(this.sessionPath, { recursive: true, mode: 0o700 });
        this.logger.debug(`Created session directory: ${this.sessionPath}`);
      } else {
        const stats = fs.statSync(this.sessionPath);
        if (!stats.isDirectory()) {
          throw new SessionError(
            `Session path exists but is not a directory: ${this.sessionPath}`,
            "ERR_SESSION_NOT_A_DIRECTORY",
          );
        }
      }
    } catch (err) {
      if (err instanceof SessionError) throw err;
      throw new SessionError(
        `Failed to create or access session directory: ${this.sessionPath}`,
        "ERR_SESSION_INIT_FAILED",
        err,
      );
    }
  }

  /**
   * Checks whether saved credentials exist in the session directory.
   */
  public hasCredentials(): boolean {
    try {
      if (!fs.existsSync(this.sessionPath)) return false;
      const credsPath = path.join(this.sessionPath, "creds.json");
      if (!fs.existsSync(credsPath)) return false;

      const stat = fs.statSync(credsPath);
      return stat.size > 0;
    } catch {
      return false;
    }
  }

  /**
   * Checks if creds.json exists and is valid JSON.
   * If corrupt or unreadable, throws or returns false.
   */
  public isCorrupt(): boolean {
    const credsPath = path.join(this.sessionPath, "creds.json");
    if (!fs.existsSync(credsPath)) return false;

    try {
      const content = fs.readFileSync(credsPath, "utf-8");
      if (!content.trim()) return true;
      JSON.parse(content);
      return false;
    } catch {
      return true;
    }
  }

  /**
   * Validates the session directory and handles corruption gracefully.
   */
  public validate(): void {
    this.ensureDirectory();
    if (this.isCorrupt()) {
      this.logger.warn(
        `Corrupted session detected at: ${this.sessionPath}. Resetting session credentials.`,
      );
      this.clear();
    }
  }

  /**
   * Wipes all credentials and state files inside the session directory.
   * Used during logout or when resetting corrupted sessions.
   */
  public clear(): void {
    try {
      if (fs.existsSync(this.sessionPath)) {
        const files = fs.readdirSync(this.sessionPath);
        for (const file of files) {
          const filePath = path.join(this.sessionPath, file);
          try {
            fs.rmSync(filePath, { recursive: true, force: true });
          } catch (fileErr) {
            this.logger.warn(`Failed to remove session file: ${file}`, fileErr);
          }
        }
        this.logger.debug(`Cleared session files in: ${this.sessionPath}`);
      }
    } catch (err) {
      throw new SessionError(
        `Failed to clear session directory: ${this.sessionPath}`,
        "ERR_SESSION_CLEAR_FAILED",
        err,
      );
    }
  }

  /**
   * Completely removes the session directory and all its contents from disk.
   */
  public destroyDirectory(): void {
    try {
      if (fs.existsSync(this.sessionPath)) {
        fs.rmSync(this.sessionPath, { recursive: true, force: true });
        this.logger.debug(`Deleted session directory: ${this.sessionPath}`);
      }
    } catch (err) {
      throw new SessionError(
        `Failed to delete session directory: ${this.sessionPath}`,
        "ERR_SESSION_DELETE_FAILED",
        err,
      );
    }
  }

  /**
   * Discovers existing session profile names inside an auth root directory on disk.
   */
  public static listSessionNames(authRoot: string): string[] {
    try {
      const resolved = path.resolve(authRoot);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        return [];
      }

      return fs
        .readdirSync(resolved, { withFileTypes: true })
        .filter((dirent) => {
          if (!dirent.isDirectory()) return false;
          try {
            validateSessionName(dirent.name);
            return true;
          } catch {
            return false;
          }
        })
        .map((dirent) => dirent.name);
    } catch {
      return [];
    }
  }

  /**
   * Checks if a session directory exists on disk.
   */
  public static sessionExists(authRoot: string, sessionName: string): boolean {
    try {
      const sessionPath = assertSafeSessionPath(authRoot, sessionName);
      return fs.existsSync(sessionPath) && fs.statSync(sessionPath).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Deletes a session directory from disk.
   */
  public static removeSessionDirectory(authRoot: string, sessionName: string): void {
    const sessionPath = assertSafeSessionPath(authRoot, sessionName);
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }
  }
}
