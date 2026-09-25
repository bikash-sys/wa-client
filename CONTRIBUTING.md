# Contributing to whatsapp-mailer

Thank you for your interest in contributing to `whatsapp-mailer`!

## Code of Conduct

This project is built for legitimate automation, personal projects, internal notifications, and non-spam tools.
We strictly prohibit any contributions that promote:
- Bulk messaging or spamming
- Scraping contacts or message data
- Evading rate limits or WhatsApp security controls

## Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/placeholder/whatsapp-mailer.git
   cd whatsapp-mailer
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run tests**:
   ```bash
   npm test
   ```

4. **Verify types & linting**:
   ```bash
   npm run typecheck
   npm run lint
   ```

5. **Build the package**:
   ```bash
   npm run build
   ```

## Pull Request Guidelines

- Ensure all new features or bug fixes include corresponding unit tests in `tests/`.
- Ensure unit tests do NOT depend on a real WhatsApp account or network connection (mock the transport layer).
- Run `npm run prepublishOnly` to verify build, type checking, and tests pass cleanly before submitting.
- Follow TypeScript strict mode guidelines and avoid `any`.
