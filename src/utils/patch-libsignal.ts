/**
 * Patches the libsignal SessionRecord prototype to prevent sensitive
 * cryptographic session state (keys, ratchet state, chain keys) from
 * being printed to the console during normal Signal protocol operations.
 *
 * libsignal calls console.info("Closing session:", session) and
 * console.info("Opening session:", session) with the full session object,
 * which contains registrationId, _chains, currentRatchet, rootKey, privKey,
 * remoteIdentityKey, etc. — none of which should ever appear in logs.
 *
 * The patching is applied immediately as a module-level side-effect when
 * this file is first imported, ensuring it takes effect before Baileys
 * replays any existing session state from disk (which triggers closeSession
 * during the signal ratchet advance).
 *
 * A console.info interceptor is also installed as a defence-in-depth layer
 * to catch any other libsignal code paths that log sensitive session state.
 */

// ─── Console interceptor (defence in depth) ────────────────────────────────
// Intercepts console.info, console.warn, and console.error to suppress two
// classes of sensitive or noisy libsignal messages:
//
//  1. Session-state dumps from SessionRecord (console.info / console.warn):
//     "Closing session:", "Opening session:", etc.
//     These print full SignalProtocol session objects containing root keys,
//     chain keys, and ratchet state — none of which should appear in logs.
//
//  2. Bad MAC / no-session decryption errors from session_cipher.js (console.error):
//     "Failed to decrypt message with any known session..."
//     "Session error:Error: Bad MAC  Error: Bad MAC\n  at Object.verifyMAC..."
//     These are expected code paths exercised when Baileys attempts to
//     decrypt an incoming message with every known session and none succeed.
//     The raw libsignal stack trace contains no actionable information for
//     package users and produces significant terminal noise.
//     Baileys catches the resulting SessionError and handles retries internally.
//
// All other console.error output is passed through completely unchanged.

const SENSITIVE_SESSION_PREFIXES = [
  "Closing session:",
  "Opening session:",
  "Removing old closed session:",
  "Session already closed",
  "Migrating session to:",
  "Decrypted message with closed session",
];

// These exact console.error prefixes are emitted by libsignal/src/session_cipher.js
// decryptWithSessions() when no session can decrypt the incoming message.
const LIBSIGNAL_DECRYPT_ERROR_PREFIXES = [
  "Failed to decrypt message with any known session",
  "Session error:",
];

// Save originals before we touch anything
const _origConsoleInfo = console.info.bind(console);
const _origConsoleWarn = console.warn.bind(console);
const _origConsoleError = console.error.bind(console);

console.info = function safeConsoleInfo(...args: unknown[]): void {
  if (typeof args[0] === "string") {
    for (const prefix of SENSITIVE_SESSION_PREFIXES) {
      if (args[0].startsWith(prefix)) {
        // Suppress libsignal session dump from polluting stdout
        return;
      }
    }
  }
  _origConsoleInfo(...args);
};

console.warn = function safeConsoleWarn(...args: unknown[]): void {
  if (typeof args[0] === "string") {
    for (const prefix of SENSITIVE_SESSION_PREFIXES) {
      if (args[0].startsWith(prefix)) {
        // Suppress libsignal session dump from polluting stdout
        return;
      }
    }
  }
  _origConsoleWarn(...args);
};

console.error = function safeConsoleError(...args: unknown[]): void {
  if (typeof args[0] === "string") {
    for (const prefix of LIBSIGNAL_DECRYPT_ERROR_PREFIXES) {
      if (args[0].startsWith(prefix)) {
        // Suppress raw libsignal Bad MAC / no-session stack trace.
        // This is an expected internal code path in session_cipher.js and
        // Baileys handles the resulting SessionError automatically.
        return;
      }
    }
  }
  _origConsoleError(...args);
};

// ─── Prototype patch ────────────────────────────────────────────────────────
// Directly override the SessionRecord methods that dump sessions to prevent
// console pollution and ensure sensitive state is never logged.
function applyPrototypePatch(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const libsignal = require("libsignal") as {
      SessionRecord?: {
        prototype?: Record<string, unknown>;
      };
    };

    const proto = libsignal?.SessionRecord?.prototype;
    if (!proto) return;

    // Patch closeSession
    if (typeof proto["closeSession"] === "function") {
      proto["closeSession"] = function patchedCloseSession(
        this: unknown,
        session: { indexInfo: { closed: number } },
      ) {
        if (session?.indexInfo?.closed !== -1) return; // already closed — no-op
        session.indexInfo.closed = Date.now();
      };
    }

    // Patch openSession
    if (typeof proto["openSession"] === "function") {
      proto["openSession"] = function patchedOpenSession(
        this: unknown,
        session: { indexInfo: { closed: number } },
      ) {
        if (session?.indexInfo?.closed === -1) return; // already open — no-op
        session.indexInfo.closed = -1;
      };
    }

    // Patch removeOldSessions (wraps the original to suppress the session dump)
    if (typeof proto["removeOldSessions"] === "function") {
      const origRemove = proto["removeOldSessions"] as (this: unknown) => void;
      proto["removeOldSessions"] = function patchedRemoveOldSessions(this: unknown) {
        origRemove.call(this);
      };
    }
  } catch {
    // libsignal not available (e.g. custom/mock transport in unit tests) — safe to ignore.
  }
}

// Apply immediately when this module is imported
applyPrototypePatch();

/**
 * Re-applies the libsignal log suppression patches.
 *
 * Normally the patch is applied automatically when this module is first imported.
 * Call this function explicitly if you are using a custom transport and want to
 * ensure the patches are in place before Baileys loads any session from disk.
 *
 * @example
 * ```typescript
 * import { patchLibsignalLogs } from "whatsapp-msg-client";
 * patchLibsignalLogs(); // apply before calling makeWASocket
 * ```
 */
export function patchLibsignalLogs(): void {
  applyPrototypePatch();
}
