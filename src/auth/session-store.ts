import fs from "node:fs";
import path from "node:path";
import { SessionError } from "../errors/errors.js";
import type { Logger } from "../utils/logger.js";

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
   * Wipes all credentials and state files in the session directory.
   * Used during logout or when clearing corrupted sessions.
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
}
