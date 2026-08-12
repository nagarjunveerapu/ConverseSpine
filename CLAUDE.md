# ConverseSpine — session rules

## Hard rules

- **Before any push or PR: `npm run typecheck && npm test`.** CI enforces what the E2E runs don't; a red typecheck or unit run must never reach a PR. (NayaDesk's equivalent: `npm run lint:tokens && npm run test:unit`.)
