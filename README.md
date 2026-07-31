# ConverseSpine / ConverseEngine

**ConverseEngine** — clean-room turn kernel (see [docs/CONVERSE_ENGINE.md](docs/CONVERSE_ENGINE.md)).  
NayaDesk CRM, WhatsApp ingress, quality eval.

[![CI](https://github.com/nagarjunveerapu/ConverseSpine/actions/workflows/ci.yml/badge.svg)](https://github.com/nagarjunveerapu/ConverseSpine/actions/workflows/ci.yml)

**CI/CD:** PR → CI (typecheck + tests). Merge to `main` → auto-deploy **converse-spine-dev**. Prod is manual. See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

## Quick start

Setting up from nothing — including the database — is
[`NayaDesk/docs/SUITE_SETUP.md`](../NayaDesk/docs/SUITE_SETUP.md): every repo, the
ports, and the secrets matrix. The short version:

```bash
# NayaDesk (terminal 1) — owns the database, must be up first
cd ../NayaDesk && npm run dev:local          # :8787

# ConverseSpine (terminal 2)
npm ci
cp .dev.vars.example .dev.vars   # BOT_SHARED_SECRET must MATCH NayaDesk's
npm run dev:local                # Worker on :8789, against the LOCAL Desk
# or
npm run demo                     # CLI chat
```

**`dev:local`, not `dev`.** `npm run dev` uses `--env dev`, which binds
`NAYADESK` as a *service* — and a service binding can only reach a **deployed**
Worker, so your local turns go to the shared dev database no matter what
`NAYADESK_URL` says. `--env local` has no such binding and takes the HTTP path to
`localhost:8787`.

Check the two agree about each other before debugging anything else:

```bash
curl -s localhost:8787/api/health   # → "bot_url":"http://localhost:8789"
curl -s localhost:8789/health       # → "nayadesk":"http://localhost:8787"
```

If `BOT_SHARED_SECRET` differs between the two `.dev.vars` files, every call to
Desk returns 401 and the bot looks like it has no catalog.

If `/health` reports a `nayadesk` other than `http://localhost:8787`, it is
`NAYADESK_URL` in your **`.dev.vars`** — that file overrides `wrangler.toml`,
so a value left there beats `[env.local.vars]` silently and your "local" turns
land on the shared dev database.

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
