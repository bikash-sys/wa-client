/**
 * Interactive Live Integration Test
 *
 * Requirements:
 * - Requires explicit execution: `npm run test:integration`
 * - Reads destination phone number from environment variable `TEST_PHONE` or prompts.
 * - Does NOT hardcode any phone numbers or credentials.
 *
 * Flow:
 *   1. Creates client with terminal QR enabled
 *   2. Displays QR code
 *   3. Waits for WhatsApp scan & authentication
 *   4. Emits ready
 *   5. Sends single test message to recipient
 *   6. Disconnects and exits cleanly
 */
import readline from "node:readline";
import { WhatsApp } from "../src/index.js";

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function run() {
  console.log("==========================================");
  console.log("whatsapp-mailer: Live Integration Test");
  console.log("==========================================");
  console.log("This test connects to a live WhatsApp account via QR authentication");
  console.log("and sends a single verification message.\n");

  let recipient = process.env.TEST_PHONE;
  if (!recipient) {
    recipient = await prompt(
      "Enter recipient phone number with country code (e.g. 919876543210): ",
    );
  }

  if (!recipient) {
    console.error("Error: Recipient phone number is required to run the test.");
    process.exit(1);
  }

  const wa = new WhatsApp({
    session: "./.temp/integration-session",
    printQR: true,
  });

  wa.on("qr", () => {
    console.log("Please scan the QR code above with your WhatsApp app.");
  });

  wa.on("ready", async () => {
    console.log("✓ WhatsApp authenticated and ready!");
    console.log(`Sending live test message to: ${recipient}...`);

    try {
      const result = await wa.sendMessage(
        recipient!,
        "Hello! This is a test message sent via whatsapp-mailer.",
      );
      console.log("✓ Message delivered successfully!");
      console.log("Message info:", result);
    } catch (err) {
      console.error("✗ Failed to send test message:", err);
    } finally {
      console.log("Closing connection...");
      await wa.destroy();
      console.log("Test finished cleanly.");
      process.exit(0);
    }
  });

  wa.on("error", (err) => {
    console.error("Test error:", err);
  });

  console.log("Initiating connection...");
  await wa.connect();
}

run().catch((err) => {
  console.error("Integration test failed:", err);
  process.exit(1);
});
