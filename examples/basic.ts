/**
 * Basic Example: Connect with QR code and send a simple message.
 *
 * Run with:
 *   npx tsx examples/basic.ts
 */
import { WhatsApp } from "../src/index.js";

async function main() {
  const wa = new WhatsApp({
    session: "personal",
    printQRInTerminal: true, // Automatically prints the QR code in the terminal
  });

  wa.on("qr", (qr) => {
    console.log("Raw QR code string received (can be sent via WebSocket or rendered in UI):");
    console.log(qr);
  });

  wa.on("connected", () => {
    console.log("✓ Connection socket opened");
  });

  wa.on("ready", async () => {
    console.log("✓ WhatsApp is authenticated and ready!");

    const targetNumber = process.env.TEST_PHONE || "919876543210";
    console.log(`Sending message to ${targetNumber}...`);

    try {
      const result = await wa.send(targetNumber, "Hello from whatsapp-msg-client! 🚀");
      console.log("✓ Message sent successfully:", result);
    } catch (err) {
      console.error("Failed to send message:", err);
    }
  });

  wa.on("disconnected", (reason) => {
    console.log("Disconnected:", reason);
  });

  wa.on("error", (err) => {
    console.error("Client error:", err);
  });

  console.log("Connecting to WhatsApp...");
  await wa.connect();

  // Handle graceful exit
  process.on("SIGINT", async () => {
    console.log("\nClosing WhatsApp connection...");
    await wa.destroy();
    process.exit(0);
  });
}

main().catch(console.error);
