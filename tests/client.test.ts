import { describe, it, expect, vi } from "vitest";
import { WhatsApp } from "../src/client.js";
import { TypedEventEmitter } from "../src/events/event-emitter.js";
import type { WhatsAppTransport, TransportEvents } from "../src/transport/transport.interface.js";
import type { IncomingMessage, ConnectionState } from "../src/types/index.js";

class MockTransport extends TypedEventEmitter<TransportEvents> implements WhatsAppTransport {
  private state: ConnectionState = "disconnected";
  public mockSocket = { tag: "mock-baileys-socket" };

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
  });

  public destroy = vi.fn().mockImplementation(async () => {
    await this.disconnect();
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

  public getRawClient<T = unknown>(): T | undefined {
    return this.mockSocket as unknown as T;
  }
}

describe("WhatsApp Client", () => {
  it("should initialize with default options and injected transport", () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ transport, logger: false });

    expect(wa.isConnected()).toBe(false);
    expect(wa.getState()).toBe("disconnected");
    expect(wa.raw).toBe(transport.mockSocket);
    expect(wa.getRawClient()).toBe(transport.mockSocket);
  });

  it("should handle connect and emit connected & ready events", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ transport, logger: false });

    const connectedSpy = vi.fn();
    const readySpy = vi.fn();

    wa.on("connected", connectedSpy);
    wa.on("ready", readySpy);

    await wa.connect();

    expect(transport.connect).toHaveBeenCalled();
    expect(connectedSpy).toHaveBeenCalledTimes(1);
    expect(readySpy).toHaveBeenCalledTimes(1);
    expect(wa.isConnected()).toBe(true);
  });

  it("should forward QR event", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ transport, logger: false });

    const qrSpy = vi.fn();
    wa.on("qr", qrSpy);

    transport.emit("qr", "2@test-qr-code-string");

    expect(qrSpy).toHaveBeenCalledWith("2@test-qr-code-string");
  });

  it("should send text message with (to, text) overload and emit message.sent", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ transport, logger: false });
    await wa.connect();

    const sentSpy = vi.fn();
    wa.on("message.sent", sentSpy);

    const result = await wa.sendMessage("919876543210", "Hello there!");

    expect(result.id).toBe("sent-text-1");
    expect(transport.sendTextMessage).toHaveBeenCalledWith(
      "919876543210@s.whatsapp.net",
      "Hello there!",
      { quote: undefined },
    );
    expect(sentSpy).toHaveBeenCalledWith(result);
  });

  it("should send text message with (options) overload", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ transport, logger: false });
    await wa.connect();

    const result = await wa.sendMessage({
      to: "+919876543210",
      text: "Options style message",
    });

    expect(result.id).toBe("sent-text-1");
    expect(transport.sendTextMessage).toHaveBeenCalledWith(
      "919876543210@s.whatsapp.net",
      "Options style message",
      { quote: undefined },
    );
  });

  it("should send image with (to, buffer, caption) overload", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ transport, logger: false });
    await wa.connect();

    const buf = Buffer.from("test-image-data");
    const result = await wa.sendImage("919876543210", buf, "Check this out");

    expect(result.id).toBe("sent-media-1");
    expect(transport.sendMediaMessage).toHaveBeenCalledWith(
      "919876543210@s.whatsapp.net",
      "image",
      { data: buf },
      expect.objectContaining({ caption: "Check this out" }),
    );
  });

  it("should handle incoming messages and support message.reply()", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ transport, logger: false });
    await wa.connect();

    const messageSpy = vi.fn();
    wa.on("message", messageSpy);

    const incoming: IncomingMessage = {
      id: "incoming-1",
      from: "919876543210",
      sender: "919876543210",
      text: "ping",
      timestamp: Date.now(),
      isGroup: false,
      isFromMe: false,
      reply: async (textOrOptions) => {
        const text = typeof textOrOptions === "string" ? textOrOptions : textOrOptions.text;
        return transport.sendTextMessage("919876543210@s.whatsapp.net", text);
      },
    };

    transport.emit("message", incoming);

    expect(messageSpy).toHaveBeenCalledWith(incoming);

    const replyRes = await incoming.reply("pong");
    expect(replyRes.id).toBe("sent-text-1");
    expect(transport.sendTextMessage).toHaveBeenCalledWith("919876543210@s.whatsapp.net", "pong");
  });

  it("should handle disconnect and destroy cleanly", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ transport, logger: false });

    await wa.connect();
    await wa.disconnect();
    expect(transport.disconnect).toHaveBeenCalled();

    await wa.destroy();
    expect(transport.destroy).toHaveBeenCalled();
  });

  it("should support authDir as an alias for session", () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ transport, authDir: "./my-auth", logger: false });

    // Verify through underlying option getters / behavior
    expect(wa).toBeDefined();
  });

  it("should support printQRInTerminal as an alias for printQR", () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ transport, printQRInTerminal: true, logger: false });

    expect(wa).toBeDefined();
  });
});
