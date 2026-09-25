import { TypedEventEmitter } from "./events/event-emitter.js";
import { BaileysTransport } from "./transport/baileys-transport.js";
import { ConnectionManager } from "./connection/connection-manager.js";
import { MessageService } from "./messages/message-service.js";
import { DEFAULT_CONFIG } from "./config.js";
import { resolveLogger, type Logger } from "./utils/logger.js";
import type { WhatsAppTransport } from "./transport/transport.interface.js";
import type {
  AudioMessageOptions,
  ConnectionState,
  DocumentMessageOptions,
  ImageMessageOptions,
  MessageOptions,
  SentMessage,
  VideoMessageOptions,
  WhatsAppEvents,
  WhatsAppOptions,
} from "./types/index.js";

/**
 * Main WhatsApp client class.
 *
 * Provides a clean, Nodemailer-style developer experience for authenticating
 * via QR code and sending/receiving WhatsApp messages in Node.js.
 *
 * @example
 * ```typescript
 * import { WhatsApp } from "wp-client";
 *
 * const wa = new WhatsApp({ session: "./session", printQR: true });
 *
 * wa.on("ready", async () => {
 *   await wa.sendMessage("919876543210", "Hello from Node.js!");
 * });
 *
 * await wa.connect();
 * ```
 */
export class WhatsApp extends TypedEventEmitter<WhatsAppEvents> {
  private readonly options: WhatsAppOptions;
  private readonly logger: Logger;
  private readonly transport: WhatsAppTransport;
  private readonly connectionManager: ConnectionManager;
  private readonly messageService: MessageService;

  constructor(options: WhatsAppOptions = {}) {
    super();

    const sessionPath = options.session ?? options.authDir ?? DEFAULT_CONFIG.SESSION_DIR;
    const shouldPrintQR = Boolean(
      options.printQRInTerminal ?? options.printQR ?? DEFAULT_CONFIG.PRINT_QR,
    );

    this.options = {
      session: sessionPath,
      authDir: sessionPath,
      printQR: shouldPrintQR,
      printQRInTerminal: shouldPrintQR,
      reconnect: DEFAULT_CONFIG.RECONNECT,
      maxReconnectAttempts: DEFAULT_CONFIG.MAX_RECONNECT_ATTEMPTS,
      reconnectIntervalMs: DEFAULT_CONFIG.RECONNECT_INTERVAL_MS,
      ...options,
    };

    // Ensure resolved/normalized values take precedence
    this.options.session = sessionPath;
    this.options.authDir = sessionPath;
    this.options.printQR = shouldPrintQR;
    this.options.printQRInTerminal = shouldPrintQR;

    this.logger = resolveLogger(this.options.logger);

    // Initialize transport (custom transport can be injected for testing or alternative engines)
    this.transport =
      this.options.transport ??
      new BaileysTransport({
        sessionPath: this.options.session!,
        logger: this.logger,
        printQR: this.options.printQR,
        printQRInTerminal: this.options.printQRInTerminal,
      });

    this.connectionManager = new ConnectionManager(this.transport, this.logger, {
      reconnect: this.options.reconnect,
      maxReconnectAttempts: this.options.maxReconnectAttempts,
      reconnectIntervalMs: this.options.reconnectIntervalMs,
    });

    this.messageService = new MessageService(this.transport);

    this.bindTransportEvents();
  }

  /**
   * Returns whether the client currently has an active connection with WhatsApp.
   */
  public isConnected(): boolean {
    return this.transport.isConnected();
  }

  /**
   * Returns the current lifecycle state of the connection.
   */
  public getState(): ConnectionState {
    return this.transport.getState();
  }

  /**
   * Provides access to the underlying low-level socket client.
   *
   * @warning Advanced usage only. Direct interactions with the raw client bypass
   * the high-level guarantees provided by wp-client.
   */
  public getRawClient<T = unknown>(): T | undefined {
    return this.transport.getRawClient<T>();
  }

  /**
   * Raw client property getter.
   */
  public get raw(): unknown {
    return this.transport.getRawClient();
  }

  /**
   * Connects to WhatsApp.
   *
   * If a previous session exists in the session directory, credentials will be reused.
   * If connecting for the first time, a QR code event will be emitted.
   */
  public async connect(): Promise<void> {
    this.connectionManager.resume();
    await this.transport.connect();
  }

  /**
   * Gracefully disconnects the client without clearing or revoking saved session credentials.
   */
  public async disconnect(): Promise<void> {
    this.connectionManager.stop();
    await this.transport.disconnect();
  }

  /**
   * Logs out the WhatsApp session, unlinks the device from WhatsApp servers,
   * and clears stored credentials from disk.
   */
  public async logout(): Promise<void> {
    this.connectionManager.stop();
    await this.transport.logout();
  }

  /**
   * Completely closes connections, cancels reconnection timers, and removes all event listeners.
   * Recommended during process shutdown (e.g. SIGINT or SIGTERM handlers).
   */
  public async destroy(): Promise<void> {
    this.connectionManager.stop();
    await this.transport.destroy();
    this.removeAllListeners();
  }

  /**
   * Sends a plain text message to a WhatsApp phone number or group.
   *
   * @param to - Recipient phone number (with country code, e.g. "919876543210") or group JID
   * @param text - Text message to send
   *
   * @example
   * ```typescript
   * await wa.sendMessage("919876543210", "Hello from Node.js!");
   * ```
   */
  public async sendMessage(to: string, text: string): Promise<SentMessage>;
  /**
   * Sends a plain text message using an options object.
   *
   * @param options - Message options including destination and text
   *
   * @example
   * ```typescript
   * await wa.sendMessage({
   *   to: "919876543210",
   *   text: "Hello from Node.js!"
   * });
   * ```
   */
  public async sendMessage(options: MessageOptions): Promise<SentMessage>;
  public async sendMessage(
    toOrOptions: string | MessageOptions,
    text?: string,
  ): Promise<SentMessage> {
    let opts: MessageOptions;
    if (typeof toOrOptions === "string") {
      opts = { to: toOrOptions, text: text ?? "" };
    } else {
      opts = toOrOptions;
    }

    const sent = await this.messageService.sendText(opts);
    this.emit("message.sent", sent);
    return sent;
  }

  /**
   * Sends an image message to a recipient.
   *
   * @param to - Recipient phone number or group JID
   * @param source - File path string or in-memory Buffer
   * @param caption - Optional caption text
   */
  public async sendImage(
    to: string,
    source: string | Buffer,
    caption?: string,
  ): Promise<SentMessage>;
  /**
   * Sends an image message using an options object.
   */
  public async sendImage(options: ImageMessageOptions): Promise<SentMessage>;
  public async sendImage(
    toOrOptions: string | ImageMessageOptions,
    source?: string | Buffer,
    caption?: string,
  ): Promise<SentMessage> {
    let opts: ImageMessageOptions;
    if (typeof toOrOptions === "string") {
      if (typeof source === "string") {
        opts = { to: toOrOptions, path: source, caption };
      } else if (Buffer.isBuffer(source)) {
        opts = { to: toOrOptions, data: source, caption };
      } else {
        opts = { to: toOrOptions, path: "" };
      }
    } else {
      opts = toOrOptions;
    }

    const sent = await this.messageService.sendImage(opts);
    this.emit("message.sent", sent);
    return sent;
  }

  /**
   * Sends a video message to a recipient.
   *
   * @param to - Recipient phone number or group JID
   * @param source - File path string or in-memory Buffer
   * @param caption - Optional caption text
   */
  public async sendVideo(
    to: string,
    source: string | Buffer,
    caption?: string,
  ): Promise<SentMessage>;
  /**
   * Sends a video message using an options object.
   */
  public async sendVideo(options: VideoMessageOptions): Promise<SentMessage>;
  public async sendVideo(
    toOrOptions: string | VideoMessageOptions,
    source?: string | Buffer,
    caption?: string,
  ): Promise<SentMessage> {
    let opts: VideoMessageOptions;
    if (typeof toOrOptions === "string") {
      if (typeof source === "string") {
        opts = { to: toOrOptions, path: source, caption };
      } else if (Buffer.isBuffer(source)) {
        opts = { to: toOrOptions, data: source, caption };
      } else {
        opts = { to: toOrOptions, path: "" };
      }
    } else {
      opts = toOrOptions;
    }

    const sent = await this.messageService.sendVideo(opts);
    this.emit("message.sent", sent);
    return sent;
  }

  /**
   * Sends an audio or voice note message.
   *
   * @param to - Recipient phone number or group JID
   * @param source - File path string or in-memory Buffer
   * @param ptt - If true, sends as a recorded voice note
   */
  public async sendAudio(to: string, source: string | Buffer, ptt?: boolean): Promise<SentMessage>;
  /**
   * Sends an audio message using an options object.
   */
  public async sendAudio(options: AudioMessageOptions): Promise<SentMessage>;
  public async sendAudio(
    toOrOptions: string | AudioMessageOptions,
    source?: string | Buffer,
    ptt?: boolean,
  ): Promise<SentMessage> {
    let opts: AudioMessageOptions;
    if (typeof toOrOptions === "string") {
      if (typeof source === "string") {
        opts = { to: toOrOptions, path: source, ptt };
      } else if (Buffer.isBuffer(source)) {
        opts = { to: toOrOptions, data: source, ptt };
      } else {
        opts = { to: toOrOptions, path: "" };
      }
    } else {
      opts = toOrOptions;
    }

    const sent = await this.messageService.sendAudio(opts);
    this.emit("message.sent", sent);
    return sent;
  }

  /**
   * Sends a document (e.g. PDF, spreadsheet, archive) to a recipient.
   *
   * @param to - Recipient phone number or group JID
   * @param source - File path string or in-memory Buffer
   * @param filename - Display filename for the document
   * @param caption - Optional caption text
   */
  public async sendDocument(
    to: string,
    source: string | Buffer,
    filename?: string,
    caption?: string,
  ): Promise<SentMessage>;
  /**
   * Sends a document message using an options object.
   */
  public async sendDocument(options: DocumentMessageOptions): Promise<SentMessage>;
  public async sendDocument(
    toOrOptions: string | DocumentMessageOptions,
    source?: string | Buffer,
    filename?: string,
    caption?: string,
  ): Promise<SentMessage> {
    let opts: DocumentMessageOptions;
    if (typeof toOrOptions === "string") {
      if (typeof source === "string") {
        opts = { to: toOrOptions, path: source, filename, caption };
      } else if (Buffer.isBuffer(source)) {
        opts = { to: toOrOptions, data: source, filename: filename ?? "document", caption };
      } else {
        opts = { to: toOrOptions, path: "" };
      }
    } else {
      opts = toOrOptions;
    }

    const sent = await this.messageService.sendDocument(opts);
    this.emit("message.sent", sent);
    return sent;
  }

  private bindTransportEvents(): void {
    this.transport.on("qr", (qr) => {
      this.emit("qr", qr);
    });

    this.transport.on("connected", () => {
      this.connectionManager.resetAttempts();
      this.emit("connected");
    });

    this.transport.on("ready", () => {
      this.connectionManager.resetAttempts();
      this.emit("ready");
    });

    this.transport.on("disconnected", (reason, isLoggedOut) => {
      this.emit("disconnected", reason);

      if (!isLoggedOut) {
        this.connectionManager.scheduleReconnect(
          (attempt, maxAttempts) => {
            this.emit("reconnecting", attempt, maxAttempts);
          },
          (err) => {
            this.emit("error", err);
          },
        );
      }
    });

    this.transport.on("logged_out", () => {
      this.connectionManager.stop();
      this.emit("logged_out");
    });

    this.transport.on("message", (msg) => {
      this.emit("message", msg);
    });

    this.transport.on("error", (err) => {
      this.emit("error", err);
    });
  }
}
