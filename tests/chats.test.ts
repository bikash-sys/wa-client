import { describe, it, expect, vi, beforeEach } from "vitest";
import { WhatsApp } from "../src/client.js";
import { WhatsAppError } from "../src/errors/errors.js";
import { TypedEventEmitter } from "../src/events/event-emitter.js";
import { BaileysTransport } from "../src/transport/baileys-transport.js";
import type { WhatsAppTransport, TransportEvents } from "../src/transport/transport.interface.js";
import type { ConnectionState, WhatsAppChat, GetChatsOptions } from "../src/types/index.js";
import { SilentLogger } from "../src/utils/logger.js";

class MockTransport extends TypedEventEmitter<TransportEvents> implements WhatsAppTransport {
  private state: ConnectionState = "disconnected";
  public mockSocket = { tag: "mock-baileys-socket" };
  public storedChats: WhatsAppChat[] = [];

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

  public getChats = vi.fn().mockImplementation(async (options?: GetChatsOptions) => {
    const limit = options?.limit ?? 20;
    const type = options?.type ?? "all";

    let filtered = this.storedChats;
    if (type !== "all") {
      filtered = filtered.filter((c) => c.type === type);
    }
    return filtered.slice(0, limit);
  });

  public getRawClient<T = unknown>(): T | undefined {
    return this.mockSocket as unknown as T;
  }
}

describe("wa.getChats() Client API", () => {
  let transport: MockTransport;
  let wa: WhatsApp;

  beforeEach(() => {
    transport = new MockTransport();
    wa = new WhatsApp({ transport, logger: false });
  });

  describe("Options & Limit Validation", () => {
    it("should allow calling getChats with no arguments (default options)", async () => {
      transport.storedChats = [
        { id: "919876543210@s.whatsapp.net", name: "Rahul", type: "private" },
      ];
      await wa.connect();

      const chats = await wa.getChats();
      expect(transport.getChats).toHaveBeenCalledWith({ limit: 20, type: "all" });
      expect(chats).toHaveLength(1);
      expect(chats[0].name).toBe("Rahul");
    });

    it("should accept valid custom limit and type", async () => {
      await wa.connect();
      await wa.getChats({ limit: 5, type: "private" });
      expect(transport.getChats).toHaveBeenCalledWith({ limit: 5, type: "private" });

      await wa.getChats({ limit: 10, type: "group" });
      expect(transport.getChats).toHaveBeenCalledWith({ limit: 10, type: "group" });

      await wa.getChats({ limit: 100, type: "all" });
      expect(transport.getChats).toHaveBeenCalledWith({ limit: 100, type: "all" });
    });

    it("should reject limit = 0", async () => {
      await expect(wa.getChats({ limit: 0 })).rejects.toThrow(WhatsAppError);
      await expect(wa.getChats({ limit: 0 })).rejects.toMatchObject({
        code: "ERR_INVALID_OPTIONS",
      });
    });

    it("should reject negative numbers", async () => {
      await expect(wa.getChats({ limit: -1 })).rejects.toThrow(WhatsAppError);
      await expect(wa.getChats({ limit: -5 })).rejects.toMatchObject({
        code: "ERR_INVALID_OPTIONS",
      });
    });

    it("should reject decimal/float limits", async () => {
      await expect(wa.getChats({ limit: 5.5 })).rejects.toThrow(WhatsAppError);
      await expect(wa.getChats({ limit: 1.2 })).rejects.toMatchObject({
        code: "ERR_INVALID_OPTIONS",
      });
    });

    it("should reject NaN and Infinity", async () => {
      await expect(wa.getChats({ limit: NaN })).rejects.toThrow(WhatsAppError);
      await expect(wa.getChats({ limit: Infinity })).rejects.toThrow(WhatsAppError);
      await expect(wa.getChats({ limit: -Infinity })).rejects.toThrow(WhatsAppError);
    });

    it("should reject limits greater than 100", async () => {
      await expect(wa.getChats({ limit: 101 })).rejects.toThrow(WhatsAppError);
      await expect(wa.getChats({ limit: 500 })).rejects.toMatchObject({
        code: "ERR_INVALID_OPTIONS",
      });
    });

    it("should reject non-number types for limit", async () => {
      // @ts-expect-error testing invalid type
      await expect(wa.getChats({ limit: "5" })).rejects.toThrow(WhatsAppError);
      // @ts-expect-error testing invalid type
      await expect(wa.getChats({ limit: null })).rejects.toThrow(WhatsAppError);
      // @ts-expect-error testing invalid type
      await expect(wa.getChats({ limit: true })).rejects.toThrow(WhatsAppError);
    });

    it("should reject invalid type filter values", async () => {
      // @ts-expect-error testing invalid type
      await expect(wa.getChats({ type: "invalid" })).rejects.toThrow(WhatsAppError);
      // @ts-expect-error testing invalid type
      await expect(wa.getChats({ type: "broadcast" })).rejects.toMatchObject({
        code: "ERR_INVALID_OPTIONS",
      });
    });
  });

  describe("Automatic Connection Behavior", () => {
    it("should automatically connect when disconnected and keepAlive is true", async () => {
      const customWa = new WhatsApp({ transport, logger: false, keepAlive: true });
      expect(customWa.isConnected()).toBe(false);

      transport.storedChats = [
        { id: "919876543210@s.whatsapp.net", name: "Rahul", type: "private" },
      ];

      const chats = await customWa.getChats({ limit: 5 });
      expect(transport.connect).toHaveBeenCalled();
      expect(chats).toHaveLength(1);
    });

    it("should handle error if connection fails during getChats", async () => {
      transport.connect = vi.fn().mockRejectedValue(new Error("Connection timeout"));
      await expect(wa.getChats()).rejects.toThrow();
    });
  });
});

describe("BaileysTransport Chat Processing & Sorting", () => {
  let transport: BaileysTransport;

  beforeEach(() => {
    transport = new BaileysTransport({
      sessionPath: "./.temp/test-chats-transport",
      sessionName: "test-session",
      logger: new SilentLogger(),
    });
  });

  it("should return empty list when no chats have synced", async () => {
    const chats = await transport.getChats();
    expect(chats).toEqual([]);
  });

  it("should process and categorize private and group chats from chats.upsert", async () => {
    // Access the private method via any for unit testing Baileys event processing
    const transportAny = transport as unknown as {
      upsertChatFromBaileys: (chat: unknown) => void;
    };

    transportAny.upsertChatFromBaileys({
      id: "919876543210@s.whatsapp.net",
      name: "Rahul",
      conversationTimestamp: 1759123400,
    });

    transportAny.upsertChatFromBaileys({
      id: "120363123456789@g.us",
      name: "VAJRAX Robotics",
      conversationTimestamp: 1759123000,
    });

    const allChats = await transport.getChats({ type: "all" });
    expect(allChats).toHaveLength(2);
    expect(allChats[0]).toEqual({
      id: "919876543210@s.whatsapp.net",
      name: "Rahul",
      type: "private",
      timestamp: 1759123400,
    });
    expect(allChats[1]).toEqual({
      id: "120363123456789@g.us",
      name: "VAJRAX Robotics",
      type: "group",
      timestamp: 1759123000,
    });

    const privateOnly = await transport.getChats({ type: "private" });
    expect(privateOnly).toHaveLength(1);
    expect(privateOnly[0].id).toBe("919876543210@s.whatsapp.net");
    expect(privateOnly[0].type).toBe("private");

    const groupOnly = await transport.getChats({ type: "group" });
    expect(groupOnly).toHaveLength(1);
    expect(groupOnly[0].id).toBe("120363123456789@g.us");
    expect(groupOnly[0].type).toBe("group");
  });

  it("should exclude newsletter, status, broadcast, and lid chats", async () => {
    const transportAny = transport as unknown as {
      upsertChatFromBaileys: (chat: unknown) => void;
    };

    transportAny.upsertChatFromBaileys({
      id: "120363999999999@newsletter",
      name: "Tech News",
      conversationTimestamp: 1759123500,
    });

    transportAny.upsertChatFromBaileys({
      id: "status@broadcast",
      name: "Status",
      conversationTimestamp: 1759123500,
    });

    transportAny.upsertChatFromBaileys({
      id: "12345678@lid",
      name: "LID User",
      conversationTimestamp: 1759123500,
    });

    transportAny.upsertChatFromBaileys({
      id: "919876543210@s.whatsapp.net",
      name: "Valid User",
      conversationTimestamp: 1759123400,
    });

    const chats = await transport.getChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].id).toBe("919876543210@s.whatsapp.net");
  });

  it("should sort chats descending by most recent activity timestamp", async () => {
    const transportAny = transport as unknown as {
      upsertChatFromBaileys: (chat: unknown) => void;
    };

    transportAny.upsertChatFromBaileys({
      id: "1111111111@s.whatsapp.net",
      name: "Old Chat",
      conversationTimestamp: 1000,
    });

    transportAny.upsertChatFromBaileys({
      id: "2222222222@s.whatsapp.net",
      name: "Newest Chat",
      conversationTimestamp: 3000,
    });

    transportAny.upsertChatFromBaileys({
      id: "3333333333@s.whatsapp.net",
      name: "Middle Chat",
      conversationTimestamp: 2000,
    });

    const chats = await transport.getChats();
    expect(chats.map((c) => c.name)).toEqual(["Newest Chat", "Middle Chat", "Old Chat"]);
  });

  it("should place chats without timestamps after chats with timestamps", async () => {
    const transportAny = transport as unknown as {
      upsertChatFromBaileys: (chat: unknown) => void;
    };

    transportAny.upsertChatFromBaileys({
      id: "1111111111@s.whatsapp.net",
      name: "No Timestamp Chat",
    });

    transportAny.upsertChatFromBaileys({
      id: "2222222222@s.whatsapp.net",
      name: "Active Chat",
      conversationTimestamp: 2000,
    });

    const chats = await transport.getChats();
    expect(chats[0].name).toBe("Active Chat");
    expect(chats[1].name).toBe("No Timestamp Chat");
    expect(chats[1].timestamp).toBeUndefined();
  });

  it("should respect limit option when returning results", async () => {
    const transportAny = transport as unknown as {
      upsertChatFromBaileys: (chat: unknown) => void;
    };

    for (let i = 1; i <= 10; i++) {
      transportAny.upsertChatFromBaileys({
        id: `91987654321${i}@s.whatsapp.net`,
        name: `User ${i}`,
        conversationTimestamp: 1000 + i,
      });
    }

    const chats = await transport.getChats({ limit: 3 });
    expect(chats).toHaveLength(3);
    expect(chats[0].name).toBe("User 10");
    expect(chats[1].name).toBe("User 9");
    expect(chats[2].name).toBe("User 8");
  });

  describe("Name Resolution & Fallbacks", () => {
    it("should use group subject from groupMetadataCache for groups", async () => {
      const transportAny = transport as unknown as {
        groupMetadataCache: Map<string, { subject?: string }>;
        upsertChatFromBaileys: (chat: unknown) => void;
      };

      transportAny.groupMetadataCache.set("120363123456789@g.us", {
        subject: "Robotics Club",
      });

      transportAny.upsertChatFromBaileys({
        id: "120363123456789@g.us",
        conversationTimestamp: 1759123000,
      });

      const chats = await transport.getChats();
      expect(chats[0].name).toBe("Robotics Club");
    });

    it("should fallback to JID for groups when no subject or chat name is available", async () => {
      const transportAny = transport as unknown as {
        upsertChatFromBaileys: (chat: unknown) => void;
      };

      transportAny.upsertChatFromBaileys({
        id: "120363123456789@g.us",
        conversationTimestamp: 1759123000,
      });

      const chats = await transport.getChats();
      expect(chats[0].name).toBe("120363123456789@g.us");
    });

    it("should resolve contact name, notify/push name, or fallback to phone for private chats", async () => {
      const transportAny = transport as unknown as {
        contacts: Map<string, { name?: string; notify?: string }>;
        upsertChatFromBaileys: (chat: unknown) => void;
      };

      // 1. Saved contact name
      transportAny.contacts.set("919876543210@s.whatsapp.net", { name: "Saved Rahul" });
      transportAny.upsertChatFromBaileys({
        id: "919876543210@s.whatsapp.net",
      });

      // 2. Notify / Push name only
      transportAny.contacts.set("919876543211@s.whatsapp.net", { notify: "Push Rahul" });
      transportAny.upsertChatFromBaileys({
        id: "919876543211@s.whatsapp.net",
      });

      // 3. No contact info -> fallback to normalized phone
      transportAny.upsertChatFromBaileys({
        id: "919876543212@s.whatsapp.net",
      });

      const chats = await transport.getChats();
      const chatMap = new Map(chats.map((c) => [c.id, c.name]));

      expect(chatMap.get("919876543210@s.whatsapp.net")).toBe("Saved Rahul");
      expect(chatMap.get("919876543211@s.whatsapp.net")).toBe("Push Rahul");
      expect(chatMap.get("919876543212@s.whatsapp.net")).toBe("919876543212");
    });
  });

  describe("Message Extraction from Baileys Messages", () => {
    it("should extract conversation text", async () => {
      const transportAny = transport as unknown as {
        updateChatFromMessage: (wam: unknown) => void;
      };

      transportAny.updateChatFromMessage({
        key: { remoteJid: "919876543210@s.whatsapp.net", id: "msg-1" },
        message: { conversation: "Hello there!" },
        messageTimestamp: 1759123400,
        pushName: "Alice",
      });

      const chats = await transport.getChats();
      expect(chats[0].lastMessage).toBe("Hello there!");
      expect(chats[0].name).toBe("Alice");
      expect(chats[0].timestamp).toBe(1759123400);
    });

    it("should extract extendedTextMessage text", async () => {
      const transportAny = transport as unknown as {
        updateChatFromMessage: (wam: unknown) => void;
      };

      transportAny.updateChatFromMessage({
        key: { remoteJid: "919876543210@s.whatsapp.net", id: "msg-2" },
        message: { extendedTextMessage: { text: "Extended formatted text" } },
        messageTimestamp: 1759123401,
      });

      const chats = await transport.getChats();
      expect(chats[0].lastMessage).toBe("Extended formatted text");
    });

    it("should extract captions from image, video, and document messages", async () => {
      const transportAny = transport as unknown as {
        updateChatFromMessage: (wam: unknown) => void;
      };

      transportAny.updateChatFromMessage({
        key: { remoteJid: "919876543210@s.whatsapp.net", id: "img-1" },
        message: { imageMessage: { caption: "Check out this photo" } },
        messageTimestamp: 1759123402,
      });

      let chats = await transport.getChats();
      expect(chats[0].lastMessage).toBe("Check out this photo");

      transportAny.updateChatFromMessage({
        key: { remoteJid: "919876543210@s.whatsapp.net", id: "vid-1" },
        message: { videoMessage: { caption: "Video recap" } },
        messageTimestamp: 1759123403,
      });

      chats = await transport.getChats();
      expect(chats[0].lastMessage).toBe("Video recap");

      transportAny.updateChatFromMessage({
        key: { remoteJid: "919876543210@s.whatsapp.net", id: "doc-1" },
        message: { documentMessage: { caption: "Q3 Report PDF" } },
        messageTimestamp: 1759123404,
      });

      chats = await transport.getChats();
      expect(chats[0].lastMessage).toBe("Q3 Report PDF");
    });

    it("should return undefined for lastMessage on media-only or unsupported messages without throwing", async () => {
      const transportAny = transport as unknown as {
        updateChatFromMessage: (wam: unknown) => void;
      };

      transportAny.updateChatFromMessage({
        key: { remoteJid: "919876543210@s.whatsapp.net", id: "audio-1" },
        message: { audioMessage: { ptt: true } },
        messageTimestamp: 1759123405,
      });

      const chats = await transport.getChats();
      expect(chats).toHaveLength(1);
      expect(chats[0].lastMessage).toBeUndefined();
      expect(chats[0].timestamp).toBe(1759123405);
    });
  });

  describe("Multi-Session Isolation", () => {
    it("should maintain independent chat stores across multiple sessions", async () => {
      const personalTransport = new BaileysTransport({
        sessionPath: "./.temp/test-personal-session",
        sessionName: "personal",
        logger: new SilentLogger(),
      });

      const businessTransport = new BaileysTransport({
        sessionPath: "./.temp/test-business-session",
        sessionName: "business",
        logger: new SilentLogger(),
      });

      const personalAny = personalTransport as unknown as {
        upsertChatFromBaileys: (chat: unknown) => void;
      };
      const businessAny = businessTransport as unknown as {
        upsertChatFromBaileys: (chat: unknown) => void;
      };

      personalAny.upsertChatFromBaileys({
        id: "919876543210@s.whatsapp.net",
        name: "Personal Friend",
        conversationTimestamp: 1759123400,
      });

      businessAny.upsertChatFromBaileys({
        id: "120363123456789@g.us",
        name: "Business Team",
        conversationTimestamp: 1759123500,
      });

      const personalChats = await personalTransport.getChats();
      const businessChats = await businessTransport.getChats();

      expect(personalChats).toHaveLength(1);
      expect(personalChats[0].name).toBe("Personal Friend");

      expect(businessChats).toHaveLength(1);
      expect(businessChats[0].name).toBe("Business Team");
    });
  });

  describe("Updates, Deletions & Edge Cases", () => {
    it("should update existing chats on chats.update", async () => {
      const transportAny = transport as unknown as {
        upsertChatFromBaileys: (chat: unknown) => void;
        updateChatFromBaileys: (update: unknown) => void;
      };

      transportAny.upsertChatFromBaileys({
        id: "919876543210@s.whatsapp.net",
        name: "Old Name",
        conversationTimestamp: 1000,
      });

      transportAny.updateChatFromBaileys({
        id: "919876543210@s.whatsapp.net",
        name: "New Name",
        conversationTimestamp: 2000,
      });

      const chats = await transport.getChats();
      expect(chats).toHaveLength(1);
      expect(chats[0].name).toBe("New Name");
      expect(chats[0].timestamp).toBe(2000);
    });

    it("should remove deleted chats on chats.delete", async () => {
      const transportAny = transport as unknown as {
        upsertChatFromBaileys: (chat: unknown) => void;
        chats: Map<string, unknown>;
      };

      transportAny.upsertChatFromBaileys({
        id: "919876543210@s.whatsapp.net",
        name: "To Delete",
        conversationTimestamp: 1000,
      });

      expect(await transport.getChats()).toHaveLength(1);

      // Simulate delete
      transportAny.chats.delete("919876543210@s.whatsapp.net");
      expect(await transport.getChats()).toHaveLength(0);
    });

    it("should safely handle malformed chat entries without throwing", async () => {
      const transportAny = transport as unknown as {
        upsertChatFromBaileys: (chat: unknown) => void;
        updateChatFromBaileys: (update: unknown) => void;
        updateChatFromMessage: (wam: unknown) => void;
      };

      expect(() => {
        transportAny.upsertChatFromBaileys({});
        // @ts-expect-error null chat
        transportAny.upsertChatFromBaileys(null);
        transportAny.upsertChatFromBaileys({ id: 12345 });
        transportAny.updateChatFromBaileys({});
        // @ts-expect-error null update
        transportAny.updateChatFromBaileys(null);
        transportAny.updateChatFromMessage({});
        // @ts-expect-error null wam
        transportAny.updateChatFromMessage(null);
      }).not.toThrow();

      const chats = await transport.getChats();
      expect(chats).toEqual([]);
    });

    it("should handle Long protobuf timestamp objects", async () => {
      const transportAny = transport as unknown as {
        upsertChatFromBaileys: (chat: unknown) => void;
      };

      const mockLong = {
        toNumber: () => 1759123400,
      };

      transportAny.upsertChatFromBaileys({
        id: "919876543210@s.whatsapp.net",
        name: "Long Ts User",
        conversationTimestamp: mockLong,
      });

      const chats = await transport.getChats();
      expect(chats[0].timestamp).toBe(1759123400);
    });

    it("should clear chat cache on logout and destroy", async () => {
      const transportAny = transport as unknown as {
        upsertChatFromBaileys: (chat: unknown) => void;
      };

      transportAny.upsertChatFromBaileys({
        id: "919876543210@s.whatsapp.net",
        name: "User",
        conversationTimestamp: 1000,
      });

      expect(await transport.getChats()).toHaveLength(1);

      await transport.destroy();
      expect(await transport.getChats()).toHaveLength(0);
    });
  });
});
