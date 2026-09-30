// Basic example: Connect, authenticate, and send a message.
//
// Usage:
//   cd examples/basic
//   npm install
//   node index.js
//
// Set TEST_PHONE environment variable to your target number:
//   TEST_PHONE=919876543210 node index.js

import { WhatsApp } from "whatsapp-msg-client";

const wa = new WhatsApp({
  session: "my-bot",
  printQRInTerminal: true,
});

wa.on("ready", () => {
  console.log("✓ WhatsApp is authenticated and ready!");
});

console.log("Connecting to WhatsApp...");
await wa.connect();

const target = process.env.TEST_PHONE || "919876543210";
const result = await wa.send(target, "Hello from whatsapp-msg-client! 🚀");
console.log("✓ Message sent:", result.id);
