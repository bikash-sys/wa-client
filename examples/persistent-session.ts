/**
 * Persistent Session Example: Demonstrates how authentication credentials
 * are preserved across application restarts.
 *
 * 1st run: Scans QR code.
 * 2nd run: Connects immediately without scanning again.
 *
 * Run with:
 *   npx tsx examples/persistent-session.ts
 */
import { WhatsApp } from "../src/index.js";

async function main() {
  const wa = new WhatsApp({
    session: "./session", // Credentials saved here
    printQR: true,
  });

  wa.on("qr", () => {
    console.log("No previous session found. Please scan QR code.");
  });

  wa.on("ready", async () => {
    console.log("✓ WhatsApp connected using existing session!");
    console.log("Ready to send notifications.");
  });

  wa.on("disconnected", (reason) => {
    console.log("Disconnected:", reason);
  });

  console.log("Connecting...");
  await wa.connect();

  process.on("SIGINT", async () => {
    console.log("\nDisconnecting...");
    await wa.destroy();
    process.exit(0);
  });
}

main().catch(console.error);
