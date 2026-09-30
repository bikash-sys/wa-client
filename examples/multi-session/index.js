// Multi-session example: Run multiple WhatsApp accounts in one process.
//
// Usage:
//   cd examples/multi-session
//   npm install
//   node index.js

import { WhatsApp } from "whatsapp-msg-client";

const personal = new WhatsApp({
  session: "personal",
  printQRInTerminal: true,
  keepAlive: true,
});

const business = new WhatsApp({
  session: "business",
  printQRInTerminal: true,
  keepAlive: true,
});

personal.on("ready", () => console.log("✓ Personal account connected"));
business.on("ready", () => console.log("✓ Business account connected"));

personal.on("message", async (msg) => {
  if (!msg.isFromMe) {
    console.log(`[Personal] ${msg.from}: ${msg.text}`);
  }
});

business.on("message", async (msg) => {
  if (!msg.isFromMe) {
    console.log(`[Business] ${msg.from}: ${msg.text}`);
  }
});

await Promise.all([personal.connect(), business.connect()]);

console.log("Both sessions running. Press Ctrl+C to stop.");

process.on("SIGINT", async () => {
  await Promise.all([personal.destroy(), business.destroy()]);
  process.exit(0);
});
