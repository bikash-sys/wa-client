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
// Intercept console.info and console.warn to suppress sensitive SessionEntry objects
// that libsignal may print via internal code paths.
const SENSITIVE_SESSION_PREFIXES = [
  "Closing session:",
  "Opening session:",
  "Removing old closed session:",
  "Session already closed",
  "Migrating session to:",
  "Decrypted message with closed session",
];

// Save originals before we touch anything
const _origConsoleInfo = console.info.bind(console);
const _origConsoleWarn = console.warn.bind(console);

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
