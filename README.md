# whatsapp-msg-client

A TypeScript/Node.js WhatsApp client for sending messages, media, receiving messages, managing groups, and building WhatsApp bots with persistent sessions.

[![npm version](https://img.shields.io/npm/v/whatsapp-msg-client.svg)](https://www.npmjs.com/package/whatsapp-msg-client)
[![npm downloads](https://img.shields.io/npm/dm/whatsapp-msg-client.svg)](https://www.npmjs.com/package/whatsapp-msg-client)
[![License: MIT](https://img.shields.io/github/license/bikash-sys/wa-client.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org)
[![CI](https://github.com/bikash-sys/wa-client/actions/workflows/ci.yml/badge.svg)](https://github.com/bikash-sys/wa-client/actions/workflows/ci.yml)

Built on [Baileys](https://github.com/WhiskeySockets/Baileys). Designed for WhatsApp bots, automation, server alerts, AI assistants, and multi-session applications.

> **Disclaimer**: This is an unofficial WhatsApp Web client wrapper. It is **not** affiliated with, maintained, authorized, or endorsed by Meta Platforms, Inc. or WhatsApp LLC. Use responsibly and in compliance with [WhatsApp's Terms of Service](https://www.whatsapp.com/legal/terms-of-service).

---

## Features

- **Send & receive messages** — text, images, videos, audio, documents
- **Group messaging** — send to groups by name or JID
- **Chat listing** — fetch recent private, group, or all chats
- **QR-code authentication** — scan once, auto-reconnect forever
- **Persistent sessions** — credentials stored on disk per named session
- **Multiple sessions** — run independent WhatsApp accounts in one process
- **Incoming message events** — listen and reply with `msg.reply()`
- **Auto-reconnect** — exponential backoff with jitter
- **Health & status APIs** — `isConnected()`, `isReady()`, `health()`
- **ESM + CommonJS** — dual-format build with full TypeScript types
- **Session management** — create, list, inspect, and remove sessions

---

## Quick Start

### Install

```bash
npm install whatsapp-msg-client
```

Requires Node.js ≥ 18.0.0.

### Send a Message

```typescript
import { WhatsApp } from "whatsapp-msg-client";

const wa = new WhatsApp({
  session: "my-bot",
  printQRInTerminal: true,
});

await wa.connect();

await wa.send("919876543210", "Hello from my WhatsApp bot!");
```

1. Install the package.
2. Create a client with a session name.
3. Scan the QR code in your terminal (first run only).
4. Send a message. Future runs reconnect automatically.

---

## API Reference

### Constructor

```typescript
const wa = new WhatsApp(options?);
```

| Option | Type | Default | Description |
|---|---|---|---|
| `session` | `string` | `"default"` | Named session profile for credential storage |
| `authDir` | `string` | `"./auth"` | Root directory for session folders |
| `printQR` | `boolean` | `false` | Print QR code in terminal |
| `printQRInTerminal` | `boolean` | `false` | Alias for `printQR` |
| `logger` | `Logger \| LogLevel \| boolean` | silent | Custom logger, log level, or `false` |
| `reconnect` | `boolean` | `true` | Automatic reconnection on disconnect |
| `maxReconnectAttempts` | `number` | `5` | Max consecutive reconnection attempts |
| `reconnectIntervalMs` | `number` | `2000` | Base interval between reconnect attempts (ms) |
| `keepAlive` | `boolean` | `false` | Keep connection alive after one-shot sends |
| `transport` | `WhatsAppTransport` | — | Custom transport for testing/mocking |

### connect()

```typescript
await wa.connect();
```

Establishes the WhatsApp connection. Shows a QR code on first use or reconnects using saved credentials.

### send()

```typescript
// String arguments
await wa.send("919876543210", "Hello!");

// Options object
await wa.send({ to: "+91 98765-43210", text: "Hello!" });
```

Phone numbers are automatically normalized (country code required, formatting is flexible).

### sendToGroup()

```typescript
// By group name (exact, case-sensitive match)
await wa.sendToGroup("Project Team", "Hello team!");

// By group JID
await wa.sendToGroup("120363414422062021@g.us", "Hello group!");

// With options object
await wa.sendToGroup("Project Team", { text: "Meeting at 3pm" });
```

- If the group name is not found, throws: `Group not found: <name>`
- If multiple groups share the same name, throws: `Multiple groups found with name: <name>. Use the group JID instead.`

### sendImage()

```typescript
// File path
await wa.sendImage("919876543210", "./photo.jpg", "Check this out!");

// Buffer
await wa.sendImage({ to: "919876543210", data: buffer, caption: "Photo" });
```

### sendVideo()

```typescript
await wa.sendVideo("919876543210", "./clip.mp4", "Watch this");
```

### sendAudio()

```typescript
// Standard audio
await wa.sendAudio("919876543210", "./song.mp3");

// Voice note (push-to-talk)
await wa.sendAudio("919876543210", "./voice.mp3", true);
```

### sendDocument()

```typescript
// File path
await wa.sendDocument("919876543210", "./invoice.pdf", "Invoice #1042");

// Buffer
await wa.sendDocument({
  to: "919876543210",
  data: pdfBuffer,
  filename: "invoice.pdf",
  caption: "Your invoice",
});
```

### getChats()

```typescript
const chats = await wa.getChats({ limit: 5, type: "all" });
```

| Option | Type | Default | Description |
|---|---|---|---|
| `limit` | `number` | `20` | Max chats to return (1–100) |
| `type` | `"all" \| "private" \| "group"` | `"all"` | Filter by chat type |

Returns an array of `WhatsAppChat` objects sorted by most recent activity:

```typescript
interface WhatsAppChat {
  id: string;        // "919876543210@s.whatsapp.net" or "120363...@g.us"
  name: string;      // Contact name or group subject
  type: "private" | "group";
  lastMessage?: string;
  timestamp?: number; // Unix timestamp
}
```

```typescript
// Private chats only
const privates = await wa.getChats({ limit: 10, type: "private" });

// Group chats only
const groups = await wa.getChats({ limit: 10, type: "group" });
```

### isConnected()

```typescript
wa.isConnected(); // true when the WebSocket connection is open
```

### isReady()

```typescript
wa.isReady(); // true when authenticated and ready for messaging
```

### isReconnecting()

```typescript
wa.isReconnecting(); // true while attempting automatic reconnection
```

### getStatus()

```typescript
const status = wa.getStatus();
// {
//   session: "my-bot",
//   connected: true,
//   ready: true,
//   reconnecting: false,
//   state: "connected"
// }
```

### health()

```typescript
const h = wa.health();
// { ...status, healthy: true }
```

`healthy` is `true` only when `connected && ready && !reconnecting`.

---

## Receiving Messages

```typescript
wa.on("message", async (msg) => {
  console.log(`From: ${msg.from}`);
  console.log(`Text: ${msg.text}`);
  console.log(`Group: ${msg.isGroup}`);

  if (msg.text === "ping") {
    await msg.reply("pong 🏓");
  }
});
```

### IncomingMessage

| Property | Type | Description |
|---|---|---|
| `id` | `string` | Unique message ID |
| `from` | `string` | Sender phone number or group JID |
| `sender` | `string` | Individual sender (participant in groups) |
| `text` | `string?` | Message text content |
| `timestamp` | `number` | Unix timestamp (ms) |
| `isGroup` | `boolean` | Whether the message is from a group |
| `isFromMe` | `boolean` | Whether sent by the authenticated account |
| `session` | `string?` | Session profile name |
| `reply(text)` | `function` | Reply with automatic quoting |

---

## Events

| Event | Payload | Description |
|---|---|---|
| `qr` | `(qr: string)` | New QR code ready for scanning |
| `connected` | `()` | WebSocket connection established |
| `ready` | `()` | Authenticated and ready to send/receive |
| `disconnected` | `(reason?: string)` | Connection closed |
| `reconnecting` | `(attempt, maxAttempts)` | Reconnection attempt triggered |
| `message` | `(message: IncomingMessage)` | Incoming message received |
| `message.sent` | `(message: SentMessage)` | Message sent successfully |
| `error` | `(error: Error)` | Connection or protocol error |
| `logged_out` | `()` | Session logged out |
| `session.removed` | `(sessionName: string)` | Session removed and cleaned up |

---

## Sessions

Each session is an independent WhatsApp profile stored on disk under `./auth/<session-name>/`.

```typescript
// Default session (./auth/default/)
const wa = new WhatsApp();

// Named sessions
const personal = new WhatsApp({ session: "personal" });
const business = new WhatsApp({ session: "business" });

// Custom auth directory
const wa = new WhatsApp({ authDir: "./my-auth", session: "bot" });
```

### Multiple Sessions

Run multiple WhatsApp accounts simultaneously:

```typescript
const personal = new WhatsApp({ session: "personal", printQRInTerminal: true });
const business = new WhatsApp({ session: "business", printQRInTerminal: true });

await Promise.all([personal.connect(), business.connect()]);

await personal.send("919876543210", "From personal");
await business.send("919876543210", "From business");
```

### Session Management

```typescript
// List all sessions
const sessions = await WhatsApp.listSessions();

// Check if a session exists
if (WhatsApp.hasSession("business")) { /* ... */ }

// Create a new session
const client = await WhatsApp.createSession("support", { printQRInTerminal: true });

// Remove a session (disconnects, clears credentials)
await WhatsApp.removeSession("business");
// Or from an instance:
await wa.removeSession();
```

---

## Building an AI Bot

`whatsapp-msg-client` provides the WhatsApp messaging layer. You can integrate any AI provider in your application:

```typescript
import { WhatsApp } from "whatsapp-msg-client";

const wa = new WhatsApp({
  session: "ai-bot",
  printQRInTerminal: true,
  keepAlive: true,
});

wa.on("message", async (msg) => {
  if (msg.isFromMe) return;

  // Call your AI provider (OpenAI, Gemini, Claude, etc.)
  const aiResponse = await yourAIProvider.chat(msg.text);

  await msg.reply(aiResponse);
});

await wa.connect();
```

The package does **not** include or depend on any AI provider. Your application controls the AI integration, model selection, and API keys.

---

## Security

### Session Credential Protection

Session credentials grant full access to send and receive messages on your WhatsApp account. Treat them like private keys.

- **Never commit credentials** — `auth/` is in `.gitignore` by default
- **Restricted permissions** — session directories are created with `0700` (owner-only)
- **Redacted logging** — credentials, pre-keys, and private keys are never logged
- **Path traversal protection** — session names are validated to prevent filesystem escapes
- **Media size limits** — 100 MB enforcement on media attachments
- **Filename sanitization** — document filenames are sanitized via `path.basename()`
- **Session revocation** — if compromised, unlink the device from WhatsApp → Settings → Linked Devices

For vulnerability reporting, see [SECURITY.md](SECURITY.md).

---

## Examples

See the [`examples/`](examples/) directory:

| Example | Description |
|---|---|
| [`basic/`](examples/basic/) | Connect, authenticate, and send a message |
| [`receive-reply/`](examples/receive-reply/) | Listen for messages and auto-reply |
| [`groups/`](examples/groups/) | Send messages to groups and list group chats |
| [`media/`](examples/media/) | Send images, documents, audio, and video |
| [`multi-session/`](examples/multi-session/) | Run multiple WhatsApp accounts simultaneously |

```bash
# Run an example
cd examples/basic && npm install && node index.js
```

---

## Development

```bash
git clone https://github.com/bikash-sys/wa-client.git
cd wa-client
npm install

npm test              # Run tests
npm run typecheck     # TypeScript type checking
npm run lint          # ESLint
npm run format        # Prettier
npm run build         # Build dist/
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

---

## License

[MIT](LICENSE) © 2026 whatsapp-msg-client Contributors
