# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-09-25

### Added
- **Auto-Connect On Send**: Implicitly auto-connects persistent sessions when `wa.send()` or media methods are called directly without explicit `wa.connect()`.
- **One-Shot Clean Process Lifecycle**: Gracefully closes implicit connections once one-shot sends complete when no persistent message listeners or `keepAlive: true` options exist, allowing Node.js processes to exit cleanly.
- **`keepAlive` Option**: Added `keepAlive?: boolean` to `WhatsAppOptions` to keep implicit connections active when desired.
- **LID & Newsletter Address Support**: Added native support for `@lid` (Linked Device / Account ID JIDs) and `@newsletter` domains in phone normalization and message parsing.

### Changed & Fixed
- **Session Security & Path Traversal**: Added strict path validation (`assertSafeSessionPath`) guaranteeing session directories cannot escape `authDir`; enforced `0o700` filesystem permissions on session directories.
- **Libsignal & Console Log Suppression**: Completely suppressed internal Signal protocol cryptographic session dumps (`Closing session:`, ratchet advances) from polluting console output.
- **Media Attachment Security**: Sanitized document filenames via `path.basename()` to prevent directory traversal; enforced 100 MB media size limits.
- **Message Parsing Robustness**: Added fallback support for `remoteJidAlt` and guarded `msg.reply()` against missing recipient JIDs.
- **Session Registry Handling**: Prevented live socket collisions when multiple instances are initialized for the same named session.

## [0.1.0] - 2026-09-25

### Added
- **Core WhatsApp Client**: High-level, developer-friendly `WhatsApp` class with Nodemailer-like ergonomics.
- **Authentication**: WhatsApp Web QR code pairing with automatic terminal QR code rendering option (`printQR: true`).
- **Persistent Sessions**: Disk-backed credential storage (`SessionStore`) preventing repeated QR scans across application restarts.
- **Auto-Recovery**: Graceful handling and detection of corrupted session credential files.
- **Messaging API**:
  - `sendMessage(to, text)` with string and object overload signatures.
  - Media sending: `sendImage`, `sendVideo`, `sendAudio`, `sendDocument` with support for local file paths and in-memory `Buffer` payloads.
  - Automatic recipient phone number normalization (E.164 compliance and country code validation).
- **Incoming Messages & Replies**:
  - Typed `IncomingMessage` events with parsed message details.
  - Native `message.reply("...")` helper quoting the received message.
- **Connection Lifecycle & Reconnection**:
  - Resilient connection management with exponential backoff and jitter.
  - Customizable `maxReconnectAttempts` and `reconnect: false` flag.
  - Typed state machine (`disconnected`, `connecting`, `qr`, `connected`, `reconnecting`, `logged_out`).
- **Extensible Architecture**:
  - `WhatsAppTransport` interface enabling swappable underlying engines and unit testing without network dependencies.
  - Multi-session support allowing independent WhatsApp instances in a single Node.js process.
- **Developer Experience**:
  - Dual ESM and CommonJS bundle with TypeScript type declarations (`.d.ts` / `.d.cts`).
  - Safe logging abstraction redacting sensitive keys and credentials.
  - Strict TypeScript types and TSDoc documentation on all public methods.
