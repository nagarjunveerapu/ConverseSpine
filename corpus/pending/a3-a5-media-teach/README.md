# A3–A5 + media/CRM teach batch

Append-only Vectorize upsert for dig after adversarial cracks + media/CRM asset work.

## What this teaches

| Lane | `intent_kind` | Why |
|------|---------------|-----|
| Prefs recall | `get_project_info` hard-negatives + note | Deterministic `recall_constraints` owns live path; rows below are hard-negatives vs price/location so embedder does not steal the turn |
| Board chrome | `ask_next_step` | "open the board" / shortlist — not locality |
| Media / CRM assets | `get_brochure` | site photos, price sheet, crop yield, ownership cert, location map |

## Upsert (dig)

```bash
CONVERSE_SPINE_URL=https://converse-spine-dev.nagarjun-arjun.workers.dev \
  npx tsx scripts/upsert-intent-vectors.ts corpus/pending/a3-a5-media-teach/upsert-items.jsonl
```

Rebuild (full index from registry) only when registry itself changed:

```bash
curl -X POST "$CONVERSE_SPINE_URL/internal/intent-rebuild" \
  -H "x-bot-secret: $BOT_SHARED_SECRET" -H "content-type: application/json" -d '{}'
```


## Promoted to dig gate (registry)

- Batch: `A3A5_MEDIA`
- Rows: `promoted.jsonl` appended to `corpus/intent-registry.jsonl` with `audit_status=clean`
- Live Vectorize: already upserted via `upsert-intent-vectors.ts` (23/23) → space `p256-f6665e0b79`
- Weekly cron + `SIL_REGISTRY_URL` will keep these after merge to main
