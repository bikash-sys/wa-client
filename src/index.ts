// Apply libsignal log patch immediately on package load — must be first import
import "./utils/patch-libsignal.js";

import { WhatsApp } from "./client.js";

// Main Client
export { WhatsApp };
export default WhatsApp;

// Configuration Defaults
export { DEFAULT_CONFIG } from "./config.js";

// Error Hierarchy
export {
  WhatsAppError,
  ConnectionError,
  AuthenticationError,
  MessageError,
  InvalidPhoneNumberError,
  SessionError,
} from "./errors/errors.js";

// Session & Storage
export { SessionStore, validateSessionName } from "./auth/session-store.js";

// Transport Layer
export { BaileysTransport } from "./transport/baileys-transport.js";
export type {
  WhatsAppTransport,
  MediaPayload,
  TransportMediaOptions,
  TransportTextOptions,
  TransportEvents,
} from "./transport/transport.interface.js";

// Event System
export { TypedEventEmitter } from "./events/event-emitter.js";

// Utilities
export {
  cleanPhoneNumber,
  normalizePhoneNumber,
  toWhatsAppJid,
  jidToPhoneNumber,
  isWhatsAppJid,
  isGroupJid,
} from "./utils/phone.js";

export { DefaultLogger, SilentLogger, resolveLogger, sanitizeLogArg } from "./utils/logger.js";
export { patchLibsignalLogs } from "./utils/patch-libsignal.js";
export type { Logger, LogLevel } from "./utils/logger.js";

// Public Type Definitions
export type {
  WhatsAppOptions,
  SessionInfo,
  ConnectionState,
  SentMessage,
  MessageOptions,
  MediaBaseOptions,
  ImageMessageOptions,
  VideoMessageOptions,
  AudioMessageOptions,
  DocumentMessageOptions,
  IncomingMessage,
  WhatsAppEvents,
} from "./types/index.js";
