import type {
  ConnectionState,
  GetChatsOptions,
  IncomingMessage,
  SentMessage,
  WhatsAppChat,
  WhatsAppMessage,
  WhatsAppMessageKey,
} from "../types/index.js";
import type { TypedEventEmitter } from "../events/event-emitter.js";

export type MediaPayload = { path: string; data?: never } | { data: Buffer; path?: never };

export interface TransportMediaOptions {
  caption?: string;
  filename?: string;
  mimetype?: string;
  ptt?: boolean;
  ptv?: boolean;
  quote?: unknown;
}

export interface TransportTextOptions {
  quote?: unknown;
}

export type TransportEvents = {
  qr: (qr: string) => void;
  ready: () => void;
  connected: () => void;
  disconnected: (reason?: string, isLoggedOut?: boolean) => void;
  message: (message: IncomingMessage) => void;
  error: (error: Error) => void;
  logged_out: () => void;
};

/**
 * Transport interface abstracting the underlying WhatsApp Web protocol implementation.
 * Allows replacing Baileys or mocking the transport in tests.
 */
export interface WhatsAppTransport extends TypedEventEmitter<TransportEvents> {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  logout(): Promise<void>;
  destroy(): Promise<void>;
  isConnected(): boolean;
  getState(): ConnectionState;
  sendTextMessage(
    toJid: string,
    text: string,
    options?: TransportTextOptions,
  ): Promise<SentMessage>;
  sendMediaMessage(
    toJid: string,
    mediaType: "image" | "video" | "audio" | "document",
    payload: MediaPayload,
    options?: TransportMediaOptions,
  ): Promise<SentMessage>;
  getChats(options?: GetChatsOptions): Promise<WhatsAppChat[]>;
  getMessages(chatJid: string, limit?: number): Promise<WhatsAppMessage[]>;
  pinMessage(key: WhatsAppMessageKey, durationInSeconds: number): Promise<void>;
  unpinMessage(key: WhatsAppMessageKey): Promise<void>;
  getRawClient<T = unknown>(): T | undefined;
}
