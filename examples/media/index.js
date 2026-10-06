// Media example: Send images, videos, audio, voice notes, and documents.
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

// 1. Send an Image from a file path
// await wa.sendImage(target, "./photo.jpg", "Check this out! 📸");

// 2. Send a Video with caption
// await wa.sendVideo(target, "./clip.mp4", "Watch this clip 🎥");

// 3. Send standard Audio (e.g. MP3/WAV)
// await wa.sendAudio(target, "./song.mp3");

// 4. Send a Voice Note (Push-To-Talk)
// await wa.sendAudio(target, "./voice.ogg", true);

// 5. Send a Document from a Buffer
const pdfBuffer = Buffer.from("%PDF-1.4 sample content");
await wa.sendDocument({
  to: target,
  data: pdfBuffer,
  filename: "example.pdf",
  caption: "Here's your document 📄",
});

// 6. Send a Document from a file path
// await wa.sendDocument(target, "./invoice.pdf", "invoice.pdf", "Your monthly invoice 📊");

console.log("✓ Media sent!");
