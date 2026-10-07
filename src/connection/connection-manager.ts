import type { Logger } from "../utils/logger.js";
import type { WhatsAppTransport } from "../transport/transport.interface.js";
import type { ReconnectOptions, ReconnectInfo } from "../types/index.js";
import { DEFAULT_CONFIG } from "../config.js";
import { ConnectionError } from "../errors/errors.js";

export interface ReconnectConfig {
  reconnect?: boolean | ReconnectOptions;
  maxReconnectAttempts?: number;
  reconnectIntervalMs?: number;
  maxDelayMs?: number;
}

/**
 * Manages reconnection logic with exponential backoff, maximum delay caps,
 * attempt limits, and duplicate reconnect storm prevention.
 */
export class ConnectionManager {
  private transport: WhatsAppTransport;
  private logger: Logger;
  private reconnectEnabled: boolean;
  private maxAttempts: number;
  private baseIntervalMs: number;
  private maxDelayMs: number;
  private attemptCount = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private isReconnectingFlag = false;

  constructor(transport: WhatsAppTransport, logger: Logger, config: ReconnectConfig = {}) {
    this.transport = transport;
    this.logger = logger;

    if (typeof config.reconnect === "object" && config.reconnect !== null) {
      this.reconnectEnabled = config.reconnect.enabled ?? true;
      this.maxAttempts =
        config.reconnect.maxAttempts ??
        config.maxReconnectAttempts ??
        DEFAULT_CONFIG.MAX_RECONNECT_ATTEMPTS;
      this.baseIntervalMs =
        config.reconnect.delay ??
        config.reconnectIntervalMs ??
        DEFAULT_CONFIG.RECONNECT_INTERVAL_MS;
      this.maxDelayMs =
        config.reconnect.maxDelay ?? config.maxDelayMs ?? DEFAULT_CONFIG.MAX_RECONNECT_DELAY_MS;
    } else {
      this.reconnectEnabled = config.reconnect ?? DEFAULT_CONFIG.RECONNECT;
      this.maxAttempts = config.maxReconnectAttempts ?? DEFAULT_CONFIG.MAX_RECONNECT_ATTEMPTS;
      this.baseIntervalMs = config.reconnectIntervalMs ?? DEFAULT_CONFIG.RECONNECT_INTERVAL_MS;
      this.maxDelayMs = config.maxDelayMs ?? DEFAULT_CONFIG.MAX_RECONNECT_DELAY_MS;
    }
  }

  public isReconnecting(): boolean {
    return this.isReconnectingFlag && !this.isShuttingDown;
  }

  public getAttemptCount(): number {
    return this.attemptCount;
  }

  public getMaxAttempts(): number {
    return this.maxAttempts;
  }

  public getBaseIntervalMs(): number {
    return this.baseIntervalMs;
  }

  public getMaxDelayMs(): number {
    return this.maxDelayMs;
  }

  public resetAttempts(): void {
    this.attemptCount = 0;
    this.isReconnectingFlag = false;
    this.clearTimer();
  }

  public stop(): void {
    this.isShuttingDown = true;
    this.isReconnectingFlag = false;
    this.clearTimer();
  }

  public resume(): void {
    this.isShuttingDown = false;
  }

  /**
   * Schedules a reconnection attempt using exponential backoff with jitter and maxDelay cap.
   * Prevents reconnect storms if a timer is already pending.
   * Calls onReconnecting callback with typed ReconnectInfo payload.
   */
  public scheduleReconnect(
    onReconnecting: (info: ReconnectInfo) => void,
    onFailed: (err: ConnectionError) => void,
  ): boolean {
    if (this.isShuttingDown || !this.reconnectEnabled) {
      this.logger.debug("Automatic reconnection is disabled or client is stopping.");
      this.isReconnectingFlag = false;
      return false;
    }

    // Storm prevention: if a reconnection timer is already active, do not spawn another
    if (this.reconnectTimer !== null) {
      this.logger.debug(
        `Reconnection attempt already scheduled (attempt ${this.attemptCount}/${this.maxAttempts}), skipping duplicate schedule.`,
      );
      return true;
    }

    if (this.attemptCount >= this.maxAttempts) {
      this.isReconnectingFlag = false;
      this.clearTimer();
      const err = new ConnectionError(
        `Failed to reconnect to WhatsApp after ${this.maxAttempts} attempts`,
        "ERR_MAX_RECONNECT_REACHED",
      );
      this.logger.error(err.message);
      onFailed(err);
      return false;
    }

    this.attemptCount++;
    this.isReconnectingFlag = true;

    // Exponential backoff: base * 2^(attempt - 1) + jitter, strictly capped at maxDelayMs
    const exponential = this.baseIntervalMs * Math.pow(2, this.attemptCount - 1);
    const maxJitter = Math.min(500, exponential);
    const jitter = Math.floor(Math.random() * maxJitter);
    const delay = Math.min(exponential + jitter, this.maxDelayMs);

    const info: ReconnectInfo = {
      attempt: this.attemptCount,
      delay,
      maxAttempts: this.maxAttempts,
    };

    this.logger.info(
      `Reconnection scheduled: attempt ${this.attemptCount}/${this.maxAttempts} in ${delay}ms`,
    );

    onReconnecting(info);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
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
