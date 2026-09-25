/**
 * Default configuration constants for whatsapp-mailer.
 */
export const DEFAULT_CONFIG = {
  SESSION_DIR: "./session",
  PRINT_QR: false,
  RECONNECT: true,
  MAX_RECONNECT_ATTEMPTS: 5,
  RECONNECT_INTERVAL_MS: 2000,
  MAX_MEDIA_SIZE_BYTES: 100 * 1024 * 1024, // 100 MB
} as const;
