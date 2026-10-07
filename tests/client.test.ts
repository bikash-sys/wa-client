import { describe, it, expect, vi } from "vitest";
import { WhatsApp } from "../src/client.js";
import { WhatsAppError } from "../src/errors/errors.js";
import { TypedEventEmitter } from "../src/events/event-emitter.js";
import type { WhatsAppTransport, TransportEvents } from "../src/transport/transport.interface.js";
import type {
  IncomingMessage,
  ConnectionState,
  WhatsAppChat,
  ReconnectInfo,
} from "../src/types/index.js";

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

  public storedChats: WhatsAppChat[] = [];

  public getChats = vi.fn().mockImplementation(async () => {
    return this.storedChats;
  });

  public getMessages = vi.fn().mockResolvedValue([]);
  public pinMessage = vi.fn().mockResolvedValue(undefined);

  public unpinMessage = vi.fn().mockResolvedValue(undefined);

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

  it("should send text message with send() method (primary API)", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ transport, session: "personal", logger: false });
    await wa.connect();

    const sentSpy = vi.fn();
    wa.on("message.sent", sentSpy);

    const result = await wa.send("919340748552", "Hello from send()!");

    expect(result.id).toBe("sent-text-1");
    expect(result.session).toBe("personal");
    expect(transport.sendTextMessage).toHaveBeenCalledWith(
      "919340748552@s.whatsapp.net",
      "Hello from send()!",
      { quote: undefined },
    );
    expect(sentSpy).toHaveBeenCalledWith(result);
  });

  it("should support send() with options object overload", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ transport, session: "business", logger: false });
    await wa.connect();

    const result = await wa.send({
      to: "919340748552",
      text: "Options style message",
    });

    expect(result.id).toBe("sent-text-1");
    expect(result.session).toBe("business");
    expect(transport.sendTextMessage).toHaveBeenCalledWith(
      "919340748552@s.whatsapp.net",
      "Options style message",
      { quote: undefined },
    );
  });

  it("should keep sendMessage() as backwards-compatible alias with send()", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ transport, logger: false });
    await wa.connect();

    const sendRes = await wa.send("919876543210", "Msg 1");
    const sendMsgRes = await wa.sendMessage("919876543210", "Msg 2");

    expect(sendRes.id).toBe("sent-text-1");
    expect(sendMsgRes.id).toBe("sent-text-1");
    expect(transport.sendTextMessage).toHaveBeenCalledTimes(2);
  });

  it("should support all media send methods (sendImage, sendVideo, sendAudio, sendDocument)", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ transport, session: "bot", logger: false });
    await wa.connect();

    const buf = Buffer.from("dummy-buffer-data");

    // sendImage
    const imgRes = await wa.sendImage("919876543210", buf, "Photo caption");
    expect(imgRes.session).toBe("bot");
    expect(transport.sendMediaMessage).toHaveBeenCalledWith(
      "919876543210@s.whatsapp.net",
      "image",
      { data: buf },
      expect.objectContaining({ caption: "Photo caption" }),
    );

    // sendVideo
    const vidRes = await wa.sendVideo("919876543210", buf, "Video caption");
    expect(vidRes.session).toBe("bot");
    expect(transport.sendMediaMessage).toHaveBeenCalledWith(
      "919876543210@s.whatsapp.net",
      "video",
      { data: buf },
      expect.objectContaining({ caption: "Video caption" }),
    );

    // sendAudio
    const audRes = await wa.sendAudio("919876543210", buf, true);
    expect(audRes.session).toBe("bot");
    expect(transport.sendMediaMessage).toHaveBeenCalledWith(
      "919876543210@s.whatsapp.net",
      "audio",
      { data: buf },
      expect.objectContaining({ ptt: true }),
    );

    // sendDocument
    const docRes = await wa.sendDocument("919876543210", buf, "test.pdf", "Doc caption");
    expect(docRes.session).toBe("bot");
    expect(transport.sendMediaMessage).toHaveBeenCalledWith(
      "919876543210@s.whatsapp.net",
      "document",
      { data: buf },
      expect.objectContaining({ filename: "test.pdf", caption: "Doc caption" }),
    );
  });

  it("should support multiple sessions simultaneously in one process", async () => {
    const transportPersonal = new MockTransport();
    const transportBusiness = new MockTransport();

    const personal = new WhatsApp({
      session: "personal",
      transport: transportPersonal,
      logger: false,
    });
    const business = new WhatsApp({
      session: "business",
      transport: transportBusiness,
      logger: false,
    });

    expect(personal.session).toBe("personal");
    expect(business.session).toBe("business");

    await personal.connect();
    await business.connect();

    expect(transportPersonal.connect).toHaveBeenCalledTimes(1);
    expect(transportBusiness.connect).toHaveBeenCalledTimes(1);

    await personal.send("919340748552", "Message from personal");
    await business.send("919340748552", "Message from business");

    expect(transportPersonal.sendTextMessage).toHaveBeenCalledWith(
      "919340748552@s.whatsapp.net",
      "Message from personal",
      { quote: undefined },
    );
    expect(transportBusiness.sendTextMessage).toHaveBeenCalledWith(
      "919340748552@s.whatsapp.net",
      "Message from business",
      { quote: undefined },
    );

    await personal.destroy();
    await business.destroy();
  });

  it("should handle independent QR authentication events per session", async () => {
    const transportPersonal = new MockTransport();
    const transportBusiness = new MockTransport();

    const personal = new WhatsApp({
      session: "personal",
      transport: transportPersonal,
      logger: false,
    });
    const business = new WhatsApp({
      session: "business",
      transport: transportBusiness,
      logger: false,
    });

    const qrPersonalSpy = vi.fn();
    const qrBusinessSpy = vi.fn();

    personal.on("qr", qrPersonalSpy);
    business.on("qr", qrBusinessSpy);

    transportPersonal.emit("qr", "qr-personal-123");
    expect(qrPersonalSpy).toHaveBeenCalledWith("qr-personal-123");
    expect(qrBusinessSpy).not.toHaveBeenCalled();

    transportBusiness.emit("qr", "qr-business-456");
    expect(qrBusinessSpy).toHaveBeenCalledWith("qr-business-456");

    await personal.destroy();
    await business.destroy();
  });

  it("should auto-connect on send() and disconnect for one-shot send", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ transport, session: "auto-conn", logger: false });

    expect(wa.isConnected()).toBe(false);

    const result = await wa.send("919340748552", "Hello via auto-connect!");

    expect(transport.connect).toHaveBeenCalledTimes(1);
    expect(result.id).toBe("sent-text-1");
    // One-shot send auto-disconnects so process can exit cleanly
    expect(transport.disconnect).toHaveBeenCalledTimes(1);
  });

  it("should keep connection alive when keepAlive is true or connect() was called", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({
      transport,
      session: "keep-alive-session",
      keepAlive: true,
      logger: false,
    });

    const result = await wa.send("919340748552", "Persistent message");
    expect(result.id).toBe("sent-text-1");
    expect(wa.isConnected()).toBe(true);
    expect(transport.disconnect).not.toHaveBeenCalled();

    await wa.destroy();
  });

  it("should stay connected across multiple sends when explicitly connected", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ transport, session: "explicit-conn", logger: false });

    await wa.connect();
    expect(transport.connect).toHaveBeenCalledTimes(1);
    expect(wa.isConnected()).toBe(true);

    await wa.send("919340748552", "Msg 1");
    await wa.send("919340748552", "Msg 2");

    expect(transport.connect).toHaveBeenCalledTimes(1);
    expect(transport.sendTextMessage).toHaveBeenCalledTimes(2);
    expect(wa.isConnected()).toBe(true);
    expect(transport.disconnect).not.toHaveBeenCalled();

    await wa.destroy();
  });

  it("should stay connected when active message listeners exist", async () => {
    const transport = new MockTransport();
    const wa = new WhatsApp({ transport, session: "listener-session", logger: false });

    wa.on("message", () => {});

    await wa.send("919340748552", "Message with active listener");
    expect(wa.isConnected()).toBe(true);
    expect(transport.disconnect).not.toHaveBeenCalled();

    await wa.destroy();
  });

  it("should share a single connection attempt across concurrent send() calls", async () => {
    const transport = new MockTransport();
    let resolveConnect!: () => void;
    transport.connect = vi.fn().mockImplementation(() => {
      return new Promise<void>((resolve) => {
        resolveConnect = () => {
          transport.setState("connected");
          transport.emit("connected");
          transport.emit("ready");
          resolve();
        };
      });
    });

    const wa = new WhatsApp({ transport, session: "concurrent-send", logger: false });

    // Launch multiple send calls before connection resolves
    const sendPromise1 = wa.send("919340748552", "Concurrent Msg 1");
    const sendPromise2 = wa.send("919340748552", "Concurrent Msg 2");
    const sendPromise3 = wa.send("919340748552", "Concurrent Msg 3");

    // Only 1 connect call initiated
    expect(transport.connect).toHaveBeenCalledTimes(1);

    // Resolve the connection
    resolveConnect();

    const [res1, res2, res3] = await Promise.all([sendPromise1, sendPromise2, sendPromise3]);

    expect(res1.id).toBe("sent-text-1");
    expect(res2.id).toBe("sent-text-1");
    expect(res3.id).toBe("sent-text-1");
    expect(transport.connect).toHaveBeenCalledTimes(1);
    expect(transport.sendTextMessage).toHaveBeenCalledTimes(3);
  });

  it("should auto-connect two named sessions independently with Promise.all", async () => {
    const transportPersonal = new MockTransport();
    const transportBusiness = new MockTransport();

    const personal = new WhatsApp({
      session: "personal",
      transport: transportPersonal,
      logger: false,
    });
    const business = new WhatsApp({
      session: "business",
      transport: transportBusiness,
      logger: false,
    });

    const [resPersonal, resBusiness] = await Promise.all([
      personal.send("919340748552", "From personal auto"),
      business.send("919340748552", "From business auto"),
    ]);

    expect(transportPersonal.connect).toHaveBeenCalledTimes(1);
    expect(transportBusiness.connect).toHaveBeenCalledTimes(1);
    expect(resPersonal.session).toBe("personal");
    expect(resBusiness.session).toBe("business");

    await personal.destroy();
    await business.destroy();
  });

  it("should handle brand-new session with QR flow during send()", async () => {
    const transport = new MockTransport();
    transport.connect = vi.fn().mockImplementation(async () => {
      // Simulate new session: emit QR, then user scans
      setTimeout(() => {
        transport.emit("qr", "new-session-qr-123");
        setTimeout(() => {
          transport.setState("connected");
          transport.emit("connected");
          transport.emit("ready");
        }, 10);
      }, 5);
    });

    const wa = new WhatsApp({
      transport,
      session: "new-qr-session",
      keepAlive: true,
      logger: false,
    });
    const qrSpy = vi.fn();
    wa.on("qr", qrSpy);

    const result = await wa.send("919340748552", "Message after QR scan");

    expect(qrSpy).toHaveBeenCalledWith("new-session-qr-123");
    expect(result.id).toBe("sent-text-1");
    expect(wa.isConnected()).toBe(true);

    await wa.destroy();
  });

  it("should throw typed ConnectionError if auto-connect fails during send()", async () => {
    const transport = new MockTransport();
    transport.connect = vi.fn().mockRejectedValue(new Error("Network connection refused"));

    const wa = new WhatsApp({ transport, session: "failing-session", logger: false });

    await expect(wa.send("919340748552", "Will fail")).rejects.toThrow(
      /Network connection refused/,
    );
  });

  describe("wa.sendToGroup() API", () => {
    it("1. should send message to group directly using group JID (string overload)", async () => {
      const transport = new MockTransport();
      const wa = new WhatsApp({ transport, session: "group-test", logger: false });
      await wa.connect();

      const groupJid = "120363414422062021@g.us";
      const result = await wa.sendToGroup(groupJid, "Hello group via JID!");

      expect(result.id).toBe("sent-text-1");
      expect(transport.sendTextMessage).toHaveBeenCalledWith(groupJid, "Hello group via JID!", {
        quote: undefined,
      });
      // Ensure getChats was NOT called since JID was provided directly
      expect(transport.getChats).not.toHaveBeenCalled();
    });

    it("1b. should send message to group directly using group JID (options overload)", async () => {
      const transport = new MockTransport();
      const wa = new WhatsApp({ transport, session: "group-test", logger: false });
      await wa.connect();

      const groupJid = "120363414422062021@g.us";
      const result = await wa.sendToGroup(groupJid, { text: "Hello options group!" });

      expect(result.id).toBe("sent-text-1");
      expect(transport.sendTextMessage).toHaveBeenCalledWith(groupJid, "Hello options group!", {
        quote: undefined,
      });
    });

    it("2. should resolve group name and send message using group name", async () => {
      const transport = new MockTransport();
      transport.storedChats = [
        { id: "120363414422062021@g.us", name: "Engineering Team", type: "group" },
        { id: "120363414422062022@g.us", name: "Marketing Team", type: "group" },
        { id: "919876543210@s.whatsapp.net", name: "John Doe", type: "private" },
      ];

      const wa = new WhatsApp({ transport, session: "group-test", logger: false });
      await wa.connect();

      const result = await wa.sendToGroup("Engineering Team", "Hello engineers!");

      expect(result.id).toBe("sent-text-1");
      expect(transport.sendTextMessage).toHaveBeenCalledWith(
        "120363414422062021@g.us",
        "Hello engineers!",
        { quote: undefined },
      );
    });

    it("2b. should resolve group name with options overload", async () => {
      const transport = new MockTransport();
      transport.storedChats = [
        { id: "120363414422062021@g.us", name: "Engineering Team", type: "group" },
      ];

      const wa = new WhatsApp({ transport, session: "group-test", logger: false });
      await wa.connect();

      const result = await wa.sendToGroup("Engineering Team", { text: "Options msg" });

      expect(result.id).toBe("sent-text-1");
      expect(transport.sendTextMessage).toHaveBeenCalledWith(
        "120363414422062021@g.us",
        "Options msg",
        { quote: undefined },
      );
    });

    it("3. should throw clear error when group name is not found", async () => {
      const transport = new MockTransport();
      transport.storedChats = [
        { id: "120363414422062021@g.us", name: "Engineering Team", type: "group" },
      ];

      const wa = new WhatsApp({ transport, session: "group-test", logger: false });
      await wa.connect();

      await expect(wa.sendToGroup("Test", "Hello")).rejects.toThrow("Group not found: Test");
      await expect(wa.sendToGroup("Test", "Hello")).rejects.toMatchObject({
        code: "ERR_GROUP_NOT_FOUND",
      });
    });

    it("3b. should reject invalid/empty group inputs", async () => {
      const transport = new MockTransport();
      const wa = new WhatsApp({ transport, session: "group-test", logger: false });
      await wa.connect();

      // @ts-expect-error invalid group type
      await expect(wa.sendToGroup(123, "Hello")).rejects.toThrow(WhatsAppError);
      await expect(wa.sendToGroup("", "Hello")).rejects.toThrow(WhatsAppError);
      await expect(wa.sendToGroup("   ", "Hello")).rejects.toThrow(WhatsAppError);
    });

    it("4. should throw clear error when multiple groups have duplicate names", async () => {
      const transport = new MockTransport();
      transport.storedChats = [
        { id: "120363414422062021@g.us", name: "Duplicate Team", type: "group" },
        { id: "120363414422062099@g.us", name: "Duplicate Team", type: "group" },
      ];

      const wa = new WhatsApp({ transport, session: "group-test", logger: false });
      await wa.connect();

      await expect(wa.sendToGroup("Duplicate Team", "Hello")).rejects.toThrow(
        "Multiple groups found with name: Duplicate Team. Use the group JID instead.",
      );
      await expect(wa.sendToGroup("Duplicate Team", "Hello")).rejects.toMatchObject({
        code: "ERR_MULTIPLE_GROUPS_FOUND",
      });
    });

    it("5. should ensure existing send() still works unchanged for phones and groups", async () => {
      const transport = new MockTransport();
      const wa = new WhatsApp({ transport, session: "test", logger: false });
      await wa.connect();

      // Send to phone number
      const phoneRes = await wa.send("919876543210", "Direct phone text");
      expect(phoneRes.id).toBe("sent-text-1");
      expect(transport.sendTextMessage).toHaveBeenCalledWith(
        "919876543210@s.whatsapp.net",
        "Direct phone text",
        { quote: undefined },
      );

      // Send directly to group JID via send()
      const groupRes = await wa.send("120363414422062021@g.us", "Direct group text");
      expect(groupRes.id).toBe("sent-text-1");
      expect(transport.sendTextMessage).toHaveBeenCalledWith(
        "120363414422062021@g.us",
        "Direct group text",
        { quote: undefined },
      );
    });

    it("6. should auto-connect and auto-disconnect on one-shot sendToGroup with group name", async () => {
      const transport = new MockTransport();
      transport.storedChats = [{ id: "120363414422062021@g.us", name: "Ops Team", type: "group" }];

      const wa = new WhatsApp({ transport, session: "one-shot-group", logger: false });
      expect(wa.isConnected()).toBe(false);

      const result = await wa.sendToGroup("Ops Team", "Alert message");

      expect(transport.connect).toHaveBeenCalledTimes(1);
      expect(result.id).toBe("sent-text-1");
      expect(transport.sendTextMessage).toHaveBeenCalledWith(
        "120363414422062021@g.us",
        "Alert message",
        { quote: undefined },
      );
      // Auto-disconnects at end of one-shot sendToGroup
      expect(transport.disconnect).toHaveBeenCalledTimes(1);
    });

    it("6b. should keep connection alive when keepAlive is true with sendToGroup", async () => {
      const transport = new MockTransport();
      transport.storedChats = [{ id: "120363414422062021@g.us", name: "Ops Team", type: "group" }];

      const wa = new WhatsApp({
        transport,
        session: "keepalive-group",
        keepAlive: true,
        logger: false,
      });

      const result = await wa.sendToGroup("Ops Team", "Persistent alert");
      expect(result.id).toBe("sent-text-1");
      expect(wa.isConnected()).toBe(true);
      expect(transport.disconnect).not.toHaveBeenCalled();

      await wa.destroy();
    });
  });

  describe("Automatic Reconnection & Session Recovery", () => {
    it("should accept object-based reconnect configuration and emit reconnecting with typed ReconnectInfo payload", async () => {
      const transport = new MockTransport();
      const wa = new WhatsApp({
        transport,
        session: "reconnect-obj-session",
        reconnect: {
          enabled: true,
          maxAttempts: 4,
          delay: 100,
          maxDelay: 1000,
        },
        logger: false,
      });

      await wa.connect();

      const reconnectSpy = vi.fn();
      wa.on("reconnecting", reconnectSpy);

      // Simulate a temporary disconnect (not a logout)
      transport.setState("disconnected");
      transport.emit("disconnected", "connection reset by peer", false);

      expect(reconnectSpy).toHaveBeenCalledTimes(1);
      expect(reconnectSpy).toHaveBeenCalledWith(
        expect.objectContaining<ReconnectInfo>({
          attempt: 1,
          maxAttempts: 4,
          delay: expect.any(Number),
        }),
      );

      await wa.destroy();
    });

    it("should recover from temporary disconnect and reconnect without emitting QR code", async () => {
      const transport = new MockTransport();
      const wa = new WhatsApp({
        transport,
        session: "temp-disconnect-session",
        reconnect: {
          enabled: true,
          maxAttempts: 3,
          delay: 20,
        },
        logger: false,
      });

      const qrSpy = vi.fn();
      const readySpy = vi.fn();
      wa.on("qr", qrSpy);
      wa.on("ready", readySpy);
      await wa.connect();
      expect(readySpy).toHaveBeenCalledTimes(1);

      // Wait for reconnect to complete
      const reconnected = new Promise<void>((resolve) => {
        wa.once("connected", () => resolve());
      });

      // Simulate temporary network drop
      transport.setState("disconnected");
      transport.emit("disconnected", "network timeout", false);

      await reconnected;

      expect(transport.connect).toHaveBeenCalledTimes(2);
      expect(wa.isConnected()).toBe(true);
      // No QR code should have been emitted during reconnection
      expect(qrSpy).not.toHaveBeenCalled();

      await wa.destroy();
    });

    it("should stop reconnection attempts and emit logged_out on permanent logout", async () => {
      const transport = new MockTransport();
      const wa = new WhatsApp({
        transport,
        session: "logout-session",
        reconnect: {
          enabled: true,
          maxAttempts: 5,
          delay: 20,
        },
        logger: false,
      });

      const loggedOutSpy = vi.fn();
      const reconnectSpy = vi.fn();
      wa.on("logged_out", loggedOutSpy);
      wa.on("reconnecting", reconnectSpy);

      await wa.connect();

      // Simulate permanent logout event
      transport.setState("logged_out");
      transport.emit("logged_out");
      transport.emit("disconnected", "logged out by user", true);

      expect(loggedOutSpy).toHaveBeenCalledTimes(1);
      expect(reconnectSpy).not.toHaveBeenCalled();
      expect(wa.isReconnecting()).toBe(false);

      await wa.destroy();
    });

    it("should share the same reconnection attempt across concurrent sends during temporary disconnect", async () => {
      const transport = new MockTransport();
      const connectResolvers: Array<() => void> = [];

      transport.connect = vi.fn().mockImplementation(() => {
        return new Promise<void>((resolve) => {
          connectResolvers.push(() => {
            transport.setState("connected");
            transport.emit("connected");
            transport.emit("ready");
            resolve();
          });
        });
      });

      const wa = new WhatsApp({
        transport,
        session: "concurrent-reconnect-send",
        reconnect: {
          enabled: true,
          maxAttempts: 3,
          delay: 10,
        },
        logger: false,
      });

      // Initial connection
      const initialConnect = wa.connect();
      const firstResolver = connectResolvers.shift();
      if (firstResolver) firstResolver();
      await initialConnect;

      expect(wa.isConnected()).toBe(true);

      // Simulate disconnect
      transport.setState("disconnected");
      transport.emit("disconnected", "temporary drop", false);

      // Issue concurrent sends while disconnected
      const send1 = wa.send("919876543210", "Queued 1");
      const send2 = wa.send("919876543210", "Queued 2");
      const send3 = wa.send("919876543210", "Queued 3");

      // Wait a moment for connection attempt to be scheduled
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Resolve the single in-flight connection
      while (connectResolvers.length > 0) {
        const res = connectResolvers.shift();
        if (res) res();
      }

      const [res1, res2, res3] = await Promise.all([send1, send2, send3]);

      expect(res1.id).toBe("sent-text-1");
      expect(res2.id).toBe("sent-text-1");
      expect(res3.id).toBe("sent-text-1");
      expect(transport.sendTextMessage).toHaveBeenCalledTimes(3);

      await wa.destroy();
    });
  });
});
