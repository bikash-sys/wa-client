# Examples

Runnable examples demonstrating `whatsapp-msg-client` features.

## Setup

Each example is a standalone directory. To run one:

```bash
cd examples/basic
npm install
node index.js
```

Set `TEST_PHONE` to your target phone number (with country code):

```bash
TEST_PHONE=919876543210 node index.js
```

## Examples

| Directory                          | Description                                   |
| ---------------------------------- | --------------------------------------------- |
| [`basic/`](basic/)                 | Connect, authenticate via QR, send a message  |
| [`receive-reply/`](receive-reply/) | Listen for incoming messages and auto-reply   |
| [`groups/`](groups/)               | List group chats and send group messages      |
| [`media/`](media/)                 | Send images, documents, audio, video          |
| [`multi-session/`](multi-session/) | Run multiple WhatsApp accounts in one process |

## Notes

- On first run, scan the QR code displayed in your terminal.
- On subsequent runs, the session reconnects automatically.
- Credentials are stored in `./auth/<session-name>/` and should never be committed to version control.
