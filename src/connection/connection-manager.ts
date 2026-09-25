import type { Logger } from "../utils/logger.js";
import type { WhatsAppTransport } from "../transport/transport.interface.js";
import { ConnectionError } from "../errors/errors.js";

export interface ReconnectConfig {
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectIntervalMs?: number;
}

/**
 * Manages reconnection logic with exponential backoff and attempt limits.
 */
export class ConnectionManager {
  private transport: WhatsAppTransport;
  private logger: Logger;
  private reconnectEnabled: boolean;
  private maxAttempts: number;
  private baseIntervalMs: number;
  private attemptCount = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  constructor(transport: WhatsAppTransport, logger: Logger, config: ReconnectConfig = {}) {
    this.transport = transport;
    this.logger = logger;
    this.reconnectEnabled = config.reconnect ?? true;
    this.maxAttempts = config.maxReconnectAttempts ?? 5;
    this.baseIntervalMs = config.reconnectIntervalMs ?? 2000;
  }

  public getAttemptCount(): number {
    return this.attemptCount;
  }

  public resetAttempts(): void {
    this.attemptCount = 0;
    this.clearTimer();
  }

  public stop(): void {
    this.isShuttingDown = true;
    this.clearTimer();
  }

  public resume(): void {
    this.isShuttingDown = false;
  }

  /**
   * Schedules a reconnection attempt using exponential backoff.
   * Calls onReconnecting callback with (attempt, maxAttempts).
   */
  public scheduleReconnect(
    onReconnecting: (attempt: number, maxAttempts: number) => void,
    onFailed: (err: ConnectionError) => void,
  ): boolean {
    if (this.isShuttingDown || !this.reconnectEnabled) {
      this.logger.debug("Automatic reconnection is disabled or client is stopping.");
      return false;
    }

    if (this.attemptCount >= this.maxAttempts) {
      const err = new ConnectionError(
        `Failed to reconnect to WhatsApp after ${this.maxAttempts} attempts`,
        "ERR_MAX_RECONNECT_REACHED",
      );
      this.logger.error(err.message);
      onFailed(err);
      return false;
    }

    this.attemptCount++;

    // Exponential backoff: base * 2^(attempt - 1) + jitter, capped at 30 seconds
    const exponential = this.baseIntervalMs * Math.pow(2, this.attemptCount - 1);
    const jitter = Math.floor(Math.random() * 500);
    const delay = Math.min(exponential + jitter, 30000);

    this.logger.info(
      `Reconnection scheduled: attempt ${this.attemptCount}/${this.maxAttempts} in ${delay}ms`,
    );

    onReconnecting(this.attemptCount, this.maxAttempts);

    this.clearTimer();
    this.reconnectTimer = setTimeout(async () => {
      if (this.isShuttingDown) return;
      try {
        await this.transport.connect();
      } catch (err) {
        this.logger.debug("Reconnection attempt failed:", err);
      }
    }, delay);

    return true;
  }

  private clearTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
