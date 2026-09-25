/**
 * Default configuration constants for whatsapp-msg-client.
 */
export const DEFAULT_CONFIG = {
  AUTH_DIR: "./auth",
  DEFAULT_SESSION: "default",
  SESSION_DIR: "./auth/default",
  PRINT_QR: false,
  RECONNECT: true,
  MAX_RECONNECT_ATTEMPTS: 5,
  RECONNECT_INTERVAL_MS: 2000,
  MAX_MEDIA_SIZE_BYTES: 100 * 1024 * 1024, // 100 MB
} as const;
