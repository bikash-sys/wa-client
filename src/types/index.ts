import type { Logger, LogLevel } from "../utils/logger.js";
import type { WhatsAppTransport } from "../transport/transport.interface.js";

/**
 * Valid connection lifecycle states.
 */
export type ConnectionState =
  "disconnected" | "connecting" | "qr" | "connected" | "reconnecting" | "logged_out";

/**
 * Options for configuring the WhatsApp client.
 */
export interface WhatsAppOptions {
  /**
   * Path to the session directory where authentication credentials will be stored.
   * If not provided, defaults to `./session`.
   */
  session?: string;

  /**
   * Alias for `session`. Path to the session/authentication directory.
   */
  authDir?: string;

  /**
   * If true, automatically renders the QR code to the terminal when required.
   * Defaults to false.
   */
  printQR?: boolean;

  /**
   * Alias for `printQR`. If true, automatically renders the QR code to the terminal when required.
   * Defaults to false.
   */
  printQRInTerminal?: boolean;

  /**
   * Custom logger instance, log level, or false to disable all internal logging.
   */
  logger?: Logger | LogLevel | boolean;

  /**
   * Whether to automatically attempt reconnection when temporary connection issues occur.
   * Defaults to true.
   */
  reconnect?: boolean;

  /**
   * Maximum number of consecutive reconnection attempts before giving up.
   * Defaults to 5.
   */
  maxReconnectAttempts?: number;

  /**
   * Base reconnection interval in milliseconds.
   * Defaults to 2000 ms.
   */
  reconnectIntervalMs?: number;

  /**
   * Custom transport implementation (used for mocking, testing, or alternative backends).
   */
  transport?: WhatsAppTransport;
}

/**
 * Result returned after successfully sending a message.
 */
export interface SentMessage {
  /** Unique message identifier assigned by WhatsApp */
  id: string;
  /** Normalized recipient phone number or group JID */
  to: string;
  /** Unix timestamp in milliseconds when the message was sent */
  timestamp: number;
  /** Optional raw underlying message object */
  raw?: unknown;
}

/**
 * Options for sending a plain text message.
 */
export interface MessageOptions {
  /** Recipient phone number with country code, or group JID */
  to: string;
  /** Text content of the message */
  text: string;
  /** Optional message to quote/reply to */
  quote?: unknown;
}

/**
 * Base options shared by all media messages.
 */
export interface MediaBaseOptions {
  /** Recipient phone number with country code, or group JID */
  to: string;
  /** Optional caption to accompany the media */
  caption?: string;
  /** Optional message to quote/reply to */
  quote?: unknown;
}

/**
 * Options for sending an image message.
 */
export type ImageMessageOptions = MediaBaseOptions &
  (
    | {
        /** Local file system path to the image */
        path: string;
        data?: never;
        filename?: string;
        mimetype?: string;
      }
    | {
        path?: never;
        /** In-memory image buffer */
        data: Buffer;
        filename?: string;
        mimetype?: string;
      }
  );

/**
 * Options for sending a video message.
 */
export type VideoMessageOptions = MediaBaseOptions &
  (
    | {
        /** Local file system path to the video */
        path: string;
        data?: never;
        filename?: string;
        mimetype?: string;
        /** Send as video note (round video) */
        ptv?: boolean;
      }
    | {
        path?: never;
        /** In-memory video buffer */
        data: Buffer;
        filename?: string;
        mimetype?: string;
        ptv?: boolean;
      }
  );

/**
 * Options for sending an audio or voice note message.
 */
export type AudioMessageOptions = Omit<MediaBaseOptions, "caption"> &
  (
    | {
        /** Local file system path to the audio file */
        path: string;
        data?: never;
        filename?: string;
        mimetype?: string;
        /** If true, sends as a push-to-talk voice note */
        ptt?: boolean;
      }
    | {
        path?: never;
        /** In-memory audio buffer */
        data: Buffer;
        filename?: string;
        mimetype?: string;
        ptt?: boolean;
      }
  );

/**
 * Options for sending a document / PDF / file message.
 */
export type DocumentMessageOptions = MediaBaseOptions &
  (
    | {
        /** Local file system path to the document */
        path: string;
        data?: never;
        /** Custom display filename */
        filename?: string;
        mimetype?: string;
      }
    | {
        path?: never;
        /** In-memory document buffer */
        data: Buffer;
        /** Display filename (required when passing Buffer) */
        filename: string;
        mimetype?: string;
      }
  );

/**
 * Representation of an incoming WhatsApp message.
 */
export interface IncomingMessage {
  /** Unique message identifier */
  id: string;
  /**
   * The conversation identifier where the message was sent.
   * If a direct message: phone number.
   * If a group message: group JID (e.g. 12345-67890@g.us).
   */
  from: string;
  /**
   * The phone number of the individual sender who authored the message.
   * In direct chats, `sender === from`.
   * In group chats, `sender` is the participant's phone number.
   */
  sender: string;
  /** Extracted text content of the message if available */
  text?: string;
  /** Unix timestamp in milliseconds when the message was created */
  timestamp: number;
  /** Whether the message was sent in a group chat */
  isGroup: boolean;
  /** Whether the message was sent by the authenticated user's account */
  isFromMe: boolean;
  /** Optional raw underlying transport message object */
  raw?: unknown;
  /**
   * Convenient helper to reply directly to this message.
   * Automatically quotes the incoming message and addresses the reply to the sender/group.
   */
  reply(textOrOptions: string | Omit<MessageOptions, "to">): Promise<SentMessage>;
}

/**
 * Strongly typed events emitted by the WhatsApp client.
 */
export type WhatsAppEvents = {
  /** Emitted when a new QR code is generated for pairing */
  qr: (qr: string) => void;
  /** Emitted when the client is fully authenticated and ready to send/receive messages */
  ready: () => void;
  /** Emitted when the underlying transport socket connection opens */
  connected: () => void;
  /** Emitted when the connection closes or disconnects */
  disconnected: (reason?: string) => void;
  /** Emitted when an automatic reconnect attempt is triggered */
  reconnecting: (attempt: number, maxAttempts: number) => void;
  /** Emitted when an incoming message is received */
  message: (message: IncomingMessage) => void;
  /** Emitted when a message has been sent successfully */
  "message.sent": (message: SentMessage) => void;
  /** Emitted when an unhandled or transport error occurs */
  error: (error: Error) => void;
  /** Emitted when the session is logged out remotely or locally */
  logged_out: () => void;
};
