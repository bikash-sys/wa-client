/**
 * Multi-Session Example: Running multiple independent WhatsApp accounts in one Node.js process.
 *
 * Each instance maintains its own session credentials, connection lifecycle, and event listeners.
 *
 * Run with:
 *   npx tsx examples/multi-session.ts
 */
import { WhatsApp } from "../src/index.js";

async function main() {
  const personal = new WhatsApp({
    session: "personal",
    printQRInTerminal: true,
  });

  const business = new WhatsApp({
    session: "business",
    printQRInTerminal: true,
  });

  personal.on("ready", async () => {
    console.log("✓ Personal WhatsApp account connected!");
    await personal.send("919876543210", "Message from personal account");
  });

  business.on("ready", async () => {
    console.log("✓ Business WhatsApp account connected!");
    await business.send("919876543210", "Message from business account");
  });

  console.log("Connecting both sessions concurrently...");
  await Promise.all([personal.connect(), business.connect()]);

  process.on("SIGINT", async () => {
    console.log("\nDisconnecting both accounts...");
    await Promise.all([personal.destroy(), business.destroy()]);
    process.exit(0);
  });
}

main().catch(console.error);
