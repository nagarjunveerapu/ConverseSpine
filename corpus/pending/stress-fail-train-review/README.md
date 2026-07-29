# Stress-fail training candidates (for your review)

Generated from `docs/reports/intent-stress-2026-07-29T12-12-10/fails-for-train.jsonl` (10416 raw fails → **18918** candidate rows).

## How to review

1. Start with **`P0-P1-review.tsv`** (spreadsheet) — highest signal singles.
2. Or skim **`P0.jsonl`** then **`P1.jsonl`**.
3. For each row decide: **promote** / **edit label** / **drop**.
4. **`P2.jsonl`** = multi-intent atomized (same text, one row per expected atom) — keep only atoms clearly present in the phrasing.
5. Tell me which file/IDs to promote; I will push to registry + INTENT_VECTORS.


## P1 promote (2026-07-30)

- Input: 362 non-EN singles (hi/ta/te/kn)
- Promoted: **361** (skipped 1 duplicate `ROI?`)
- Registry: `promote_batch=P1`, `source=stress_fail_p1_2026_07_30`
- Vectorize: additive upsert **361/361** → space `p256-f6665e0b79`
- Artifacts: `P1-promoted.jsonl`, `P1-upsert-items.jsonl`, `P1-upsert-result.json`, `P1-reprobe-corpus.jsonl`

## Priority

| Pri | Meaning | Count |
|---|---|---:|
| **P0** | Single-intent EN/Hinglish, sole topic/unknown miss | 2493 |
| **P1** | Single-intent other langs (hi/ta/te/kn), sole miss | 362 |
| **P2** | Atomized multi-intent | 15487 |
| **P3** | Stacked / noisier singles | 576 |

## Filters applied

- Dropped: HTTP infra, focus-only, small_talk, non-routable kinds, exact `intent|canonical` dupes.
- **Not** blindly promoting all 10k fails.
- `promote_recommended=true` only on P0/P1.

## Census

```json
{
  "dropped": {
    "focus_only": 95,
    "http_infra": 87
  },
  "by_priority": {
    "P2": 15487,
    "P0": 2493,
    "P1": 362,
    "P3": 576
  },
  "by_language": {
    "hi-en": 6731,
    "en": 8680,
    "te": 59,
    "hi": 3319,
    "kn": 67,
    "ta": 62
  },
  "top_intents": [
    [
      "get_price",
      4028
    ],
    [
      "get_legal_info",
      2918
    ],
    [
      "get_amenities",
      2030
    ],
    [
      "get_brochure",
      1607
    ],
    [
      "ask_delivery_timeline",
      1311
    ],
    [
      "get_location_info",
      1278
    ],
    [
      "ask_investment_return",
      1196
    ],
    [
      "get_payment_plan",
      891
    ],
    [
      "compare_projects",
      781
    ],
    [
      "get_availability",
      755
    ],
    [
      "compute_emi",
      738
    ],
    [
      "book_visit",
      471
    ],
    [
      "get_project_info",
      274
    ],
    [
      "ask_about_builder",
      233
    ],
    [
      "negotiate_price",
      179
    ]
  ]
}
```

## Do not promote without review

- Multi rows (P2) where an atom is **not** in the text.
- Honest ROI/appreciation refusals graded as topic fail (label may be fine; reply policy is separate).
- Pure typos that become unreadable after soften.

When ready: reply with "promote P0", "promote P0+P1", or a list of `id`s / edited JSONL.
