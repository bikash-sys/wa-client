import { describe, it, expect, vi } from "vitest";
import { ConnectionManager } from "../src/connection/connection-manager.js";
import { SilentLogger } from "../src/utils/logger.js";
import type { WhatsAppTransport } from "../src/transport/transport.interface.js";

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
  it("should not schedule reconnect when reconnect is disabled", () => {
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

  it("should track attempt counts and trigger onReconnecting callback", () => {
    const transport = createMockTransport();
    const manager = new ConnectionManager(transport, new SilentLogger(), {
      reconnect: true,
      maxReconnectAttempts: 3,
      reconnectIntervalMs: 100,
    });

    const onReconnecting = vi.fn();
    const onFailed = vi.fn();

    expect(manager.getAttemptCount()).toBe(0);

    const first = manager.scheduleReconnect(onReconnecting, onFailed);
    expect(first).toBe(true);
    expect(manager.getAttemptCount()).toBe(1);
    expect(onReconnecting).toHaveBeenCalledWith(1, 3);

    const second = manager.scheduleReconnect(onReconnecting, onFailed);
    expect(second).toBe(true);
    expect(manager.getAttemptCount()).toBe(2);

    const third = manager.scheduleReconnect(onReconnecting, onFailed);
    expect(third).toBe(true);
    expect(manager.getAttemptCount()).toBe(3);

    // 4th attempt should exceed maxAttempts
    const fourth = manager.scheduleReconnect(onReconnecting, onFailed);
    expect(fourth).toBe(false);
    expect(onFailed).toHaveBeenCalled();

    manager.stop();
  });

  it("should reset attempt count when resetAttempts is called", () => {
    const transport = createMockTransport();
    const manager = new ConnectionManager(transport, new SilentLogger(), {
      maxReconnectAttempts: 5,
    });

    manager.scheduleReconnect(vi.fn(), vi.fn());
    manager.scheduleReconnect(vi.fn(), vi.fn());
    expect(manager.getAttemptCount()).toBe(2);

    manager.resetAttempts();
    expect(manager.getAttemptCount()).toBe(0);
    manager.stop();
  });

  it("should not schedule reconnect if stopped", () => {
    const transport = createMockTransport();
    const manager = new ConnectionManager(transport, new SilentLogger());

    manager.stop();
    const onReconnecting = vi.fn();
    const scheduled = manager.scheduleReconnect(onReconnecting, vi.fn());

    expect(scheduled).toBe(false);
    expect(onReconnecting).not.toHaveBeenCalled();
  });
});
