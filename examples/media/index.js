// Media example: Send images and documents.
//
// Usage:
//   cd examples/media
//   npm install
//   TEST_PHONE=919876543210 node index.js

import { WhatsApp } from "whatsapp-msg-client";

const wa = new WhatsApp({
  session: "my-bot",
  printQRInTerminal: true,
});

await wa.connect();

const target = process.env.TEST_PHONE || "919876543210";

// Send an image (uncomment and provide a real path)
// await wa.sendImage(target, "./photo.jpg", "Check this out! 📸");

// Send a document from a Buffer
const pdfBuffer = Buffer.from("%PDF-1.4 sample content");
await wa.sendDocument({
  to: target,
  data: pdfBuffer,
  filename: "example.pdf",
  caption: "Here's your document 📄",
});

console.log("✓ Media sent!");
