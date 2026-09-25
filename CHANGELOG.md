# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
