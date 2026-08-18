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

### `dev:local` and `dev:remote` are the same command

They are aliases, on purpose. **ConverseSpine has no database** — zero D1
bindings — so there is no local-vs-remote data choice to make here. Its facts
come from whichever NayaDesk it is pointed at, and both scripts point at
`localhost:8787`.

What decides your data is the **Desk** command:

| NayaDesk | ConverseSpine | Data the bot answers from |
|---|---|---|
| `npm run dev:local` | `dev:local` *or* `dev:remote` | local SQLite |
| `npm run dev:remote` | `dev:local` *or* `dev:remote` | `naya-db-dev` (shared) |

Both names exist so the pair reads the same across repos — run `dev:remote` in
NayaDesk and `dev:remote` here and you get exactly the stack you expect. The one
command that is **not** equivalent is `npm run dev`, which reaches the deployed
Desk.

Confirm it rather than assuming:

```bash
curl -s localhost:8789/health   # → "nayadesk":"http://localhost:8787"
curl -s localhost:8787/api/health   # → "mode":"localremote","data":"naya-db-dev"
```

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

## Deploying

`main` auto-deploys **converse-spine-dev** after CI. Prod is manual:

```bash
npm run deploy:prod          # converse-spine
```

**Deploy NayaDesk first.** `[env.prod]` binds `NAYADESK` as a *service*, and a
service binding can only resolve to a Worker that already exists — so a Spine
deploy ahead of `nayadesk-prod` fails. Suite order is Desk → Spine → Advisor.

## Configuration

Two kinds, and they fail differently. **Secrets** are set per environment with
`wrangler secret put` and never appear in the repo. **Vars** live in
`wrangler.toml` under `[env.<name>.vars]`, are visible in git, and are the
behaviour switches.

### Secrets

Three, and only two are values you invent:

```bash
npx wrangler secret put BOT_SHARED_SECRET --env prod   # MUST match NayaDesk's
npx wrangler secret put DEEPSEEK_API_KEY --env prod    # from platform.deepseek.com
npx wrangler secret put SIL_EVAL_SECRET --env prod     # openssl rand -hex 32
```

| Secret | What breaks without it | Notes |
|---|---|---|
| `BOT_SHARED_SECRET` | Every call to Desk 401s — presents as *a bot with an empty catalog*, not as an auth error | Must be **byte-identical** to NayaDesk's. Generate once (`openssl rand -hex 32`), paste in both repos. |
| `DEEPSEEK_API_KEY` | Nothing — the engine falls back to Workers AI | Do **not** set a placeholder: `/health` then reports `deepseek: true` and the fallback is suppressed. |
| `SIL_EVAL_SECRET` | The nightly embed-verify gate can't probe that env (404) | Optional. Least-privilege: opens `/api/sil/probe` + `/api/sil/embed` and nothing else. |

Optional, off when unset: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`,
`GOOGLE_PLACES_API_KEY`.

**Never rotate `BOT_SHARED_SECRET` casually.** On prod it also HMACs NayaDesk's
signed media URLs (24 h TTL), so a rotation kills every brochure link already
delivered to a buyer on WhatsApp, silently and unrecoverably — on top of the
Desk↔Spine outage between the two `secret put` calls. That is why the CI gate
has `SIL_EVAL_SECRET` instead of a copy of this one.

Confirm what is set without revealing it:

```bash
npx wrangler secret list --env prod
```

### Vars — dev has 35, prod has 14

That gap is the single most common source of "it works on dev". **An unset var
is not an inherited var**, and the default it falls back to is not always *off*:

| Shape | Unset means | Which ones |
|---|---|---|
| `=== 'true'` opt-in | **off**, always | `SIL_EMBED_FIRST`, `SIL_EVAL_ENABLED`, `TOPIC_UNION`, `UNDERSTANDING_BEFORE_MUTATION`, `UNDERSTANDING_CAPTURE`, `UNDERSTANDING_AUTO_TEACH`, `CHIP_RANK_LIVE`, `ROUTING_IN_GOAL`, `VISIT_EMBED_ACTS_ONLY`, `FAILURE_*`, `LOCAL_TURN_LOG` |
| mode resolver | **its own default** — read the resolver, don't assume | `HYBRID_COMPOSE` → **on**; `BAML_EXTRACT_MODE` → `shadow` if a DeepSeek key is set, else `off`; `INTENT_RECOVERY_MODE` → `off` with no key, else follows BAML; `SYNC_BAML_MODE` → `shadow` when hybrid is on |
| numeric | a documented default | `PAID_LLM_TIMEOUT_MS` → 1200 · `LLM_RATE_TARGET` → 0.2 |

**Set on dev, unset on prod (21):** `SIL_EMBED_FIRST`, `SIL_EVAL_ENABLED`,
`UNDERSTANDING_BEFORE_MUTATION`, `UNDERSTANDING_CAPTURE`,
`UNDERSTANDING_AUTO_TEACH`, `TOPIC_UNION`, `CHIP_RANK_LIVE`, `ROUTING_IN_GOAL`,
`VISIT_EMBED_ACTS_ONLY`, `HYBRID_COMPOSE`, `SYNC_BAML_MODE`,
`BAML_EXTRACT_MODE`, `INTENT_RECOVERY_MODE`, `PAID_LLM_TIMEOUT_MS`,
`LLM_RATE_TARGET`, `LOCAL_TURN_LOG`, `FAILURE_LOG`, `FAILURE_TOOLS`,
`FAILURE_ROUTING`, `FAILURE_SEARCH`, `FAILURE_ANSWER`.

Some of those are deliberately dev-only (`SIL_EVAL_ENABLED` must never be set on
prod; the `FAILURE_*` logs are noise there). The rest are features that are
simply **off in production** until someone sets them — `SIL_EMBED_FIRST` is the
live example.

**Same key, different value (3):** `NAYADESK_URL`, `SIL_INTENT_INDEX`
(`…-full-dev` vs `…-full`), `WA_PROJECT_FIRST` (`on` vs `off`).

### The understanding-layer vars

These four move together and must be consistent across both repos — changing
any of them changes the vector *space*, which is a new-index operation, not an
edit. See [`docs/lld/EMBED_PIPELINE_LLD.md`](docs/lld/EMBED_PIPELINE_LLD.md).

| Var | Today | Meaning |
|---|---|---|
| `SIL_EMBED_MODEL` | `@cf/baai/bge-m3` | 1024-dim. Desk must query with the same model the index was built with — a 1024-dim query against a 768-dim index is a hard error, which is why **Desk deploys before Spine**. |
| `SIL_INTENT_PROJECTION` | `p32-1c003deba7` | Hash of the learned 32-dim projection matrix. Changing it means a new index name. |
| `SIL_INTENT_INDEX` | `naya-intent-p32-1c003deba7-full[-dev]` | Carries the space id, so generations never overwrite each other. |
| `SIL_REGISTRY_URL` | raw GitHub JSONL | The corpus is a file in git, not a D1 table. |

Taus are **not** vars — they are compiled into
`src/nlu/intent-projection-matrix.ts`, and a tau is only valid against the index
it was measured on. `node scripts/embed-pipeline.mjs status --env prod` prints
the shipped taus next to live index state, which is how a config/deploy mismatch
gets caught in one command.

### Health

```bash
curl -s https://nayadesk-prod.nagarjun-arjun.workers.dev/api/health
curl -s https://converse-spine.nagarjun-arjun.workers.dev/health   # → "nayadesk":"binding"
```

`"nayadesk":"binding"` is the healthy answer in prod — the service binding
resolved, not a URL fallback. Full matrix and the per-Worker checklist:
[`NayaDesk/docs/SUITE_SETUP.md`](../NayaDesk/docs/SUITE_SETUP.md#secrets).

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
