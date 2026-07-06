# ConverseSpine — CI/CD

Same pattern as [NayaDesk](https://github.com/nagarjunveerapu/NayaDesk): **CI on every PR**, **deploy dev on merge to `main`**, **prod manual only**.

## Workflows

| Workflow | Trigger | Result |
|----------|---------|--------|
| **CI** | PR + push to `main` | `npm run typecheck` + `npm test` |
| **Deploy dev** | CI success on `main`, or manual | `wrangler deploy --env dev` → `converse-spine-dev` |
| **Deploy prod** | Manual only | `wrangler deploy --env prod` → `converse-spine` |

## One-time GitHub setup

1. **Repository secrets** (Settings → Secrets and variables → Actions):

   | Secret | Value |
   |--------|--------|
   | `CLOUDFLARE_API_TOKEN` | API token with **Workers Scripts Edit** (+ KV if rotating namespaces) |
   | `CLOUDFLARE_ACCOUNT_ID` | `a24378cdba77c1d03c3115651bb9cd11` (or `wrangler whoami`) |

2. **Environments** (optional but recommended):

   - `dev` — no approval required
   - `production` — require manual approval before prod deploy

   Reuse the same token/account as Naya / NayaDesk if this account deploys all Workers.

## One-time Cloudflare Worker secrets

CI deploys code only; runtime secrets stay on the Worker:

```bash
# After first deploy to dev
npx wrangler secret put DEEPSEEK_API_KEY --env dev
npx wrangler secret put BOT_SHARED_SECRET --env dev
# WhatsApp (when live)
npx wrangler secret put META_APP_SECRET --env dev
npx wrangler secret put META_ACCESS_TOKEN --env dev
```

Copy values from NayaDesk `.dev.vars` / Cloudflare dashboard. `BOT_SHARED_SECRET` must match NayaDesk.

## KV namespaces

Turn state cache (`TURN_CACHE`) IDs are in `wrangler.toml`:

- **dev:** `66ef723ea8614317b80aac74b77f03d1`
- **prod:** `53df7275a01b4527a3421e36d7586864`

To recreate: `npx wrangler kv namespace create CONVERSE_SPINE_TURN_CACHE_DEV`

## Local dev

```bash
cp .dev.vars.example .dev.vars
npm run dev   # :8789, converse-spine-dev config
```

Optional Ollama for RTI local classification:

```bash
ollama pull llama3.1:8b-instruct
# .dev.vars
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1:8b-instruct
```

## Verify deploy

```bash
curl -s https://converse-spine-dev.<your-subdomain>.workers.dev/health | jq
```
