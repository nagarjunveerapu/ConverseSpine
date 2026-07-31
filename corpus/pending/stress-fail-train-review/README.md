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


## P2 promote (2026-07-30)

- Input: 15487 atomized multi-intent candidates
- **Applicable filter:** atom cue in phrasing; skip already-answered topic; **one vector per phrasing** (prefer rarer secondary atom over `get_price` when multi-miss)
- Promoted: **5351** → registry `promote_batch=P2`, `source=stress_fail_p2_2026_07_30`
- Vectorize: additive upsert **5351/5351** → space `p256-f6665e0b79`
- Dropped: no_cue 4008, already_answered 1929, visit_already 92, conflict_loser 4107
- Artifacts: `P2-promoted.jsonl`, `P2-upsert-items.jsonl`, `P2-upsert-result.json`, `P2-reprobe-corpus.jsonl`, `P2-reprobe-sample-600.jsonl`
- Sample re-probe (572 stratified): **527/572 (92.1%)** — weakest: `ask_investment_return`

## P2 residual topic triage (2026-07-30)

Branch `fix/p2-residual-topic-triage` — **extractors**, not another Vectorize dump.

- Input: `P2-residual-topic.jsonl` (~687 topic/focus fails after full P2 re-probe)
- Focus: `ask_investment_return` + `get_legal_info`
- Code: Hinglish/banks/approvals → `loan_eligibility` + FAQ `banks` + legal topic; `resale`/`एप्रिसिएशन` → `appreciation`; force overview alongside price; Devanagari `\b` fix
- Dig re-probe (`P2-residual-inv-legal-reprobe.jsonl`, 166):
  - Round 1: legal **75/106**; investment mostly honest-miss scorer-blind
  - Round 2 (banks/approvals/Devanagari + scorer cue): **139/166 (83.7%)** — legal **88/106 (83%)**, investment **51/60 (85%)**
  - Round 3–4 (bare `loan?`, `tell me about banks`, bare `returns?`): recovered **15/21** of remaining fails; smoke confirms extractors on dig
  - Targeted cues (loan mil / banks available / approvals): **73/74**
  - Hard leftover (~6): OC+price multi (no OC FactKey), `loan eligibility available`+BHK → shortlist focus, khata-primary swallowing returns atom in compose
- Artifacts: `P2-residual-topic.jsonl`, `P2-residual-inv-legal-reprobe.jsonl`, reports `…T13-56-28`, `…T14-04-19`, `…T14-10-31`, `…T14-13-39`

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
