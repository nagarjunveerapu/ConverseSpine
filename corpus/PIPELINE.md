# The intent data pipeline — weekly rebuild

The flywheel foundation (SEMANTIC_INTENT_LAYER_LLD §4.4 + §10): a Cloudflare
**Cron Trigger** keeps the Vectorize intent index in sync with the git registry,
every week, so adding intents is a git PR — never a manual re-seed.

## Flow

```
corpus/intent-registry.jsonl   (git — source of truth, quarantine-tagged)
        │  fetched weekly (SIL_REGISTRY_URL)
        ▼
scheduled() cron  ── src/rebuild/intent-index.ts
        │  keep rows where audit_status=='clean' && !quarantine
        │  diff vs KV manifest (id → contentHash) → embed only NEW/CHANGED
        │  embed with SIL_EMBED_MODEL (Workers AI)
        │  upsert to INTENT_VECTORS · delete rows that fell out of the clean set
        ▼
naya-intent-phrasings(-dev)   Vectorize index the bot queries
```

- **Incremental.** The KV manifest records what the pipeline has pushed, so a
  weekly run only embeds the delta — "push the new intents," not a full re-seed.
- **Safe to ship dark.** It manages ONLY its own tracked ids. Until S1b marks
  rows `clean`, the eligible set is 0 → the cron is a no-op and never touches the
  legacy seeded vectors. No buyer impact from merging this.
- **Model is config, not code.** `SIL_EMBED_MODEL` selects the Workers AI
  embedding model. The default is the current `@cf/baai/bge-base-en-v1.5`, so
  nothing changes until the **model bake-off** picks a winner. Swapping models =
  change the env var + reset the manifest (forces a full re-embed) + rebuild.

## Config (env)

| Var | Default | Meaning |
|---|---|---|
| `SIL_EMBED_MODEL` | `@cf/baai/bge-base-en-v1.5` | Workers AI embedding model |
| `SIL_REGISTRY_URL` | raw GitHub JSONL | registry source (move to R2 for prod) |
| cron | `30 3 * * 1` (Mon 03:30 UTC) | weekly rebuild |

## Operate

- **Seed once (all rows):** call `rebuildIntentIndex(env, { pushUnaudited: true })`
  — bypasses the quarantine gate for the initial fill.
- **Dry run:** `rebuildIntentIndex(env, { dryRun: true })` reports the plan
  (eligible / pushed / removed) without embedding or writing.
- **Weekly steady state:** the cron runs `rebuildIntentIndex(env)` — clean rows only.

## Still to harden before high volume

- Registry source → **R2** (raw GitHub is fine for dev / low volume).
- Batch the initial 13.5k seed across cron runs or a **Queue** (Workers AI /
  subrequest limits per invocation); weekly deltas are small and fine inline.
- **CI count lint**: assert index vectorCount == manifest size after rebuild.
- The **model bake-off** (which model to set `SIL_EMBED_MODEL` to) is a separate,
  gate-bypassing measurement — see the LLD. This pipeline is model-agnostic on
  purpose; it does not decide the model, it embeds with whatever is chosen.
