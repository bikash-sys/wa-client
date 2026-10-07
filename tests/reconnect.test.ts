import { describe, it, expect, vi } from "vitest";
import { ConnectionManager } from "../src/connection/connection-manager.js";
import { SilentLogger } from "../src/utils/logger.js";
import { ConnectionError } from "../src/errors/errors.js";
import type { WhatsAppTransport } from "../src/transport/transport.interface.js";
import type { ReconnectInfo } from "../src/types/index.js";

function createMockTransport(): WhatsAppTransport {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(false),
    getState: vi.fn().mockReturnValue("disconnected"),
    sendTextMessage: vi.fn(),
    sendMediaMessage: vi.fn(),
    getRawClient: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
    listenerCount: vi.fn(),
  } as unknown as WhatsAppTransport;
}

describe("ConnectionManager", () => {
  it("should not schedule reconnect when reconnect is disabled via boolean false", () => {
    const transport = createMockTransport();
    const manager = new ConnectionManager(transport, new SilentLogger(), {
      reconnect: false,
    });

    const onReconnecting = vi.fn();
    const onFailed = vi.fn();

    const scheduled = manager.scheduleReconnect(onReconnecting, onFailed);
    expect(scheduled).toBe(false);
    expect(onReconnecting).not.toHaveBeenCalled();
  });

  it("should not schedule reconnect when reconnect is disabled via object config", () => {
    const transport = createMockTransport();
    const manager = new ConnectionManager(transport, new SilentLogger(), {
      reconnect: {
        enabled: false,
        maxAttempts: 10,
        delay: 1000,
      },
    });

    const onReconnecting = vi.fn();
    const onFailed = vi.fn();

    const scheduled = manager.scheduleReconnect(onReconnecting, onFailed);
    expect(scheduled).toBe(false);
    expect(onReconnecting).not.toHaveBeenCalled();
  });

  it("should configure manager using object-based reconnect configuration", () => {
    const transport = createMockTransport();
    const manager = new ConnectionManager(transport, new SilentLogger(), {
      reconnect: {
        enabled: true,
        maxAttempts: 8,
        delay: 1500,
        maxDelay: 12000,
      },
    });

    expect(manager.getMaxAttempts()).toBe(8);
    expect(manager.getBaseIntervalMs()).toBe(1500);
    expect(manager.getMaxDelayMs()).toBe(12000);
  });

  it("should maintain backwards compatibility with flat config options", () => {
    const transport = createMockTransport();
    const manager = new ConnectionManager(transport, new SilentLogger(), {
      reconnect: true,
      maxReconnectAttempts: 4,
      reconnectIntervalMs: 2500,
      maxDelayMs: 20000,
    });

    expect(manager.getMaxAttempts()).toBe(4);
    expect(manager.getBaseIntervalMs()).toBe(2500);
    expect(manager.getMaxDelayMs()).toBe(20000);
  });

  it("should track attempt counts and trigger onReconnecting callback with typed ReconnectInfo payload", () => {
    const transport = createMockTransport();
    const manager = new ConnectionManager(transport, new SilentLogger(), {
      reconnect: {
        enabled: true,
        maxAttempts: 3,
        delay: 100,
        maxDelay: 5000,
      },
    });

    const onReconnecting = vi.fn();
    const onFailed = vi.fn();

    expect(manager.getAttemptCount()).toBe(0);

    const first = manager.scheduleReconnect(onReconnecting, onFailed);
    expect(first).toBe(true);
    expect(manager.getAttemptCount()).toBe(1);
    expect(onReconnecting).toHaveBeenCalledWith(
      expect.objectContaining<ReconnectInfo>({
        attempt: 1,
        maxAttempts: 3,
        delay: expect.any(Number),
      }),
    );

    // Stop timer to allow simulating next attempt
    manager.resetAttempts();
    expect(manager.getAttemptCount()).toBe(0);
  });

  it("should enforce exponential backoff and never exceed maxDelay cap", () => {
    const transport = createMockTransport();
    const maxDelay = 3000;
    const manager = new ConnectionManager(transport, new SilentLogger(), {
      reconnect: {
        enabled: true,
        maxAttempts: 5,
        delay: 1000,
        maxDelay,
      },
    });

    const delays: number[] = [];
    const onReconnecting = vi.fn().mockImplementation((info: ReconnectInfo) => {
      delays.push(info.delay);
    });
    const onFailed = vi.fn();

    for (let i = 0; i < 5; i++) {
      manager.scheduleReconnect(onReconnecting, onFailed);
      // Verify delay is within bounds
      expect(delays[i]).toBeLessThanOrEqual(maxDelay);
      // Clear timer so next iteration can simulate next attempt
      (manager as unknown as { reconnectTimer: NodeJS.Timeout | null }).reconnectTimer = null;
    }

    expect(delays.length).toBe(5);
    for (const d of delays) {
      expect(d).toBeLessThanOrEqual(maxDelay);
    }
    manager.stop();
  });

  it("should prevent reconnect storms by ignoring duplicate triggers while timer is pending", () => {
    const transport = createMockTransport();
    const manager = new ConnectionManager(transport, new SilentLogger(), {
      reconnect: {
        enabled: true,
        maxAttempts: 5,
        delay: 5000,
      },
    });

    const onReconnecting = vi.fn();
    const onFailed = vi.fn();

    // First schedule
    const first = manager.scheduleReconnect(onReconnecting, onFailed);
    expect(first).toBe(true);
    expect(manager.getAttemptCount()).toBe(1);
    expect(onReconnecting).toHaveBeenCalledTimes(1);

    // Rapid successive schedule calls while timer is pending
    const second = manager.scheduleReconnect(onReconnecting, onFailed);
    const third = manager.scheduleReconnect(onReconnecting, onFailed);

    expect(second).toBe(true);
    expect(third).toBe(true);
    // Attempts must NOT be incremented for duplicate triggers
    expect(manager.getAttemptCount()).toBe(1);
    expect(onReconnecting).toHaveBeenCalledTimes(1);

    manager.stop();
  });

  it("should fail and trigger onFailed when max reconnect attempts are exceeded", () => {
    const transport = createMockTransport();
    const manager = new ConnectionManager(transport, new SilentLogger(), {
      reconnect: {
        enabled: true,
        maxAttempts: 2,
        delay: 100,
      },
    });

    const onReconnecting = vi.fn();
    const onFailed = vi.fn();

    // Attempt 1
    manager.scheduleReconnect(onReconnecting, onFailed);
    expect(manager.getAttemptCount()).toBe(1);
    (manager as unknown as { reconnectTimer: NodeJS.Timeout | null }).reconnectTimer = null;

    // Attempt 2
    manager.scheduleReconnect(onReconnecting, onFailed);
    expect(manager.getAttemptCount()).toBe(2);
    (manager as unknown as { reconnectTimer: NodeJS.Timeout | null }).reconnectTimer = null;

    // Attempt 3 (exceeds maxAttempts: 2)
    const third = manager.scheduleReconnect(onReconnecting, onFailed);
    expect(third).toBe(false);
    expect(onFailed).toHaveBeenCalledWith(expect.any(ConnectionError));
    expect(manager.isReconnecting()).toBe(false);

    manager.stop();
  });

  it("should reset attempt count when resetAttempts is called", () => {
    const transport = createMockTransport();
    const manager = new ConnectionManager(transport, new SilentLogger(), {
      maxReconnectAttempts: 5,
    });

    manager.scheduleReconnect(vi.fn(), vi.fn());
    expect(manager.getAttemptCount()).toBe(1);

    manager.resetAttempts();
    expect(manager.getAttemptCount()).toBe(0);
    expect(manager.isReconnecting()).toBe(false);
    manager.stop();
  });

  it("should not schedule reconnect if stopped and allow scheduling after resume", () => {
    const transport = createMockTransport();
    const manager = new ConnectionManager(transport, new SilentLogger());

    manager.stop();
    const onReconnecting = vi.fn();
    expect(manager.scheduleReconnect(onReconnecting, vi.fn())).toBe(false);
    expect(onReconnecting).not.toHaveBeenCalled();

    manager.resume();
    expect(manager.scheduleReconnect(onReconnecting, vi.fn())).toBe(true);
    expect(onReconnecting).toHaveBeenCalledTimes(1);
    manager.stop();
  });

  it("should accurately report isReconnecting status", () => {
    const transport = createMockTransport();
    const manager = new ConnectionManager(transport, new SilentLogger(), {
      reconnect: true,
      maxReconnectAttempts: 2,
      reconnectIntervalMs: 100,
    });

    expect(manager.isReconnecting()).toBe(false);

    manager.scheduleReconnect(vi.fn(), vi.fn());
    expect(manager.isReconnecting()).toBe(true);

    manager.resetAttempts();
    expect(manager.isReconnecting()).toBe(false);

    manager.scheduleReconnect(vi.fn(), vi.fn());
    expect(manager.isReconnecting()).toBe(true);

    manager.stop();
    expect(manager.isReconnecting()).toBe(false);
  });
});
