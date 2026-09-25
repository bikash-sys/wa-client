# whatsapp-msg-client

> Simple, developer-friendly WhatsApp Web client for Node.js with QR authentication, named persistent sessions, messaging, media attachments, and event handling. Built to feel as intuitive as Nodemailer.

[![npm version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://www.npmjs.com/package/whatsapp-msg-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org)

---

## Important Notice

**whatsapp-msg-client is an unofficial WhatsApp Web client wrapper.**
It is **not** an official Meta or WhatsApp API, SDK, or product, and is **not affiliated with, maintained, authorized, or endorsed by Meta Platforms, Inc. or WhatsApp LLC**.

This library is designed for legitimate automation, personal notifications, server alerts, internal tools, and customer assistance bots. It does **not** provide tools for spamming, bulk blasts, scraping, contact harvesting, or bypassing WhatsApp restrictions. Always adhere to WhatsApp's Terms of Service and applicable privacy regulations.

---

## How It Works

Each WhatsApp account is stored as a named session. Scan the QR code once, give the session a name such as `personal` or `business`, and the credentials are saved locally. Future runs automatically reconnect to that WhatsApp account without requiring another QR scan.

---

## Features

- 🚀 **Nodemailer-like Simplicity**: Clean, promise-based `wa.send()` API.
- 📱 **QR Authentication**: Simple QR code event emission with automatic terminal QR code rendering (`printQRInTerminal: true`).
- 💾 **Named Persistent Sessions**: Each account is stored separately in `./auth/<session>/` (e.g. `./auth/personal/`, `./auth/business/`).
- 👥 **Multiple Accounts in One Process**: Run multiple WhatsApp accounts simultaneously without credential crosstalk.
- 🗂️ **Session Management API**: Create, list, inspect, and remove sessions both statically and via instance methods.
- 💬 **Simple Messaging**: `wa.send("919876543210", "Hello!")` and `wa.sendMessage()` backwards compatibility.
- 📎 **Media Attachments**: Send images, videos, audio/voice notes, and documents (PDFs, spreadsheets) via file paths or in-memory `Buffer`s.
- ↩️ **Native Replies**: Convenient `message.reply("...")` helper with automatic quoting.
- 🔄 **Smart Reconnection**: Built-in exponential backoff with jitter and customizable retry limits.
- 🔒 **Security First**: Automatic sanitization of logs preventing credential/private key leaks, restrictive file permissions (`0700`), and path traversal protection.
- 🔷 **Strict TypeScript**: 100% TypeScript with full type definitions (`.d.ts` and `.d.cts`) and comprehensive TSDoc comments.

---

## Installation

```bash
npm install whatsapp-msg-client
```

*(Requires Node.js 18.0.0 or higher)*

---

## Basic Usage

```typescript
import { WhatsApp } from "whatsapp-msg-client";

const wa = new WhatsApp({
  session: "personal",
  printQRInTerminal: true, // Automatically prints the QR code in your terminal
});

wa.on("message", async (msg) => {
  console.log(`Received message from ${msg.from}: ${msg.text}`);

  if (msg.text === "hi") {
    await msg.reply("Hello!");
  }
});

await wa.connect();

// Send a message (always include country code!)
await wa.send("919340748552", "Hello from my personal WhatsApp!");
```

---

## Sessions

Each session represents an independent WhatsApp profile stored on disk under `./auth/<session-name>/`.

### Default Session
If no session name is provided, `whatsapp-msg-client` defaults to `"default"` and stores credentials in `./auth/default/`:

```typescript
const wa = new WhatsApp(); // Uses ./auth/default/
```

### Named Sessions
Give your session a name to organize profiles:

```typescript
const personal = new WhatsApp({ session: "personal" }); // ./auth/personal/
const business = new WhatsApp({ session: "business" }); // ./auth/business/
```

### Custom Auth Root Directory
You can customize the parent directory where session folders are placed:

```typescript
const wa = new WhatsApp({
  authDir: "./my-whatsapp-auth",
  session: "business",
});
// Credentials stored in ./my-whatsapp-auth/business/
```

> **Security Note**: Session names are strictly validated to prevent filesystem traversal (e.g. `../` or absolute paths are rejected).

---

## Multiple WhatsApp Accounts

Multiple sessions can run at the same time in a single Node.js application:

```typescript
import { WhatsApp } from "whatsapp-msg-client";

const personal = new WhatsApp({
  session: "personal",
  printQRInTerminal: true,
});

const business = new WhatsApp({
  session: "business",
  printQRInTerminal: true,
});

await personal.connect();
await business.connect();

await personal.send("919340748552", "Hello from personal!");
await business.send("919340748552", "Hello from business!");
```

Messages are strictly sent from the WhatsApp account associated with that specific session instance.

---

## Session Management

`whatsapp-msg-client` includes built-in APIs to create, list, check, and delete sessions.

### Listing Sessions
Inspect all sessions saved on disk or active in memory:

```typescript
const sessions = await WhatsApp.listSessions();
console.log(sessions);
```

Returns clean, safe information without exposing sensitive credentials or keys:

```json
[
  {
    "name": "business",
    "connected": true,
    "state": "connected",
    "authDir": "/path/to/project/auth",
    "sessionPath": "/path/to/project/auth/business",
    "hasCredentials": true
  },
  {
    "name": "personal",
    "connected": false,
    "state": "disconnected",
    "authDir": "/path/to/project/auth",
    "sessionPath": "/path/to/project/auth/personal",
    "hasCredentials": true
  }
]
```

### Checking If a Session Exists
```typescript
if (WhatsApp.hasSession("business")) {
  console.log("Business session exists on disk or in memory");
}
```

### Creating Sessions
```typescript
const client = await WhatsApp.createSession("customer-support", {
  printQRInTerminal: true,
});
await client.connect();
```

### Removing Sessions
When you remove a session:
1. The active connection is disconnected gracefully.
2. Reconnection timers are cancelled.
3. The session is removed from memory.
4. The authentication directory (`./auth/<name>/`) is deleted from disk.
5. Other sessions remain completely untouched.

```typescript
// Static removal
await WhatsApp.removeSession("business");

// Or from an instance
await wa.removeSession();
```

---

## Persistent Authentication

- **First Launch**: Shows a QR code in the terminal (or emits the `"qr"` event).
- **Subsequent Launches**: Reconnects instantly using stored credentials in `./auth/<name>/` without showing a QR code.
- **Corrupted Sessions**: If session files are damaged or corrupted, `whatsapp-msg-client` automatically resets the corrupted state gracefully rather than crashing.

---

## Sending Messages

### Text Messages
Use the primary `send()` method (or its backwards-compatible alias `sendMessage()`):

```typescript
// 1. Shorthand: (recipient, text)
await wa.send("919876543210", "Hello there!");

// 2. Options object syntax
await wa.send({
  to: "+91 98765-43210", // Automatically normalized
  text: "Hello from options object!",
});
```

### Images
Send images from local files or in-memory `Buffer`s:

```typescript
// Local file path
await wa.sendImage("919876543210", "./assets/photo.jpg", "Check this photo!");

// In-memory Buffer
await wa.sendImage({
  to: "919876543210",
  data: imageBuffer,
  caption: "Profile picture",
});
```

### Videos
```typescript
await wa.sendVideo("919876543210", "./assets/video.mp4", "Watch this clip");
```

### Audio / Voice Notes
```typescript
// Standard audio
await wa.sendAudio("919876543210", "./assets/song.mp3");

// Recorded voice note (Push-To-Talk)
await wa.sendAudio("919876543210", "./assets/voice.mp3", true);
```

### Documents (PDF, Excel, Zip, etc.)
```typescript
// Local file path
await wa.sendDocument("919876543210", "./reports/invoice.pdf", "Invoice #1042");

// In-memory Buffer
await wa.sendDocument({
  to: "919876543210",
  data: pdfBuffer,
  filename: "invoice.pdf",
  mimetype: "application/pdf",
  caption: "Your invoice is attached",
});
```

---

## Receiving Messages

Listen to the `"message"` event:

```typescript
wa.on("message", async (msg) => {
  console.log(`Session: ${msg.session}`);   // e.g. "personal"
  console.log(`From: ${msg.from}`);         // Phone number or group JID
  console.log(`Author: ${msg.sender}`);     // Individual participant in groups
  console.log(`Text: ${msg.text}`);         // Message text content
  console.log(`Is Group: ${msg.isGroup}`);
  console.log(`Is From Me: ${msg.isFromMe}`);

  // Built-in reply helper with automatic quoting
  if (msg.text === "ping") {
    await msg.reply("pong 🏓");
  }
});
```

---

## Events

| Event | Arguments | Description |
|---|---|---|
| `qr` | `(qr: string)` | Emitted when a new QR code is ready for scanning. |
| `connected` | `()` | Emitted when the low-level WebSocket connection is established. |
| `ready` | `()` | Emitted when authenticated and fully ready to send/receive messages. |
| `disconnected` | `(reason?: string)` | Emitted when disconnected from WhatsApp. |
| `reconnecting` | `(attempt: number, maxAttempts: number)` | Emitted when an automatic reconnect attempt is triggered. |
| `message` | `(message: IncomingMessage)` | Emitted when an incoming message is received (includes `.session`). |
| `message.sent` | `(message: SentMessage)` | Emitted after a message is sent successfully (includes `.session`). |
| `error` | `(error: Error)` | Emitted when a connection or protocol error occurs. |
| `logged_out` | `()` | Emitted when the session is logged out. |
| `session.removed` | `(sessionName: string)` | Emitted when a session is removed. |

---

## Configuration Options

```typescript
interface WhatsAppOptions {
  /** Named session profile (e.g. "personal", "business"). Defaults to "default" */
  session?: string;

  /** Root directory for session credential storage. Defaults to "./auth" */
  authDir?: string;

  /** Render QR code in terminal automatically. Defaults to false */
  printQR?: boolean;

  /** Alias for printQR */
  printQRInTerminal?: boolean;

  /** Custom Logger, LogLevel, or false. Defaults to silent */
  logger?: Logger | LogLevel | boolean;

  /** Enable automatic reconnection. Defaults to true */
  reconnect?: boolean;

  /** Maximum reconnect attempts before giving up. Defaults to 5 */
  maxReconnectAttempts?: number;

  /** Base interval between reconnect attempts in milliseconds. Defaults to 2000 */
  reconnectIntervalMs?: number;

  /** Custom transport implementation for testing / mocking */
  transport?: WhatsAppTransport;
}
```

---

## Security

Session credentials grant full access to send and receive messages on your WhatsApp account.
- **Git Ignore**: Always add `auth/` to your `.gitignore`.
- **Restrict File Permissions**: Sessions are created with owner-only access (`0700`).
- **Redacted Logging**: Sensitive credentials, pre-keys, and private keys are never included in logs or error messages.
- **Revocation**: If a device is lost or compromised, unlink the session immediately from your phone under **WhatsApp → Settings → Linked Devices**.

---

## Development & Verification

```bash
# Run tests
npm test

# Check TypeScript types
npm run typecheck

# Lint codebase
npm run lint

# Format with Prettier
npm run format

# Build distribution bundle
npm run build
```

---

## License

[MIT](LICENSE) © 2026 whatsapp-msg-client Contributors

