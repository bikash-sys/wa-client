# Security Policy

## Credential & Session Protection

WhatsApp Web session credentials stored on disk provide direct, authenticated access to your WhatsApp account.
Treat the session directory with the same level of care as private cryptographic keys or production API secrets.

### Security Best Practices
1. **Never commit session files to version control**: Ensure `.gitignore` ignores `session/`, `sessions/`, and any `*.json` files generated during pairing.
2. **Restrict directory permissions**: On Unix-like operating systems (Linux, macOS), ensure the session directory has strict owner-only permissions:
   ```bash
   chmod 700 ./session
   chmod 600 ./session/*
   ```
3. **Never log sensitive data**: Do not print session objects, private keys, pre-keys, or authorization headers into logs. `whatsapp-msg-client`'s internal logger automatically redacts sensitive authentication fields.
4. **Environment isolation**: Store credentials in persistent, isolated volumes in containerized deployments (e.g., Docker secrets or private container volume mounts).
5. **Session Revocation**: If credentials are compromised, immediately disconnect the session from your WhatsApp mobile app under **Linked Devices** -> tap the device -> **Log Out**.

## Reporting a Vulnerability

If you discover a security vulnerability in `whatsapp-msg-client`, please report it responsibly by contacting the maintainers directly or opening a private security advisory on GitHub.

Please do not disclose security issues in public issues or discussions until a fix has been prepared and published.
