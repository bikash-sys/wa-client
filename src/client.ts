import path from "node:path";
import { TypedEventEmitter } from "./events/event-emitter.js";
import { BaileysTransport } from "./transport/baileys-transport.js";
import { ConnectionManager } from "./connection/connection-manager.js";
import { MessageService } from "./messages/message-service.js";
import { SessionStore, validateSessionName } from "./auth/session-store.js";
import { DEFAULT_CONFIG } from "./config.js";
import { ConnectionError } from "./errors/errors.js";
import { resolveLogger, SilentLogger, type Logger } from "./utils/logger.js";
import type { WhatsAppTransport } from "./transport/transport.interface.js";
import type {
  AudioMessageOptions,
  ConnectionState,
  DocumentMessageOptions,
  ImageMessageOptions,
  MessageOptions,
  SentMessage,
  SessionInfo,
  VideoMessageOptions,
  WhatsAppEvents,
  WhatsAppOptions,
} from "./types/index.js";

/**
 * Main WhatsApp client class.
 *
 * Provides a clean, developer-friendly API for authenticating
 * via QR code and sending/receiving WhatsApp messages in Node.js.
 *
 * @example
 * ```typescript
 * import { WhatsApp } from "whatsapp-msg-client";
 *
 * const wa = new WhatsApp({ session: "personal", printQRInTerminal: true });
 *
 * wa.on("message", async (msg) => {
 *   if (msg.text === "ping") {
 *     await msg.reply("pong!");
 *   }
 * });
 *
 * // Auto-connects persistent session and sends message!
 * await wa.send("919876543210", "Hello from Node.js!");
 * ```
 */
export class WhatsApp extends TypedEventEmitter<WhatsAppEvents> {
  /** In-memory registry of active WhatsApp client instances in the current process */
  private static readonly activeInstances = new Map<string, WhatsApp>();

  private readonly options: WhatsAppOptions;
  private readonly sessionProfileName: string;
  private readonly authRootDir: string;
  private readonly logger: Logger;
  private readonly transport: WhatsAppTransport;
  private readonly connectionManager: ConnectionManager;
  private readonly messageService: MessageService;
  private connectionPromise: Promise<void> | null = null;

  constructor(options: WhatsAppOptions = {}) {
    super();

    // 1. Resolve root authentication directory
    this.authRootDir = options.authDir ?? DEFAULT_CONFIG.AUTH_DIR;

    // 2. Resolve & validate named session profile
    const rawSessionName = options.session ?? DEFAULT_CONFIG.DEFAULT_SESSION;
    this.sessionProfileName = validateSessionName(rawSessionName);

    // 3. Resolve physical session directory: ${authRootDir}/${sessionProfileName}
    const resolvedSessionPath = path.join(this.authRootDir, this.sessionProfileName);

    const shouldPrintQR = Boolean(
      options.printQRInTerminal ?? options.printQR ?? DEFAULT_CONFIG.PRINT_QR,
    );

    this.options = {
      session: this.sessionProfileName,
      authDir: this.authRootDir,
      printQR: shouldPrintQR,
      printQRInTerminal: shouldPrintQR,
      reconnect: DEFAULT_CONFIG.RECONNECT,
      maxReconnectAttempts: DEFAULT_CONFIG.MAX_RECONNECT_ATTEMPTS,
      reconnectIntervalMs: DEFAULT_CONFIG.RECONNECT_INTERVAL_MS,
      ...options,
    };

    // Ensure normalized values take precedence
    this.options.session = this.sessionProfileName;
    this.options.authDir = this.authRootDir;
    this.options.printQR = shouldPrintQR;
    this.options.printQRInTerminal = shouldPrintQR;

    this.logger = resolveLogger(this.options.logger);

    // Initialize transport (custom transport can be injected for testing or alternative backends)
    this.transport =
      this.options.transport ??
      new BaileysTransport({
        sessionPath: resolvedSessionPath,
        sessionName: this.sessionProfileName,
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

    // Register instance in process-level active sessions registry
    const instanceKey = WhatsApp.getInstanceKey(this.authRootDir, this.sessionProfileName);
    WhatsApp.activeInstances.set(instanceKey, this);
  }

  // ============================================================================
  // Properties & Getters
  // ============================================================================

  /**
   * The named session profile identifier (e.g. "personal", "business", "default").
   */
  public get session(): string {
    return this.sessionProfileName;
  }

  /**
   * The named session profile identifier.
   */
  public get sessionName(): string {
    return this.sessionProfileName;
  }

  /**
   * The root directory where session authentication folders are stored.
   */
  public get authDir(): string {
    return this.authRootDir;
  }

  /**
   * The full absolute path to the directory containing this session's credentials.
   */
  public get sessionPath(): string {
    return path.resolve(this.authRootDir, this.sessionProfileName);
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
   * the high-level guarantees provided by whatsapp-msg-client.
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

  // ============================================================================
  // Connection Lifecycle
  // ============================================================================

  /**
   * Ensures that the client is connected and ready to send messages.
   * - If already connected: resolves immediately.
   * - If a connection attempt is in-flight: awaits that existing attempt.
   * - If disconnected / reconnecting: starts connecting and waits until ready.
   * - If authentication fails or errors: rejects with ConnectionError.
   */
  public async ensureConnected(): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = (async () => {
      this.connectionManager.resume();

      if (this.isConnected()) {
        return;
      }

      const waitPromise = new Promise<void>((resolve, reject) => {
        let isSettled = false;

        const onReadyOrConnected = () => {
          if (isSettled) return;
          isSettled = true;
          cleanup();
          resolve();
        };

        const onError = (err: Error) => {
          if (isSettled) return;
          isSettled = true;
          cleanup();
          reject(
            err instanceof ConnectionError
              ? err
              : new ConnectionError(err.message, "ERR_CONNECTION_FAILED", err),
          );
        };

        const onDisconnected = (reason?: string, isLoggedOut?: boolean) => {
          if (isSettled) return;
          if (isLoggedOut) {
            isSettled = true;
            cleanup();
            reject(
              new ConnectionError(
                "WhatsApp session was logged out: " + (reason ?? "unknown"),
                "ERR_LOGGED_OUT",
              ),
            );
          }
        };

        const cleanup = () => {
          this.off("ready", onReadyOrConnected);
          this.off("connected", onReadyOrConnected);
          this.off("error", onError);
          this.off("disconnected", onDisconnected);
        };

        this.once("ready", onReadyOrConnected);
        this.once("connected", onReadyOrConnected);
        this.once("error", onError);
        this.once("disconnected", onDisconnected);

        this.transport.connect().catch((err) => {
          onError(err);
        });
      });

      try {
        await waitPromise;
      } finally {
        this.connectionPromise = null;
      }
    })();

    return this.connectionPromise;
  }

  /**
   * Connects to WhatsApp.
   *
   * If a previous session exists in the session directory, credentials will be reused.
   * If connecting for the first time, a QR code event will be emitted.
   */
  public async connect(): Promise<void> {
    await this.ensureConnected();
  }

  /**
   * Gracefully disconnects the client without clearing or revoking saved session credentials.
   */
  public async disconnect(): Promise<void> {
    this.connectionManager.stop();
    this.connectionPromise = null;
    await this.transport.disconnect();
  }

  /**
   * Logs out the WhatsApp session, unlinks the device from WhatsApp servers,
   * and clears stored credentials from disk.
   */
  public async logout(): Promise<void> {
    this.connectionManager.stop();
    this.connectionPromise = null;
    await this.transport.logout();
  }

  /**
   * Completely closes connections, cancels reconnection timers, and removes all event listeners.
   * Recommended during process shutdown (e.g. SIGINT or SIGTERM handlers).
   */
  public async destroy(): Promise<void> {
    this.connectionManager.stop();
    this.connectionPromise = null;
    await this.transport.destroy();
    this.removeAllListeners();

    // Remove from in-memory active instances
    const instanceKey = WhatsApp.getInstanceKey(this.authRootDir, this.sessionProfileName);
    WhatsApp.activeInstances.delete(instanceKey);
  }

  // ============================================================================
  // Primary Messaging API
  // ============================================================================

  /**
   * Sends a plain text message to a WhatsApp phone number or group.
   *
   * If the client is not yet connected, automatically establishes or resumes
   * the persistent session before sending.
   *
   * @param to - Recipient phone number (with country code, e.g. "919876543210") or group JID
   * @param text - Text message to send
   *
   * @example
   * ```typescript
   * await wa.send("919876543210", "Hello!");
   * ```
   */
  public async send(to: string, text: string): Promise<SentMessage>;
  /**
   * Sends a plain text message using an options object.
   *
   * @param options - Message options including destination, text, and optional quoted message
   *
   * @example
   * ```typescript
   * await wa.send({ to: "919876543210", text: "Hello!" });
   * ```
   */
  public async send(options: MessageOptions): Promise<SentMessage>;
  public async send(toOrOptions: string | MessageOptions, text?: string): Promise<SentMessage> {
    if (typeof toOrOptions === "string") {
      return this.sendMessage(toOrOptions, text ?? "");
    }
    return this.sendMessage(toOrOptions);
  }

  /**
   * Sends a plain text message to a WhatsApp phone number or group.
   * (Alias for `send()`, preserved for backwards compatibility).
   *
   * @param to - Recipient phone number or group JID
   * @param text - Text message to send
   */
  public async sendMessage(to: string, text: string): Promise<SentMessage>;
  /**
   * Sends a plain text message using an options object.
   * (Alias for `send()`, preserved for backwards compatibility).
   */
  public async sendMessage(options: MessageOptions): Promise<SentMessage>;
  public async sendMessage(
    toOrOptions: string | MessageOptions,
    text?: string,
  ): Promise<SentMessage> {
    await this.ensureConnected();

    let opts: MessageOptions;
    if (typeof toOrOptions === "string") {
      opts = { to: toOrOptions, text: text ?? "" };
    } else {
      opts = toOrOptions;
    }

    const sent = await this.messageService.sendText(opts);
    sent.session = this.sessionProfileName;
    this.emit("message.sent", sent);
    return sent;
  }

  // ============================================================================
  // Media Messaging Methods
  // ============================================================================

  /**
   * Sends an image message to a recipient.
   * Automatically connects the session if not already connected.
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
    await this.ensureConnected();

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
    sent.session = this.sessionProfileName;
    this.emit("message.sent", sent);
    return sent;
  }

  /**
   * Sends a video message to a recipient.
   * Automatically connects the session if not already connected.
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
    await this.ensureConnected();

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
    sent.session = this.sessionProfileName;
    this.emit("message.sent", sent);
    return sent;
  }

  /**
   * Sends an audio or voice note message.
   * Automatically connects the session if not already connected.
   *
   * @param to - Recipient phone number or group JID
   * @param source - File path string or in-memory Buffer
   * @param ptt - If true, sends as a push-to-talk voice note
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
    await this.ensureConnected();

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
    sent.session = this.sessionProfileName;
    this.emit("message.sent", sent);
    return sent;
  }

  /**
   * Sends a document (e.g. PDF, spreadsheet, archive) to a recipient.
   * Automatically connects the session if not already connected.
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
    await this.ensureConnected();

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
    sent.session = this.sessionProfileName;
    this.emit("message.sent", sent);
    return sent;
  }

  // ============================================================================
  // Session Management (Instance Methods)
  // ============================================================================

  /**
   * Lists all existing sessions in the authentication directory.
   */
  public async listSessions(): Promise<SessionInfo[]> {
    return WhatsApp.listSessions(this.authRootDir);
  }

  /**
   * Checks whether a session profile exists on disk or in memory.
   */
  public hasSession(name: string): boolean {
    return WhatsApp.hasSession(name, this.authRootDir);
  }

  /**
   * Creates a new session profile using this client's root authentication directory.
   */
  public async createSession(
    name: string,
    options: Omit<WhatsAppOptions, "session" | "authDir"> = {},
  ): Promise<WhatsApp> {
    return WhatsApp.createSession(name, {
      ...options,
      authDir: this.authRootDir,
    });
  }

  /**
   * Removes a session profile.
   *
   * If `name` is provided, removes that named session.
   * If `name` is omitted, removes *this* active session.
   *
   * Actions performed:
   * 1. Disconnects active connection
   * 2. Stops reconnection attempts
   * 3. Removes session from active in-memory registry
   * 4. Deletes session authentication directory from disk
   * 5. Emits `"session.removed"` event
   */
  public async removeSession(name?: string): Promise<void> {
    const targetSession = name ? validateSessionName(name) : this.sessionProfileName;
    await WhatsApp.removeSession(targetSession, { authDir: this.authRootDir });
  }

  // ============================================================================
  // Static Session Management API
  // ============================================================================

  /**
   * Helper to format an in-memory key for an active instance.
   */
  private static getInstanceKey(authDir: string, sessionName: string): string {
    return `${path.resolve(authDir)}::${sessionName}`;
  }

  /**
   * Creates and initializes a WhatsApp client for a named session.
   * If an active instance already exists in memory, returns the existing instance.
   *
   * @param name - The session name (e.g. "business", "personal")
   * @param options - Additional WhatsApp configuration options
   *
   * @example
   * ```typescript
   * const wa = await WhatsApp.createSession("business", { printQRInTerminal: true });
   * await wa.connect();
   * ```
   */
  public static async createSession(
    name: string,
    options: Omit<WhatsAppOptions, "session"> = {},
  ): Promise<WhatsApp> {
    const sessionName = validateSessionName(name);
    const authDir = options.authDir ?? DEFAULT_CONFIG.AUTH_DIR;
    const instanceKey = WhatsApp.getInstanceKey(authDir, sessionName);

    const existing = WhatsApp.activeInstances.get(instanceKey);
    if (existing) {
      return existing;
    }

    return new WhatsApp({
      ...options,
      session: sessionName,
      authDir,
    });
  }

  /**
   * Lists all existing sessions discovered in the authentication root directory
   * along with their active connection status.
   *
   * @param authDir - Root authentication directory to inspect (defaults to `./auth`)
   */
  public static async listSessions(
    authDir: string = DEFAULT_CONFIG.AUTH_DIR,
  ): Promise<SessionInfo[]> {
    const resolvedAuthDir = path.resolve(authDir);
    const diskSessionNames = SessionStore.listSessionNames(resolvedAuthDir);
    const sessionNamesSet = new Set<string>(diskSessionNames);

    // Also include any active in-memory instances under this auth directory
    for (const [key, instance] of WhatsApp.activeInstances.entries()) {
      if (key.startsWith(`${resolvedAuthDir}::`)) {
        sessionNamesSet.add(instance.sessionProfileName);
      }
    }

    const sessions: SessionInfo[] = [];

    for (const name of sessionNamesSet) {
      const instanceKey = WhatsApp.getInstanceKey(resolvedAuthDir, name);
      const activeInstance = WhatsApp.activeInstances.get(instanceKey);
      const sessionPath = path.join(resolvedAuthDir, name);
      const store = new SessionStore(sessionPath, new SilentLogger());

      sessions.push({
        name,
        connected: activeInstance ? activeInstance.isConnected() : false,
        state: activeInstance ? activeInstance.getState() : "disconnected",
        authDir: resolvedAuthDir,
        sessionPath,
        hasCredentials: store.hasCredentials(),
      });
    }

    return sessions.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Checks whether a named session exists either on disk or in memory.
   *
   * @param name - The session name to check
   * @param authDir - Root authentication directory (defaults to `./auth`)
   */
  public static hasSession(name: string, authDir: string = DEFAULT_CONFIG.AUTH_DIR): boolean {
    try {
      const sessionName = validateSessionName(name);
      const resolvedAuthDir = path.resolve(authDir);
      const instanceKey = WhatsApp.getInstanceKey(resolvedAuthDir, sessionName);

      if (WhatsApp.activeInstances.has(instanceKey)) {
        return true;
      }

      return SessionStore.sessionExists(resolvedAuthDir, sessionName);
    } catch {
      return false;
    }
  }

  /**
   * Returns an active in-memory WhatsApp client instance for the specified session name, if one exists.
   */
  public static getSession(
    name: string,
    authDir: string = DEFAULT_CONFIG.AUTH_DIR,
  ): WhatsApp | undefined {
    try {
      const sessionName = validateSessionName(name);
      const instanceKey = WhatsApp.getInstanceKey(authDir, sessionName);
      return WhatsApp.activeInstances.get(instanceKey);
    } catch {
      return undefined;
    }
  }

  /**
   * Removes a named session profile.
   *
   * 1. Disconnects the active connection if active
   * 2. Stops reconnect attempts
   * 3. Removes instance from memory registry
   * 4. Deletes authentication directory from disk
   * 5. Emits `"session.removed"` event on the instance
   *
   * @param name - The session name to remove
   * @param options - Optional configuration specifying the auth root directory
   */
  public static async removeSession(name: string, options?: { authDir?: string }): Promise<void> {
    const sessionName = validateSessionName(name);
    const authDir = options?.authDir ?? DEFAULT_CONFIG.AUTH_DIR;
    const resolvedAuthDir = path.resolve(authDir);
    const instanceKey = WhatsApp.getInstanceKey(resolvedAuthDir, sessionName);

    const instance = WhatsApp.activeInstances.get(instanceKey);
    if (instance) {
      await instance.destroy();
      WhatsApp.activeInstances.delete(instanceKey);
      instance.emit("session.removed", sessionName);
    }

    // Delete session files from disk
    SessionStore.removeSessionDirectory(resolvedAuthDir, sessionName);
  }

  /**
   * Disconnects and destroys all active WhatsApp instances in the current process.
   */
  public static async disconnectAll(): Promise<void> {
    const instances = Array.from(WhatsApp.activeInstances.values());
    await Promise.all(instances.map((instance) => instance.destroy()));
    WhatsApp.activeInstances.clear();
  }

  // ============================================================================
  // Private Event Binding
  // ============================================================================

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
      if (!msg.session) {
        msg.session = this.sessionProfileName;
      }
      this.emit("message", msg);
    });

    this.transport.on("error", (err) => {
      this.emit("error", err);
    });
  }
}
