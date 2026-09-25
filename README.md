# wp-client

> Simple, developer-friendly WhatsApp Web client for Node.js with QR authentication, persistent sessions, messaging, media attachments, and event handling. Built to feel as intuitive as Nodemailer.

[![npm version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://www.npmjs.com/package/wp-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org)

---

## Important Notice

**wp-client is an unofficial WhatsApp Web client wrapper.**
It is **not** an official Meta or WhatsApp API, SDK, or product, and is **not affiliated with, maintained, authorized, or endorsed by Meta Platforms, Inc. or WhatsApp LLC**.

This library is designed for legitimate automation, personal notifications, server alerts, internal tools, and customer assistance bots. It does **not** provide tools for spamming, bulk blasts, scraping, contact harvesting, or bypassing WhatsApp restrictions. Always adhere to WhatsApp's Terms of Service and applicable privacy regulations.

---

## Features

- 🚀 **Nodemailer-like Simplicity**: Clean, promise-based async API with zero unnecessary boilerplate.
- 📱 **QR Authentication**: Simple QR code event emission with optional automatic terminal QR rendering.
- 💾 **Persistent Sessions**: Credentials saved securely to disk; subsequent launches connect instantly without rescanning.
- 🛡️ **Session Auto-Recovery**: Detects corrupted or empty session credentials and gracefully resets without crashing.
- 💬 **Messaging**: Send text messages via simple `(to, text)` syntax or structured options objects.
- 📎 **Media Attachments**: First-class support for sending images, videos, audio/voice notes, and documents (PDFs, spreadsheets) via file paths or in-memory `Buffer`s.
- ↩️ **Native Replies**: Convenient `message.reply("...")` helper on incoming messages with automatic quoting.
- 🔄 **Smart Reconnection**: Built-in exponential backoff with jitter and customizable retry limits.
- 👥 **Multi-Session Support**: Run multiple distinct WhatsApp accounts in a single Node.js process without credential crosstalk.
- 🔒 **Security First**: Automatic sanitization of logs preventing credential/private key leaks, restrictive file permissions (0700).
- 🧩 **Modular Transport**: Abstracted transport layer (`WhatsAppTransport`) allowing complete mocking in unit tests.
- 🔷 **Strict TypeScript**: 100% TypeScript with full type definitions (`.d.ts` and `.d.cts`) and comprehensive TSDoc comments.

---

## Installation

```bash
npm install wp-client
```

*(Requires Node.js 18.0.0 or higher)*

---

## Quick Start

```typescript
import { WhatsApp } from "wp-client";

const wa = new WhatsApp({
  session: "./session",
  printQR: true, // Automatically prints QR to terminal
});

wa.on("qr", (qr) => {
  console.log("Raw QR string:", qr);
});

wa.on("ready", async () => {
  console.log("WhatsApp connected and ready!");

  // Send a text message (always include country code!)
  const sent = await wa.sendMessage("919876543210", "Hello from Node.js!");
  console.log("Message delivered:", sent.id);
});

wa.on("error", (err) => {
  console.error("WhatsApp error:", err);
});

await wa.connect();
```

---

## QR Authentication

On initial connection, WhatsApp requires device pairing via a QR code.

### Terminal Display
Enable `printQR: true` in options to render the QR code directly into your terminal:

```typescript
const wa = new WhatsApp({
  session: "./session",
  printQR: true,
});
```

The terminal will display:
```text
Scan this QR code with WhatsApp:
-----------------------------------------
Scan this QR code using:
WhatsApp → Linked Devices → Link a Device

[QR CODE]
-----------------------------------------
```

### Custom UI / WebSockets
Listen to the `"qr"` event to receive the raw QR string and render it in your custom web dashboard, React frontend, or WebSocket feed:

```typescript
wa.on("qr", (qrString) => {
  // Example: broadcast via WebSocket to your frontend dashboard
  websocketServer.broadcast(JSON.stringify({ type: "QR_CODE", qr: qrString }));
});
```

---

## Persistent Sessions

After scanning the QR code, authentication credentials (pre-keys, signed keys, credentials) are persisted to the specified `session` folder.

```typescript
const wa = new WhatsApp({
  session: "./session", // Directory for credentials
});
```

- **First Launch**: Emits `"qr"` and waits for pairing.
- **Subsequent Launches**: Reuses saved credentials and connects immediately without emitting `"qr"`.
- **Corrupted Sessions**: If session files become corrupt or unreadable, `wp-client` detects this and clears the corrupted state gracefully rather than throwing uncaught JSON syntax errors.

### Multi-Account Sessions
Manage separate WhatsApp accounts simultaneously by pointing to different session directories:

```typescript
const personal = new WhatsApp({ session: "./sessions/personal" });
const support = new WhatsApp({ session: "./sessions/support" });

await Promise.all([
  personal.connect(),
  support.connect(),
]);
```

---

## Sending Messages

### Text Message Overloads
You can use the simple signature `sendMessage(to, text)` or the options object signature:

```typescript
// 1. Shorthand syntax
await wa.sendMessage("919876543210", "Hello!");

// 2. Options object syntax
await wa.sendMessage({
  to: "+91 98765-43210", // Automatically normalized
  text: "Hello from options object!",
});
```

The returned `SentMessage` object contains:
```typescript
{
  id: "3EB0ABC123DEF456",
  to: "919876543210",
  timestamp: 1711364400000
}
```

### Phone Number Validation & Formatting
- Always include the international country code (e.g. `91` for India, `1` for US/Canada, `44` for UK).
- Formatting characters like `+`, spaces, dashes, dots, and parentheses are stripped automatically:
  - `"+91 98765-43210"` ➔ normalized to `"919876543210"`
- Numbers with fewer than 7 digits or more than 15 digits (per E.164) are rejected with `InvalidPhoneNumberError`.
- Country codes are **never** guessed automatically.

---

## Sending Images

Send JPEG, PNG, or WebP images using either a local file path or an in-memory `Buffer`:

```typescript
// From a file path with optional caption
await wa.sendImage({
  to: "919876543210",
  path: "./assets/chart.png",
  caption: "Weekly server uptime report 📊",
});

// From an in-memory Buffer
import fs from "node:fs";
const imageBuffer = fs.readFileSync("./assets/avatar.jpg");

await wa.sendImage({
  to: "919876543210",
  data: imageBuffer,
  caption: "User profile picture",
});
```

---

## Sending Documents

Send PDFs, spreadsheets, Word documents, zip files, or text files:

```typescript
// From a local file path
await wa.sendDocument({
  to: "919876543210",
  path: "./reports/invoice-1042.pdf",
  caption: "Your latest invoice",
});

// From dynamically generated Buffer (e.g., pdfkit / exceljs)
await wa.sendDocument({
  to: "919876543210",
  data: generatedPdfBuffer,
  filename: "invoice-1042.pdf",
  mimetype: "application/pdf",
  caption: "Here is your invoice",
});
```

---

## Receiving Messages

Listen to the `"message"` event to process incoming messages:

```typescript
wa.on("message", async (msg) => {
  console.log(`From: ${msg.from}`);       // Sender phone number or group JID
  console.log(`Author: ${msg.sender}`);   // Participant phone number in groups
  console.log(`Text: ${msg.text}`);       // Extracted text content
  console.log(`Is Group: ${msg.isGroup}`);
  console.log(`Is From Me: ${msg.isFromMe}`);
});
```

---

## Replying

Every `IncomingMessage` includes a built-in `.reply()` method that automatically quotes the original message in the chat:

```typescript
wa.on("message", async (msg) => {
  if (msg.isFromMe) return; // Ignore own messages

  if (msg.text?.toLowerCase() === "ping") {
    await msg.reply("pong 🏓");
  } else if (msg.text?.toLowerCase() === "help") {
    await msg.reply({
      text: "Commands available:\n- ping\n- status\n- support",
    });
  }
});
```

---

## Events

`WhatsApp` extends `TypedEventEmitter` with strict TypeScript typing:

| Event | Arguments | Description |
|---|---|---|
| `qr` | `(qr: string)` | Emitted when a new QR code is ready for scanning. |
| `connected` | `()` | Emitted when the low-level WebSocket connection is established. |
| `ready` | `()` | Emitted when authenticated and fully ready to send/receive messages. |
| `disconnected` | `(reason?: string)` | Emitted when disconnected from WhatsApp. |
| `reconnecting` | `(attempt: number, maxAttempts: number)` | Emitted when an automatic reconnect attempt is triggered. |
| `message` | `(message: IncomingMessage)` | Emitted when an incoming message is received. |
| `message.sent` | `(message: SentMessage)` | Emitted after a message is sent successfully. |
| `error` | `(error: Error)` | Emitted when a connection or protocol error occurs. |
| `logged_out` | `()` | Emitted when the session is logged out (remotely from phone or locally). |

---

## Reconnection

`wp-client` features intelligent reconnection management:
- **Automatic Exponential Backoff**: Retries with increasing delay (`2s`, `4s`, `8s`, `16s`, `30s`) with randomized jitter to prevent thundering herd problems.
- **Configurable Limits**: Set `maxReconnectAttempts` (default: 5) to control retry limits.
- **Disable Auto-Reconnect**: Pass `reconnect: false` if your application manages its own lifecycle.
- **Safe Stop**: Reconnection is permanently halted upon explicit `.disconnect()`, `.destroy()`, or `.logout()`.

```typescript
const wa = new WhatsApp({
  session: "./session",
  reconnect: true,
  maxReconnectAttempts: 10,
  reconnectIntervalMs: 3000,
});
```

---

## Configuration

All constructor options:

```typescript
interface WhatsAppOptions {
  /** Directory path to persist session credentials. Defaults to "./session" */
  session?: string;

  /** Render QR code in terminal automatically. Defaults to false */
  printQR?: boolean;

  /** Custom Logger, LogLevel ("debug" | "info" | "warn" | "error" | "silent"), or false. Defaults to silent */
  logger?: Logger | LogLevel | boolean;

  /** Enable automatic reconnection. Defaults to true */
  reconnect?: boolean;

  /** Maximum reconnect attempts before giving up. Defaults to 5 */
  maxReconnectAttempts?: number;

  /** Base interval between reconnect attempts in milliseconds. Defaults to 2000 */
  reconnectIntervalMs?: number;

  /** Custom transport implementation for testing / alternative engines */
  transport?: WhatsAppTransport;
}
```

---

## TypeScript

`wp-client` is written in TypeScript and exports all public interfaces:

```typescript
import type {
  WhatsAppOptions,
  ConnectionState,
  SentMessage,
  MessageOptions,
  ImageMessageOptions,
  VideoMessageOptions,
  AudioMessageOptions,
  DocumentMessageOptions,
  IncomingMessage,
  WhatsAppEvents,
  Logger,
} from "wp-client";
```

---

## Error Handling

All library errors derive from `WhatsAppError` and include machine-readable error codes:

```typescript
import {
  WhatsApp,
  WhatsAppError,
  ConnectionError,
  InvalidPhoneNumberError,
  MessageError,
  SessionError,
} from "wp-client";

try {
  await wa.sendMessage("bad-number", "Test");
} catch (err) {
  if (err instanceof InvalidPhoneNumberError) {
    console.error("Invalid phone number:", err.message, err.code);
  } else if (err instanceof MessageError) {
    console.error("Failed to deliver message:", err.message);
  } else if (err instanceof WhatsAppError) {
    console.error("General WhatsApp error:", err.code);
  }
}
```

---

## Security

Session credentials grant full access to send and receive messages on your WhatsApp account.
- **Git Ignore**: Always add `session/` and `sessions/` to your `.gitignore`.
- **Restrict File Permissions**: On Linux / macOS, ensure permissions are set to owner-only:
  ```bash
  chmod 700 ./session
  ```
- **Redacted Logging**: Sensitive credentials, pre-keys, and private keys are never included in logs or error messages.
- **Revocation**: If a server is compromised, disconnect the device immediately from your phone under **Settings → Linked Devices**.

---

## Responsible Use

- **No Spam**: Do not use this library to broadcast bulk unsolicited messages. WhatsApp actively bans accounts suspected of automated spam.
- **Rate Limiting**: Space out messages sent from automation pipelines.
- **Opt-In Only**: Only send messages to recipients who have explicitly consented to receive communications.
- **Compliance**: You are solely responsible for complying with local regulations (such as GDPR, TCPA) and WhatsApp's Terms of Service.

---

## Limitations

- **Unofficial Protocol**: WhatsApp Web protocols are proprietary and subject to unannounced updates by WhatsApp.
- **One Primary Phone**: As an unofficial WhatsApp Web companion client, an active WhatsApp account on a primary mobile device is required for QR authentication.
- **Status & Communities**: Focus is on direct messaging, media, and 1-on-1 / group communication. Complex community administration is outside current scope.

---

## Development

```bash
# Install dependencies
npm install

# Run unit tests (Vitest)
npm test

# Check TypeScript types
npm run typecheck

# Run linter
npm run lint

# Format code with Prettier
npm run format

# Build bundle (ESM + CommonJS + .d.ts)
npm run build

# Run manual interactive live test (scans QR and sends 1 message)
npm run test:integration
```

---

## License

[MIT](LICENSE) © 2026 wp-client Contributors
