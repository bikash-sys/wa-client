import { describe, it, expect, vi } from "vitest";
import { WhatsApp } from "../src/client.js";
import { TypedEventEmitter } from "../src/events/event-emitter.js";
import type { WhatsAppTransport, TransportEvents } from "../src/transport/transport.interface.js";
import type { ConnectionState } from "../src/types/index.js";

class MockTransport extends TypedEventEmitter<TransportEvents> implements WhatsAppTransport {
  private state: ConnectionState = "disconnected";
  public mockSocket = { tag: "mock-baileys-socket" };

  public setState(state: ConnectionState): void {
    this.state = state;
  }

  public connect = vi.fn().mockImplementation(async () => {
    this.state = "connected";
    this.emit("connected");
    this.emit("ready");
  });

  public disconnect = vi.fn().mockImplementation(async () => {
    this.state = "disconnected";
    this.emit("disconnected", "client closed", false);
  });

  public logout = vi.fn().mockImplementation(async () => {
    this.state = "logged_out";
    this.emit("logged_out");
    this.emit("disconnected", "logged out", true);
  });

  public destroy = vi.fn().mockImplementation(async () => {
    this.state = "disconnected";
    this.emit("disconnected", "destroyed", false);
    this.removeAllListeners();
  });

  public isConnected = vi.fn().mockImplementation(() => this.state === "connected");
  public getState = vi.fn().mockImplementation(() => this.state);

  public sendTextMessage = vi.fn().mockResolvedValue({
    id: "sent-text-1",
    to: "919876543210",
    timestamp: 1700000000000,
  });

  public sendMediaMessage = vi.fn().mockResolvedValue({
    id: "sent-media-1",
    to: "919876543210",
    timestamp: 1700000000000,
  });

  public getChats = vi.fn().mockResolvedValue([]);

  public getRawClient<T = unknown>(): T | undefined {
    return this.mockSocket as unknown as T;
  }
}

describe("Health & Connection Status API", () => {
  it("should report initial idle state correctly for new client", () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ session: "test-init", transport, logger: false });

    expect(wa.isConnected()).toBe(false);
    expect(wa.isReady()).toBe(false);
    expect(wa.isReconnecting()).toBe(false);
    expect(wa.getState()).toBe("disconnected");

    const status = wa.getStatus();
    expect(status).toEqual({
      session: "test-init",
      connected: false,
      ready: false,
      reconnecting: false,
      state: "disconnected",
    });

    const health = wa.health();
    expect(health).toEqual({
      healthy: false,
      session: "test-init",
      connected: false,
      ready: false,
      reconnecting: false,
      state: "disconnected",
    });
  });

  it("should report connected and ready state when connection is established", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ session: "test-connected", transport, logger: false });

    await wa.connect();

    expect(wa.isConnected()).toBe(true);
    expect(wa.isReady()).toBe(true);
    expect(wa.isReconnecting()).toBe(false);
    expect(wa.getState()).toBe("connected");

    const status = wa.getStatus();
    expect(status).toEqual({
      session: "test-connected",
      connected: true,
      ready: true,
      reconnecting: false,
      state: "connected",
    });

    const health = wa.health();
    expect(health).toEqual({
      healthy: true,
      session: "test-connected",
      connected: true,
      ready: true,
      reconnecting: false,
      state: "connected",
    });
  });

  it("should report connecting and qr states as not connected and not healthy", () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ session: "test-qr", transport, logger: false });

    // Transition to connecting
    transport.setState("connecting");
    expect(wa.isConnected()).toBe(false);
    expect(wa.isReady()).toBe(false);
    expect(wa.isReconnecting()).toBe(false);
    expect(wa.getState()).toBe("connecting");
    expect(wa.health().healthy).toBe(false);

    // Transition to QR state
    transport.setState("qr");
    expect(wa.isConnected()).toBe(false);
    expect(wa.isReady()).toBe(false);
    expect(wa.isReconnecting()).toBe(false);
    expect(wa.getState()).toBe("qr");
    expect(wa.health().healthy).toBe(false);
  });

  it("should report reconnecting state during temporary disconnection and recovery", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({
      session: "test-reconnect",
      transport,
      logger: false,
      reconnect: true,
      maxReconnectAttempts: 3,
      reconnectIntervalMs: 5000,
    });

    await wa.connect();
    expect(wa.health().healthy).toBe(true);

    // Simulate unexpected network drop from transport
    transport.setState("disconnected");
    transport.emit("disconnected", "Stream error", false);

    expect(wa.isConnected()).toBe(false);
    expect(wa.isReady()).toBe(false);
    expect(wa.isReconnecting()).toBe(true);
    expect(wa.getState()).toBe("reconnecting");

    const status = wa.getStatus();
    expect(status).toEqual({
      session: "test-reconnect",
      connected: false,
      ready: false,
      reconnecting: true,
      state: "reconnecting",
    });

    const health = wa.health();
    expect(health.healthy).toBe(false);
    expect(health.reconnecting).toBe(true);
    expect(health.state).toBe("reconnecting");

    // Clean up
    await wa.disconnect();
  });

  it("should report disconnected state on intentional disconnect", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ session: "test-disconnect", transport, logger: false });

    await wa.connect();
    expect(wa.isConnected()).toBe(true);

    await wa.disconnect();

    expect(wa.isConnected()).toBe(false);
    expect(wa.isReady()).toBe(false);
    expect(wa.isReconnecting()).toBe(false);
    expect(wa.getState()).toBe("disconnected");

    const health = wa.health();
    expect(health.healthy).toBe(false);
    expect(health.reconnecting).toBe(false);
    expect(health.state).toBe("disconnected");
  });

  it("should report logged_out state when session is logged out", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ session: "test-logout", transport, logger: false });

    await wa.connect();
    expect(wa.isConnected()).toBe(true);

    // Simulate remote logout
    transport.setState("logged_out");
    transport.emit("logged_out");

    expect(wa.isConnected()).toBe(false);
    expect(wa.isReady()).toBe(false);
    expect(wa.isReconnecting()).toBe(false);
    expect(wa.getState()).toBe("logged_out");

    const status = wa.getStatus();
    expect(status).toEqual({
      session: "test-logout",
      connected: false,
      ready: false,
      reconnecting: false,
      state: "logged_out",
    });

    const health = wa.health();
    expect(health.healthy).toBe(false);
    expect(health.state).toBe("logged_out");
  });

  it("should maintain independent status and health for multiple sessions", async () => {
    const transport1 = new MockTransport();
    const transport2 = new MockTransport();

    const personal = new WhatsApp({ session: "personal", transport: transport1, logger: false });
    const business = new WhatsApp({ session: "business", transport: transport2, logger: false });

    await personal.connect();

    // personal is connected, business is still disconnected
    expect(personal.isConnected()).toBe(true);
    expect(personal.health().healthy).toBe(true);
    expect(personal.getStatus().session).toBe("personal");

    expect(business.isConnected()).toBe(false);
    expect(business.health().healthy).toBe(false);
    expect(business.getStatus().session).toBe("business");

    // Connect business too
    await business.connect();
    expect(business.isConnected()).toBe(true);
    expect(business.health().healthy).toBe(true);

    // Disconnect personal, business must remain healthy
    await personal.disconnect();
    expect(personal.isConnected()).toBe(false);
    expect(personal.health().healthy).toBe(false);

    expect(business.isConnected()).toBe(true);
    expect(business.health().healthy).toBe(true);

    await business.disconnect();
  });

  it("should have no side effects when calling isConnected, isReady, isReconnecting, getStatus, or health", () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ session: "test-pure", transport, logger: false });

    for (let i = 0; i < 5; i++) {
      expect(wa.isConnected()).toBe(false);
      expect(wa.isReady()).toBe(false);
      expect(wa.isReconnecting()).toBe(false);
      expect(wa.getStatus().state).toBe("disconnected");
      expect(wa.health().healthy).toBe(false);
    }
  });
});
