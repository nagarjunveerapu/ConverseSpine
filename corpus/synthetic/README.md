# Synthetic intent stress corpus

Collate-only artifact for embedder enrichment + dig load testing.

| File | Role |
|---|---|
| `intent-stress-50k.jsonl` | ~50k labeled phrasings (EN / Hinglish / hi / ta / te / kn), single + multi-intent |
| `intent-stress-50k.meta.json` | Census (complexity / language / primary intent) |

## Generate

```bash
node scripts/generate-intent-stress-corpus.mjs --count 50000
```

## Parallel stress (dig)

```bash
node scripts/stress-intent-corpus-probe.mjs \
  --corpus corpus/synthetic/intent-stress-50k.jsonl \
  --concurrency 40 --limit 50000
```

Report lands in `docs/reports/intent-stress-<ts>/`:
- `report.md` — pass/fail + worst intents
- `fails-for-train.jsonl` — promote → registry after label review → rebuild vectors → re-probe fails

Rows are `audit_status: synthetic_pending_review` — **not** rebuild-eligible until human/SIL audit marks `clean`.
