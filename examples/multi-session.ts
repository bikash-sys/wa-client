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
    session: "./sessions/personal",
    printQR: true,
  });

  const business = new WhatsApp({
    session: "./sessions/business",
    printQR: true,
  });

  personal.on("ready", () => {
    console.log("✓ Personal WhatsApp account connected!");
  });

  business.on("ready", () => {
    console.log("✓ Business WhatsApp account connected!");
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
