import fs from "node:fs";
import path from "node:path";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
  type WAMessage,
  type AnyMessageContent,
  type proto,
  type Chat,
  type ChatUpdate,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import { TypedEventEmitter } from "../events/event-emitter.js";
import { SessionStore } from "../auth/session-store.js";
import { WhatsAppError, ConnectionError, MessageError } from "../errors/errors.js";
import { createPinoLogger, type Logger } from "../utils/logger.js";
import { patchLibsignalLogs } from "../utils/patch-libsignal.js";
import { jidToPhoneNumber } from "../utils/phone.js";
import type {
  ConnectionState,
  GetChatsOptions,
  IncomingMessage,
  MessageOptions,
  SentMessage,
  WhatsAppChat,
} from "../types/index.js";
import type {
  MediaPayload,
  TransportEvents,
  TransportMediaOptions,
  TransportTextOptions,
  WhatsAppTransport,
} from "./transport.interface.js";

/**
 * Extracts plain text from various WhatsApp message types.
 */
function extractText(message: proto.IMessage | null | undefined): string | undefined {
  if (!message) return undefined;
  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.imageMessage?.caption ??
    message.videoMessage?.caption ??
    message.documentMessage?.caption ??
    undefined
  );
}

/**
 * Safely parses timestamps from Baileys which may be numbers, Longs, strings, or undefined.
 * Normalizes all timestamps to standard Unix seconds.
 */
function parseTimestamp(ts: unknown): number | undefined {
  if (ts === null || ts === undefined) return undefined;
  if (typeof ts === "number") {
    if (Number.isNaN(ts) || !Number.isFinite(ts) || ts <= 0) return undefined;
    return ts > 100_000_000_000 ? Math.floor(ts / 1000) : Math.floor(ts);
  }
  if (
    typeof ts === "object" &&
    ts !== null &&
    "toNumber" in ts &&
    typeof (ts as { toNumber: () => number }).toNumber === "function"
  ) {
    const num = (ts as { toNumber: () => number }).toNumber();
    return parseTimestamp(num);
  }
  if (typeof ts === "string") {
    const parsed = Number(ts);
    return parseTimestamp(parsed);
  }
  return undefined;
}

/**
 * Determines whether a JID belongs to a private 1-on-1 chat or a group chat.
 * Returns null for status, broadcast, newsletter, or unsupported JIDs.
 */
function getChatType(jid: string): "private" | "group" | null {
  if (typeof jid !== "string") return null;
  if (jid.endsWith("@g.us")) return "group";
  if (jid.endsWith("@s.whatsapp.net")) return "private";
  return null;
}

interface CachedChat {
  id: string;
  name?: string;
  type: "private" | "group";
  lastMessage?: string;
  timestamp?: number;
}

interface CachedContact {
  name?: string;
  notify?: string;
}

interface CachedGroup {
  subject?: string;
}

/**
 * Baileys-based implementation of the WhatsAppTransport interface.
 */
export class BaileysTransport
  extends TypedEventEmitter<TransportEvents>
  implements WhatsAppTransport
{
  private socket: WASocket | null = null;
  private sessionStore: SessionStore;
  private sessionName: string;
  private logger: Logger;
  private printQR: boolean;
  private qrCount = 0;
  private state: ConnectionState = "disconnected";
  private isExplicitDisconnect = false;
  private isExplicitDestroy = false;

  private chats = new Map<string, CachedChat>();
  private contacts = new Map<string, CachedContact>();
  private groupMetadataCache = new Map<string, CachedGroup>();

  constructor(options: {
    sessionPath: string;
    sessionName?: string;
    logger: Logger;
    printQR?: boolean;
    printQRInTerminal?: boolean;
  }) {
    super();
    // Suppress sensitive cryptographic session state logged by libsignal internals
    patchLibsignalLogs();
    this.sessionName = options.sessionName ?? "default";
    this.logger = options.logger;
    this.printQR = Boolean(options.printQRInTerminal ?? options.printQR ?? false);
    this.sessionStore = new SessionStore(options.sessionPath, this.logger);
    this.loadChatsFromDisk();
  }

  public isConnected(): boolean {
    return this.state === "connected";
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public getRawClient<T = unknown>(): T | undefined {
    return (this.socket as unknown as T) ?? undefined;
  }

  /**
   * Initializes the Baileys socket and connects to WhatsApp Web servers.
   */
  public async connect(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") {
      this.logger.debug(`Already in state "${this.state}", skipping connect.`);
      return;
    }

    this.isExplicitDisconnect = false;
    this.setState("connecting");

    try {
      this.sessionStore.validate();
      this.loadChatsFromDisk();

      const { state: authState, saveCreds } = await useMultiFileAuthState(
        this.sessionStore.getPath(),
      );

      let version: [number, number, number] | undefined;
      try {
        const versionInfo = await fetchLatestBaileysVersion();
        version = versionInfo.version;
      } catch {
        this.logger.debug("Could not fetch latest Baileys version online, using defaults.");
      }

      const pinoLogger = createPinoLogger(this.logger);

      const sock = makeWASocket({
        auth: authState,
        version,
        logger: pinoLogger,
        printQRInTerminal: false, // We control terminal rendering explicitly for cleaner UI
        syncFullHistory: true,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false,
      });

      this.socket = sock;

      // Persist credentials on update
      sock.ev.on("creds.update", saveCreds);

      // Connection lifecycle updates
      sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.setState("qr");
          if (this.printQR) {
            this.renderTerminalQR(qr);
          }
          this.emit("qr", qr);
        }

        if (connection === "open") {
          this.qrCount = 0;
          this.setState("connected");
          this.logger.info("WhatsApp connection established.");
          // Proactively fetch participating groups in background
          void this.syncParticipatingGroups();
          this.emit("connected");
          this.emit("ready");
        } else if (connection === "close") {
          this.qrCount = 0;
          const error = lastDisconnect?.error as
            { output?: { statusCode?: number }; message?: string } | undefined;
          const statusCode = error?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;

          this.logger.debug(
            `Connection closed. Status: ${statusCode ?? "unknown"}, loggedOut: ${isLoggedOut}`,
          );

          if (isLoggedOut) {
            this.setState("logged_out");
            this.sessionStore.clear();
            this.chats.clear();
            this.contacts.clear();
            this.groupMetadataCache.clear();
            this.emit("logged_out");
            this.emit("disconnected", "User logged out from WhatsApp", true);
          } else {
            this.setState("disconnected");
            if (!this.isExplicitDisconnect && !this.isExplicitDestroy) {
              const reason = error?.message || `Disconnect statusCode: ${statusCode ?? "unknown"}`;
              this.emit("disconnected", reason, false);
            }
          }
        }
      });

      // Handle history sync
      sock.ev.on("messaging-history.set", ({ chats, contacts, messages }) => {
        if (contacts) {
          for (const c of contacts) {
            if (c && c.id) {
              const existing = this.contacts.get(c.id) || {};
              this.contacts.set(c.id, {
                name: c.name ?? existing.name,
                notify: c.notify ?? existing.notify,
              });
            }
          }
        }

        if (chats) {
          for (const chat of chats) {
            if (chat && chat.id) {
              this.upsertChatFromBaileys(chat);
            }
          }
        }

        if (messages) {
          for (const msg of messages) {
            if (msg && msg.key?.remoteJid) {
              this.updateChatFromMessage(msg);
            }
          }
        }

        this.saveChatsToDisk();
      });

      // Handle chats upsert & update
      sock.ev.on("chats.upsert", (newChats) => {
        for (const chat of newChats) {
          if (chat && chat.id) {
            this.upsertChatFromBaileys(chat);
          }
        }
        this.saveChatsToDisk();
      });

      sock.ev.on("chats.update", (updates) => {
        for (const update of updates) {
          if (update && update.id) {
            this.updateChatFromBaileys(update);
          }
        }
        this.saveChatsToDisk();
      });

      sock.ev.on("chats.delete", (deletedIds) => {
        for (const id of deletedIds) {
          if (id) {
            this.chats.delete(id);
          }
        }
        this.saveChatsToDisk();
      });

      // Handle contacts
      sock.ev.on("contacts.upsert", (newContacts) => {
        for (const c of newContacts) {
          if (c && c.id) {
            const existing = this.contacts.get(c.id) || {};
            this.contacts.set(c.id, {
              name: c.name ?? existing.name,
              notify: c.notify ?? existing.notify,
            });
          }
        }
        this.saveChatsToDisk();
      });

      sock.ev.on("contacts.update", (updates) => {
        for (const c of updates) {
          if (c && c.id) {
            const existing = this.contacts.get(c.id) || {};
            this.contacts.set(c.id, {
              name: c.name ?? existing.name,
              notify: c.notify ?? existing.notify,
            });
          }
        }
        this.saveChatsToDisk();
      });

      // Handle groups
      sock.ev.on("groups.upsert", (groups) => {
        for (const g of groups) {
          if (g && g.id) {
            this.groupMetadataCache.set(g.id, { subject: g.subject });
            const existing = this.chats.get(g.id);
            this.chats.set(g.id, {
              id: g.id,
              name: g.subject || existing?.name,
              type: "group",
              lastMessage: existing?.lastMessage,
              timestamp: existing?.timestamp,
            });
          }
        }
        this.saveChatsToDisk();
      });

      sock.ev.on("groups.update", (updates) => {
        for (const g of updates) {
          if (g && g.id) {
            const cached = this.groupMetadataCache.get(g.id);
            const subject = g.subject ?? cached?.subject;
            if (subject) {
              this.groupMetadataCache.set(g.id, { subject });
              const existing = this.chats.get(g.id);
              if (existing) {
                existing.name = subject;
              }
            }
          }
        }
        this.saveChatsToDisk();
      });

      // Handle incoming messages
      sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify" && type !== "append") return;

        for (const wam of messages) {
          if (wam.key?.remoteJid) {
            this.updateChatFromMessage(wam);
          }
          if (!wam.message) continue;

          // Prevent processing protocol sync stubs
          if (wam.messageStubType) continue;

          const incoming = this.normalizeIncomingMessage(wam);
          this.emit("message", incoming);
        }
      });
    } catch (err) {
      this.setState("disconnected");
      const connectionErr = new ConnectionError(
        `Failed to establish WhatsApp connection: ${err instanceof Error ? err.message : String(err)}`,
        "ERR_CONNECTION_INIT_FAILED",
        err,
      );
      this.emit("error", connectionErr);
      throw connectionErr;
    }
  }

  /**
   * Disconnects the socket without revoking credentials.
   */
  public async disconnect(): Promise<void> {
    this.qrCount = 0;
    this.isExplicitDisconnect = true;
    if (this.socket) {
      try {
        this.socket.end(undefined);
      } catch (err) {
        this.logger.debug("Error while ending socket:", err);
      }
      this.socket = null;
    }
    this.setState("disconnected");
  }

  /**
   * Logs out from WhatsApp, revoking credentials and clearing session data.
   */
  public async logout(): Promise<void> {
    this.qrCount = 0;
    this.isExplicitDisconnect = true;
    if (this.socket) {
      try {
        await this.socket.logout();
      } catch (err) {
        this.logger.debug("Error during socket logout:", err);
      }
      this.socket = null;
    }
    this.chats.clear();
    this.contacts.clear();
    this.groupMetadataCache.clear();
    this.sessionStore.clear();
    this.setState("logged_out");
    this.emit("logged_out");
  }

  /**
   * Completely destroys the transport, closing sockets and removing all event listeners.
   */
  public async destroy(): Promise<void> {
    this.qrCount = 0;
    this.isExplicitDestroy = true;
    this.chats.clear();
    this.contacts.clear();
    this.groupMetadataCache.clear();
    await this.disconnect();
    this.removeAllListeners();
  }

  /**
   * Synchronizes participating groups with WhatsApp server if socket is connected.
   */
  private async syncParticipatingGroups(): Promise<void> {
    if (!this.socket) return;
    const rawSock = this.socket as {
      groupFetchAllParticipating?: () => Promise<
        Record<string, { subject?: string; creation?: number }>
      >;
    };
    if (typeof rawSock.groupFetchAllParticipating === "function") {
      try {
        const groups = await rawSock.groupFetchAllParticipating();
        if (groups && typeof groups === "object") {
          for (const [id, meta] of Object.entries(groups)) {
            if (!id || typeof id !== "string") continue;
            const subject = meta?.subject;
            if (subject) {
              this.groupMetadataCache.set(id, { subject });
            }
            const existing = this.chats.get(id);
            this.chats.set(id, {
              id,
              name: subject || existing?.name,
              type: "group",
              lastMessage: existing?.lastMessage,
              timestamp: parseTimestamp(meta?.creation) ?? existing?.timestamp,
            });
          }
          this.saveChatsToDisk();
        }
      } catch (err) {
        this.logger.debug("Failed to sync participating groups:", err);
      }
    }
  }

  private loadChatsFromDisk(): void {
    try {
      const sessionDir = this.sessionStore.getPath();
      const filePath = path.join(sessionDir, "chats-store.json");
      if (!fs.existsSync(filePath)) return;

      const raw = fs.readFileSync(filePath, "utf-8");
      if (!raw.trim()) return;

      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed.chats)) {
          for (const c of parsed.chats) {
            if (c && typeof c.id === "string" && (c.type === "private" || c.type === "group")) {
              this.chats.set(c.id, c as CachedChat);
            }
          }
        }
        if (parsed.contacts && typeof parsed.contacts === "object") {
          for (const [id, contact] of Object.entries(parsed.contacts)) {
            if (contact && typeof contact === "object") {
              this.contacts.set(id, contact as CachedContact);
            }
          }
        }
        if (parsed.groups && typeof parsed.groups === "object") {
          for (const [id, group] of Object.entries(parsed.groups)) {
            if (group && typeof group === "object") {
              this.groupMetadataCache.set(id, group as CachedGroup);
            }
          }
        }
      }
    } catch (err) {
      this.logger.debug("Failed to load cached chats from disk:", err);
    }
  }

  private saveChatsToDisk(): void {
    try {
      const sessionDir = this.sessionStore.getPath();
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
      }

      const filePath = path.join(sessionDir, "chats-store.json");
      const data = {
        chats: Array.from(this.chats.values()),
        contacts: Object.fromEntries(this.contacts.entries()),
        groups: Object.fromEntries(this.groupMetadataCache.entries()),
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      this.logger.debug("Failed to save chats to disk:", err);
    }
  }

  /**
   * Returns active chats sorted by most recent activity descending.
   */
  public async getChats(options?: GetChatsOptions): Promise<WhatsAppChat[]> {
    const limit = options?.limit ?? 20;
    const typeFilter = options?.type ?? "all";

    // If connected, sync participating groups to capture any server-side additions or name changes
    if (this.state === "connected" && this.socket) {
      await this.syncParticipatingGroups();
    }

    const results: WhatsAppChat[] = [];

    for (const chat of this.chats.values()) {
      if (typeFilter !== "all" && chat.type !== typeFilter) {
        continue;
      }

      let name = chat.name;
      if (chat.type === "group") {
        const groupMeta = this.groupMetadataCache.get(chat.id);
        name = groupMeta?.subject || name || chat.id;
      } else {
        const contact = this.contacts.get(chat.id);
        name = contact?.name || contact?.notify || name || jidToPhoneNumber(chat.id) || chat.id;
      }

      const item: WhatsAppChat = {
        id: chat.id,
        name,
        type: chat.type,
      };

      if (chat.lastMessage !== undefined) {
        item.lastMessage = chat.lastMessage;
      }
      if (chat.timestamp !== undefined) {
        item.timestamp = chat.timestamp;
      }

      results.push(item);
    }

    // Sort descending by timestamp. Chats with missing timestamps go last.
    results.sort((a, b) => {
      if (a.timestamp !== undefined && b.timestamp !== undefined) {
        return b.timestamp - a.timestamp;
      }
      if (a.timestamp !== undefined && b.timestamp === undefined) {
        return -1;
      }
      if (a.timestamp === undefined && b.timestamp !== undefined) {
        return 1;
      }
      return 0;
    });

    return results.slice(0, limit);
  }

  private upsertChatFromBaileys(chat: Partial<Chat> | null | undefined): void {
    if (!chat || typeof chat !== "object") return;
    const jid = chat.id;
    if (!jid || typeof jid !== "string") return;
    const chatType = getChatType(jid);
    if (!chatType) return; // Skip status, newsletter, broadcast, etc.

    const existing = this.chats.get(jid);
    const ts =
      parseTimestamp(chat.conversationTimestamp) ??
      parseTimestamp(chat.lastMsgTimestamp) ??
      parseTimestamp(chat.lastMessageRecvTimestamp) ??
      existing?.timestamp;

    let lastMsg: string | undefined = existing?.lastMessage;
    if (Array.isArray(chat.messages) && chat.messages.length > 0) {
      const latest = chat.messages[0];
      const text = extractText(
        (latest?.message as proto.IMessage | undefined) ??
          (latest as { message?: { message?: proto.IMessage } })?.message?.message,
      );
      if (text !== undefined) {
        lastMsg = text;
      }
    }

    const name = chat.name || existing?.name;

    this.chats.set(jid, {
      id: jid,
      name,
      type: chatType,
      lastMessage: lastMsg,
      timestamp: ts,
    });
    this.saveChatsToDisk();
  }

  private updateChatFromBaileys(update: ChatUpdate | null | undefined): void {
    if (!update || typeof update !== "object") return;
    const jid = update.id;
    if (!jid || typeof jid !== "string") return;
    const chatType = getChatType(jid);
    if (!chatType) return;

    const existing = this.chats.get(jid);
    const ts =
      parseTimestamp(update.conversationTimestamp) ??
      parseTimestamp(update.timestamp) ??
      existing?.timestamp;

    const name = update.name || existing?.name;

    this.chats.set(jid, {
      id: jid,
      name,
      type: chatType,
      lastMessage: existing?.lastMessage,
      timestamp: ts,
    });
    this.saveChatsToDisk();
  }

  private updateChatFromMessage(wam: WAMessage | null | undefined): void {
    if (!wam || typeof wam !== "object") return;
    const remoteJid = wam.key?.remoteJid;
    if (!remoteJid || typeof remoteJid !== "string") return;
    const chatType = getChatType(remoteJid);
    if (!chatType) return;

    const existing = this.chats.get(remoteJid);
    const msgTs = parseTimestamp(wam.messageTimestamp);
    const text = extractText(wam.message);

    if (wam.pushName && !wam.key?.fromMe) {
      const senderJid = wam.key?.participant || remoteJid;
      const existingContact = this.contacts.get(senderJid) || {};
      this.contacts.set(senderJid, {
        ...existingContact,
        notify: wam.pushName,
      });
    }

    const currentTs = existing?.timestamp;
    const shouldUpdateTs = msgTs !== undefined && (currentTs === undefined || msgTs >= currentTs);

    this.chats.set(remoteJid, {
      id: remoteJid,
      name: existing?.name,
      type: chatType,
      lastMessage: text !== undefined ? text : existing?.lastMessage,
      timestamp: shouldUpdateTs ? msgTs : currentTs,
    });
    this.saveChatsToDisk();
  }

  /**
   * Sends a plain text message.
   */
  public async sendTextMessage(
    toJid: string,
    text: string,
    options?: TransportTextOptions,
  ): Promise<SentMessage> {
    if (!this.socket || this.state !== "connected") {
      throw new ConnectionError(
        "Cannot send message: WhatsApp is not connected",
        "ERR_NOT_CONNECTED",
      );
    }

    try {
      const content: AnyMessageContent = { text };
      const rawQuoted = options?.quote as WAMessage | undefined;
      const sendOptions = rawQuoted ? { quoted: rawQuoted } : undefined;

      const sent = await this.socket.sendMessage(toJid, content, sendOptions);
      if (!sent || !sent.key) {
        throw new MessageError("No response received from WhatsApp when sending message");
      }

      if (sent.key.remoteJid) {
        this.updateChatFromMessage(sent);
      }

      const timestamp =
        typeof sent.messageTimestamp === "number" ? sent.messageTimestamp * 1000 : Date.now();

      return {
        id: sent.key.id || "",
        to: jidToPhoneNumber(toJid),
        timestamp,
        session: this.sessionName,
        raw: sent,
      };
    } catch (err) {
      if (err instanceof WhatsAppError) throw err;
      throw new MessageError(
        `Failed to send text message to ${toJid}: ${err instanceof Error ? err.message : String(err)}`,
        "ERR_SEND_TEXT_FAILED",
        err,
      );
    }
  }

  /**
   * Sends a media message (image, video, audio, document).
   */
  public async sendMediaMessage(
    toJid: string,
    mediaType: "image" | "video" | "audio" | "document",
    payload: MediaPayload,
    options?: TransportMediaOptions,
  ): Promise<SentMessage> {
    if (!this.socket || this.state !== "connected") {
      throw new ConnectionError(
        "Cannot send media: WhatsApp is not connected",
        "ERR_NOT_CONNECTED",
      );
    }

    try {
      const mediaSource = payload.path ? { url: payload.path } : (payload.data as Buffer);
      let content: AnyMessageContent;

      switch (mediaType) {
        case "image":
          content = {
            image: mediaSource,
            caption: options?.caption,
            mimetype: options?.mimetype,
          };
          break;
        case "video":
          content = {
            video: mediaSource,
            caption: options?.caption,
            mimetype: options?.mimetype,
            ptv: options?.ptv,
          };
          break;
        case "audio":
          content = {
            audio: mediaSource,
            ptt: options?.ptt,
            mimetype: options?.mimetype ?? "audio/mp4",
          };
          break;
        case "document":
          content = {
            document: mediaSource,
            fileName: options?.filename ?? "document",
            mimetype: options?.mimetype ?? "application/octet-stream",
            caption: options?.caption,
          };
          break;
      }

      const rawQuoted = options?.quote as WAMessage | undefined;
      const sendOptions = rawQuoted ? { quoted: rawQuoted } : undefined;

      const sent = await this.socket.sendMessage(toJid, content, sendOptions);
      if (!sent || !sent.key) {
        throw new MessageError("No response received from WhatsApp when sending media");
      }

      if (sent.key.remoteJid) {
        this.updateChatFromMessage(sent);
      }

      const timestamp =
        typeof sent.messageTimestamp === "number" ? sent.messageTimestamp * 1000 : Date.now();

      return {
        id: sent.key.id || "",
        to: jidToPhoneNumber(toJid),
        timestamp,
        session: this.sessionName,
        raw: sent,
      };
    } catch (err) {
      if (err instanceof WhatsAppError) throw err;
      throw new MessageError(
        `Failed to send ${mediaType} message to ${toJid}: ${err instanceof Error ? err.message : String(err)}`,
        "ERR_SEND_MEDIA_FAILED",
        err,
      );
    }
  }

  private normalizeIncomingMessage(wam: WAMessage): IncomingMessage {
    const key = wam.key;
    const remoteJid =
      key.remoteJid || (key as unknown as { remoteJidAlt?: string }).remoteJidAlt || "";
    const isGroup = remoteJid.endsWith("@g.us");
    const isFromMe = Boolean(key.fromMe);

    // In groups, participant is the sender; in 1-on-1 chats, remoteJid is the sender
    const sender = key.participant
      ? jidToPhoneNumber(key.participant)
      : jidToPhoneNumber(remoteJid);
    const from = isGroup ? remoteJid : jidToPhoneNumber(remoteJid);

    const text = extractText(wam.message);
    const timestamp =
      typeof wam.messageTimestamp === "number" ? wam.messageTimestamp * 1000 : Date.now();

    const incoming: IncomingMessage = {
      id: key.id || "",
      from,
      sender,
      text,
      timestamp,
      isGroup,
      isFromMe,
      session: this.sessionName,
      raw: wam,
      reply: async (textOrOptions: string | Omit<MessageOptions, "to">): Promise<SentMessage> => {
        if (!remoteJid) {
          throw new MessageError(
            "Cannot reply: recipient JID is missing in the incoming message",
            "ERR_MISSING_REPLY_TARGET",
          );
        }
        if (typeof textOrOptions === "string") {
          return this.sendTextMessage(remoteJid, textOrOptions, { quote: wam });
        }
        return this.sendTextMessage(remoteJid, textOrOptions.text, {
          quote: textOrOptions.quote ?? wam,
        });
      },
    };

    return incoming;
  }

  private setState(newState: ConnectionState): void {
    this.state = newState;
  }

  private renderTerminalQR(qrString: string): void {
    const generate = getQRGenerator();
    if (!generate) {
      this.logger.error("qrcode-terminal is not available for terminal QR rendering.");
      return;
    }

    try {
      generate(qrString, { small: true }, (asciiQR: string) => {
        // In interactive TTY environments, clear terminal on QR refreshes to avoid terminal flooding
        if (this.qrCount > 0 && process.stdout.isTTY) {
          console.clear();
        }
        this.qrCount++;

        console.log("\nScan this QR code with WhatsApp:\n");
        console.log(asciiQR);
        if (this.qrCount > 1) {
          console.log(`(QR refreshed - attempt ${this.qrCount})\n`);
        } else {
          console.log("(Open WhatsApp → Linked Devices → Link a Device)\n");
        }
      });
    } catch (err) {
      this.logger.error("Failed to render QR in terminal:", err);
    }
  }
}

type QRGenerator = (input: string, opts: { small: boolean }, cb?: (output: string) => void) => void;

function getQRGenerator(): QRGenerator | undefined {
  if (typeof qrcode?.generate === "function") {
    return qrcode.generate.bind(qrcode);
  }
  const defaultObj = (qrcode as unknown as { default?: { generate?: QRGenerator } })?.default;
  if (typeof defaultObj?.generate === "function") {
    return defaultObj.generate.bind(defaultObj);
  }
  return undefined;
}
