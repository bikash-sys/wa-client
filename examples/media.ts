/**
 * Media Messaging Example: Sending images and documents via file path or Buffer.
 *
 * Run with:
 *   npx tsx examples/media.ts
 */
import fs from "node:fs";
import path from "node:path";
import { WhatsApp } from "../src/index.js";

async function main() {
  const wa = new WhatsApp({
    session: "./session",
    printQR: true,
  });

  wa.on("ready", async () => {
    console.log("✓ WhatsApp is ready. Preparing media send...");

    const target = process.env.TEST_PHONE || "919876543210";

    // 1. Send an image via file path
    const sampleImagePath = path.resolve("./examples/sample.jpg");
    if (fs.existsSync(sampleImagePath)) {
      console.log("Sending image from path...");
      await wa.sendImage({
        to: target,
        path: sampleImagePath,
        caption: "Here is your requested photo 📸",
      });
      console.log("✓ Image sent");
    }

    // 2. Send a document via in-memory Buffer
    console.log("Sending document from in-memory Buffer...");
    const samplePdfBuffer = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Title (Invoice #1042) >>\nendobj\ntrailer\n<< >>\n%%EOF",
    );

    await wa.sendDocument({
      to: target,
      data: samplePdfBuffer,
      filename: "invoice-1042.pdf",
      caption: "Your monthly invoice receipt 📄",
    });
    console.log("✓ Document sent");

    console.log("Done! You can disconnect now.");
    await wa.disconnect();
    process.exit(0);
  });

  await wa.connect();
}

main().catch(console.error);
