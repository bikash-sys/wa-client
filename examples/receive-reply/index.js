// Receive and reply example: Listen for incoming messages and auto-reply.
//
// Usage:
//   cd examples/receive-reply
//   npm install
//   node index.js

import { WhatsApp } from "whatsapp-msg-client";

const wa = new WhatsApp({
  session: "my-bot",
  printQRInTerminal: true,
  keepAlive: true,
});

wa.on("ready", () => {
  console.log("✓ Bot is online! Send 'ping' or 'hello' to test.");
});

wa.on("message", async (msg) => {
  if (msg.isFromMe) return;

  console.log(`[${msg.from}] ${msg.text}`);

  const text = msg.text?.trim().toLowerCase();

  if (text === "ping") {
    await msg.reply("pong 🏓");
  } else if (text === "hello") {
    await msg.reply("Hello there! 👋");
  }
});

await wa.connect();

process.on("SIGINT", async () => {
  console.log("\nStopping bot...");
  await wa.destroy();
  process.exit(0);
});
