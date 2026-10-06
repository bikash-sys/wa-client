import { describe, it, expect, vi, beforeEach } from "vitest";
import { WhatsApp } from "../src/client.js";
import { BaileysTransport } from "../src/transport/baileys-transport.js";
import { WhatsAppError, ConnectionError, MessageError } from "../src/errors/errors.js";
import type { WhatsAppTransport, TransportEvents } from "../src/transport/transport.interface.js";
import type { ConnectionState, WhatsAppMessageKey } from "../src/types/index.js";
import { TypedEventEmitter } from "../src/events/event-emitter.js";

class MockTransport extends TypedEventEmitter<TransportEvents> implements WhatsAppTransport {
  private state: ConnectionState = "connected";

  public connect = vi.fn().mockResolvedValue(undefined);
  public disconnect = vi.fn().mockResolvedValue(undefined);
  public logout = vi.fn().mockResolvedValue(undefined);
  public destroy = vi.fn().mockResolvedValue(undefined);
  public isConnected = vi.fn().mockImplementation(() => this.state === "connected");
  public getState = vi.fn().mockImplementation(() => this.state);
  public sendTextMessage = vi.fn();
  public sendMediaMessage = vi.fn();
  public getChats = vi.fn().mockResolvedValue([]);
  public pinMessage = vi.fn().mockResolvedValue(undefined);
  public unpinMessage = vi.fn().mockResolvedValue(undefined);
  public getRawClient<T = unknown>(): T | undefined {
    return undefined;
  }

  public setState(s: ConnectionState): void {
    this.state = s;
  }
}

describe("Message Pinning & Unpinning API", () => {
  let transport: MockTransport;
  let wa: WhatsApp;

  beforeEach(() => {
    transport = new MockTransport();
    wa = new WhatsApp({ transport, session: "test-pin" });
  });

  describe("wa.pinMessage()", () => {
    it("1. pinMessage(message) defaults to 30 days (2,592,000 seconds)", async () => {
      const messageKey: WhatsAppMessageKey = {
        remoteJid: "120363414422062021@g.us",
        id: "MSG_ID_123",
        participant: "919876543210@s.whatsapp.net",
      };

      await wa.pinMessage(messageKey);

      expect(transport.pinMessage).toHaveBeenCalledTimes(1);
      expect(transport.pinMessage).toHaveBeenCalledWith(messageKey, 2592000);
    });

    it("2. pinMessage(message, 1) uses 86400 seconds", async () => {
      const messageKey: WhatsAppMessageKey = {
        remoteJid: "919876543210@s.whatsapp.net",
        id: "MSG_ID_1",
      };

      await wa.pinMessage(messageKey, 1);

      expect(transport.pinMessage).toHaveBeenCalledWith(messageKey, 86400);
    });

    it("3. pinMessage(message, 7) uses 604800 seconds", async () => {
      const messageKey: WhatsAppMessageKey = {
        remoteJid: "120363414422062021@g.us",
        id: "MSG_ID_7",
      };

      await wa.pinMessage(messageKey, 7);

      expect(transport.pinMessage).toHaveBeenCalledWith(messageKey, 604800);
    });

    it("4. pinMessage(message, 30) uses 2592000 seconds", async () => {
      const messageKey: WhatsAppMessageKey = {
        remoteJid: "120363414422062021@g.us",
        id: "MSG_ID_30",
      };

      await wa.pinMessage(messageKey, 30);

      expect(transport.pinMessage).toHaveBeenCalledWith(messageKey, 2592000);
    });

    it("5. Invalid duration throws WhatsAppError", async () => {
      const messageKey: WhatsAppMessageKey = {
        remoteJid: "120363414422062021@g.us",
        id: "MSG_ID_INVALID",
      };

      // @ts-expect-error Testing runtime validation of invalid duration
      await expect(wa.pinMessage(messageKey, 15)).rejects.toThrow(WhatsAppError);
      // @ts-expect-error Testing runtime validation of invalid duration
      await expect(wa.pinMessage(messageKey, 0)).rejects.toThrow(WhatsAppError);
      // @ts-expect-error Testing runtime validation of invalid duration
      await expect(wa.pinMessage(messageKey, -1)).rejects.toThrow(WhatsAppError);
      // @ts-expect-error Testing runtime validation of invalid duration
      await expect(wa.pinMessage(messageKey, "30")).rejects.toThrow(WhatsAppError);
    });

    it("6. Missing message key fields throws WhatsAppError", async () => {
      // @ts-expect-error Testing missing object
      await expect(wa.pinMessage(null)).rejects.toThrow(WhatsAppError);
      // @ts-expect-error Testing missing remoteJid
      await expect(wa.pinMessage({ id: "123" })).rejects.toThrow(WhatsAppError);
      // @ts-expect-error Testing empty remoteJid
      await expect(wa.pinMessage({ remoteJid: "", id: "123" })).rejects.toThrow(WhatsAppError);
      // @ts-expect-error Testing missing id
      await expect(wa.pinMessage({ remoteJid: "120363414422062021@g.us" })).rejects.toThrow(
        WhatsAppError,
      );
      // @ts-expect-error Testing empty id
      await expect(wa.pinMessage({ remoteJid: "120363414422062021@g.us", id: "" })).rejects.toThrow(
        WhatsAppError,
      );
    });

    it("10. Transport errors are propagated using the package's existing error behavior", async () => {
      const messageKey: WhatsAppMessageKey = {
        remoteJid: "120363414422062021@g.us",
        id: "MSG_ID_ERR",
      };

      transport.pinMessage.mockRejectedValueOnce(
        new MessageError("Failed to pin message", "ERR_PIN_MESSAGE_FAILED"),
      );

      await expect(wa.pinMessage(messageKey)).rejects.toThrow(MessageError);
    });
  });

  describe("wa.unpinMessage()", () => {
    it("7. unpinMessage(message) sends the correct unpin operation", async () => {
      const messageKey: WhatsAppMessageKey = {
        remoteJid: "120363414422062021@g.us",
        id: "MSG_ID_UNPIN",
      };

      await wa.unpinMessage(messageKey);

      expect(transport.unpinMessage).toHaveBeenCalledTimes(1);
      expect(transport.unpinMessage).toHaveBeenCalledWith(messageKey);
    });

    it("missing message key fields in unpinMessage throws WhatsAppError", async () => {
      // @ts-expect-error Testing null message key
      await expect(wa.unpinMessage(null)).rejects.toThrow(WhatsAppError);
      // @ts-expect-error Testing missing remoteJid
      await expect(wa.unpinMessage({ id: "123" })).rejects.toThrow(WhatsAppError);
    });
  });

  describe("BaileysTransport Socket Payload Assertions", () => {
    it("8, 9. passes correct JID, key, and pin payload to Baileys socket", async () => {
      const mockSendMessage = vi.fn().mockResolvedValue({ key: { id: "res-id" } });
      const mockSocket = {
        sendMessage: mockSendMessage,
      };

      const baileysTransport = new BaileysTransport({
        sessionPath: "./.temp/test-pin-baileys",
        sessionName: "test-baileys",
      });
      (baileysTransport as unknown as { socket: unknown; state: string }).socket = mockSocket;
      (baileysTransport as unknown as { socket: unknown; state: string }).state = "connected";

      const groupKey: WhatsAppMessageKey = {
        remoteJid: "120363414422062021@g.us",
        id: "MSG_12345",
        participant: "919876543210@s.whatsapp.net",
        fromMe: false,
      };

      // Test pin
      await baileysTransport.pinMessage(groupKey, 604800);

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).toHaveBeenCalledWith("120363414422062021@g.us", {
        pin: {
          remoteJid: "120363414422062021@g.us",
          id: "MSG_12345",
          participant: "919876543210@s.whatsapp.net",
          fromMe: false,
        },
        type: 1,
        time: 604800,
      });

      // Test unpin
      await baileysTransport.unpinMessage(groupKey);

      expect(mockSendMessage).toHaveBeenCalledTimes(2);
      expect(mockSendMessage).toHaveBeenLastCalledWith("120363414422062021@g.us", {
        pin: {
          remoteJid: "120363414422062021@g.us",
          id: "MSG_12345",
          participant: "919876543210@s.whatsapp.net",
          fromMe: false,
        },
        type: 2,
      });
    });

    it("throws ConnectionError when BaileysTransport is not connected", async () => {
      const baileysTransport = new BaileysTransport({
        sessionPath: "./.temp/test-pin-disc",
        sessionName: "test-disconnected",
      });
      const messageKey: WhatsAppMessageKey = {
        remoteJid: "919876543210@s.whatsapp.net",
        id: "MSG_DISC",
      };

      await expect(baileysTransport.pinMessage(messageKey, 86400)).rejects.toThrow(ConnectionError);
      await expect(baileysTransport.unpinMessage(messageKey)).rejects.toThrow(ConnectionError);
    });
  });
});
