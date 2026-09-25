import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
  type WAMessage,
  type AnyMessageContent,
  type proto,
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
  IncomingMessage,
  MessageOptions,
  SentMessage,
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
 * Baileys-based implementation of the WhatsAppTransport interface.
 */
export class BaileysTransport
  extends TypedEventEmitter<TransportEvents>
  implements WhatsAppTransport
{
  private socket: WASocket | null = null;
  private sessionStore: SessionStore;
  private logger: Logger;
  private printQR: boolean;
  private state: ConnectionState = "disconnected";
  private isExplicitDisconnect = false;
  private isExplicitDestroy = false;

  constructor(options: { sessionPath: string; logger: Logger; printQR?: boolean }) {
    super();
    // Suppress sensitive cryptographic session state logged by libsignal internals
    patchLibsignalLogs();
    this.logger = options.logger;
    this.printQR = options.printQR ?? false;
    this.sessionStore = new SessionStore(options.sessionPath, this.logger);
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
        syncFullHistory: false,
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
          this.setState("connected");
          this.logger.info("WhatsApp connection established.");
          this.emit("connected");
          this.emit("ready");
        } else if (connection === "close") {
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

      // Handle incoming messages
      sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify" && type !== "append") return;

        for (const wam of messages) {
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
    this.isExplicitDisconnect = true;
    if (this.socket) {
      try {
        await this.socket.logout();
      } catch (err) {
        this.logger.debug("Error during socket logout:", err);
      }
      this.socket = null;
    }
    this.sessionStore.clear();
    this.setState("logged_out");
    this.emit("logged_out");
  }

  /**
   * Completely destroys the transport, closing sockets and removing all event listeners.
   */
  public async destroy(): Promise<void> {
    this.isExplicitDestroy = true;
    await this.disconnect();
    this.removeAllListeners();
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

      const timestamp =
        typeof sent.messageTimestamp === "number" ? sent.messageTimestamp * 1000 : Date.now();

      return {
        id: sent.key.id || "",
        to: jidToPhoneNumber(toJid),
        timestamp,
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

      const timestamp =
        typeof sent.messageTimestamp === "number" ? sent.messageTimestamp * 1000 : Date.now();

      return {
        id: sent.key.id || "",
        to: jidToPhoneNumber(toJid),
        timestamp,
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
    const remoteJid = key.remoteJid || "";
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
      raw: wam,
      reply: async (textOrOptions: string | Omit<MessageOptions, "to">): Promise<SentMessage> => {
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
    console.log("\nWhatsApp Mailer");
    console.log("-----------------------------------------");
    console.log("Scan this QR code using:");
    console.log("WhatsApp → Linked Devices → Link a Device\n");

    try {
      qrcode.generate(qrString, { small: true });
    } catch (err) {
      this.logger.error("Failed to render QR in terminal:", err);
    }

    console.log("-----------------------------------------\n");
  }
}
