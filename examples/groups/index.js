// Groups example: Send messages to groups and list group chats.
//
// Usage:
//   cd examples/groups
//   npm install
//   node index.js

import { WhatsApp } from "whatsapp-msg-client";

const wa = new WhatsApp({
  session: "my-bot",
  printQRInTerminal: true,
});

await wa.connect();

// List your group chats
const groups = await wa.getChats({ type: "group", limit: 5 });
console.log("Your groups:");
for (const group of groups) {
  console.log(`  - ${group.name} (${group.id})`);
}

// Send to a group by name
// await wa.sendToGroup("Project Team", "Hello team!");

// Send to a group by JID
// await wa.sendToGroup("120363414422062021@g.us", "Hello group!");
