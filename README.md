# ConverseSpine / ConverseEngine

**ConverseEngine** — clean-room turn kernel (see [docs/CONVERSE_ENGINE.md](docs/CONVERSE_ENGINE.md)).  
NayaDesk CRM, WhatsApp ingress, quality eval.

[![CI](https://github.com/nagarjunveerapu/ConverseSpine/actions/workflows/ci.yml/badge.svg)](https://github.com/nagarjunveerapu/ConverseSpine/actions/workflows/ci.yml)

**CI/CD:** PR → CI (typecheck + tests). Merge to `main` → auto-deploy **converse-spine-dev**. Prod is manual. See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

## Quick start

```bash
# NayaDesk CRM (terminal 1)
cd ../NayaDesk && npx wrangler dev --port 8787

# ConverseSpine (terminal 2)
npm install
cp .dev.vars.example .dev.vars   # BOT_SHARED_SECRET from NayaDesk
npm run demo                     # CLI chat
# or
npm run dev                      # Worker on :8788
```

## Quality eval (primary QA — NOT golden regression)

Generates **fresh buyer personas** each run, simulates multi-turn WhatsApp conversations, LLM-judges transcript quality:

```bash
npm run eval:quality          # 3 journeys (EVAL_COUNT=5 to override)
```

Outputs HTML + JSON under `eval-reports/<timestamp>/`. Read the transcript and judge scores — no fixed expected strings.

## Tests

```bash
npm run typecheck
npm test              # unit tests only (personas, decide, grounding)
npm run script        # live NayaDesk smoke
```

## HTTP API

`POST /chat`

```json
{
  "builder_id": "lokations",
  "buyer_phone": "+919876543210",
  "text": "tell me about Ayana",
  "conversation_id": "optional-existing-conv-id"
}
```

Response: `{ "reply_text", "composer", "turn_index", "conversation_id" }`
