/**
 * Bot Example: Simple auto-responder demonstrating incoming messages and message.reply().
 *
 * Rules:
 *   - "hello" -> replies with "Hello!"
 *   - "ping"  -> replies with "pong"
 *
 * Run with:
 *   npx tsx examples/bot.ts
 */
import { WhatsApp } from "../src/index.js";

async function main() {
  const wa = new WhatsApp({
    session: "./session",
    printQR: true,
  });

  wa.on("ready", () => {
    console.log("✓ Bot is active! Send 'ping' or 'hello' to test.");
  });

  wa.on("message", async (message) => {
    // Ignore messages sent by our own account
    if (message.isFromMe) return;

    const text = message.text?.trim().toLowerCase();
    console.log(`[Incoming Message] From: ${message.from} (${message.sender}): "${message.text}"`);

    try {
      if (text === "hello") {
        await message.reply("Hello there! 👋 How can I help you today?");
        console.log(`Replied to ${message.from}`);
      } else if (text === "ping") {
        await message.reply("pong 🏓");
        console.log(`Replied to ${message.from}`);
      }
    } catch (err) {
      console.error("Error replying to message:", err);
    }
  });

  await wa.connect();

  process.on("SIGINT", async () => {
    console.log("\nStopping bot...");
    await wa.destroy();
    process.exit(0);
  });
}

main().catch(console.error);
