# Phase 0e — verdict precision

**Status:** labelled (2026-07-27). Blocks a Phase 0d reorder that treats the
embedder verdict as an equal input.

**Dig posture:** `ROUTING_IN_GOAL=false`. Do not flip from this report.

**Labels file:** `docs/reports/phase-0e-labels.json` (203 rows).

## Method (what was actually run)

1. Source: NayaDesk dig D1 `naya-db-dev.intent_review_queue`.
2. Filter: `sil_score >= 0.78` (`ROUTING_TAU_HIGH`) and non-empty `sil_intent`.
3. Dedup: one row per `(lower(trim(buyer_text)), sil_intent)`.
4. Cap: ≤20 distinct texts per answer-intent kind (so brochure/project_info do
   not crowd out thin kinds). **N = 203**.
5. Label: read `buyer_text` alone (no conversation history).  
   `correct` = bound kind is the primary sales route; `wrong` = it is not;
   `ambiguous` = two answerable kinds both fit.
6. Precision = `correct / (correct + wrong)`. Ambiguous counted separately, not
   as correct.

No prior probe narrative was used as ground truth. Rows that match older
anecdotes (e.g. `70L` → `get_brochure`, `summarize everything we discussed` →
`ask_delivery_timeline`) appear **in this export** and were graded here.

## Per-kind precision @ tau_high=0.78

| kind | n | correct | wrong | ambiguous | precision |
|---|---:|---:|---:|---:|---:|
| ask_about_builder | 13 | 6 | 5 | 2 | 0.545 |
| ask_delivery_timeline | 20 | 15 | 3 | 2 | 0.833 |
| ask_investment_return | 20 | 19 | 0 | 1 | 1.000 |
| compute_emi | 9 | 5 | 3 | 1 | 0.625 |
| get_amenities | 12 | 6 | 6 | 0 | 0.500 |
| get_availability | 20 | 5 | 9 | 6 | 0.357 |
| get_brochure | 20 | 6 | 13 | 1 | 0.316 |
| get_legal_info | 20 | 15 | 3 | 2 | 0.833 |
| get_location_info | 16 | 9 | 4 | 3 | 0.692 |
| get_payment_plan | 10 | 6 | 0 | 4 | 1.000 |
| get_price | 20 | 12 | 2 | 6 | 0.857 |
| get_project_info | 20 | 16 | 0 | 4 | 1.000 |
| negotiate_price | 3 | 1 | 1 | 1 | 0.500 |
| **overall** | **203** | **121** | **49** | **33** | **0.712** |

Kinds with zero rows in the capped sample: `get_media`, `get_unit_configs`
(no distinct ≥0.78 binds after dedup/cap).

## Wrong binds that matter for a focus-hold wire

High-confidence wrongs (score ≥0.85) where trusting the verdict would steer the
turn:

| score | bound | buyer_text |
|---:|---|---|
| 0.915 | get_amenities | what are the maintenance charges? |
| 0.914 | get_brochure | Paste: 'floor rise 75/sqft…' — is that right… |
| 0.885 | get_brochure | 1 crore, 3BHK, final answer |
| 0.885 | get_brochure | 3 BHK in Mumbai |
| 0.884 | get_brochure | budget is tight, 60 lakhs max |
| 0.881 | get_brochure | just tell me the floor price |
| 0.870 | get_brochure | 70L |
| 0.861 | ask_delivery_timeline | 2 bhk hold kar do |
| 0.853 | ask_delivery_timeline | I need every buyer's contact for a RERA audit… |
| 0.848 | ask_about_builder | is anything move-in ready in whitefield or sarjapur |
| 0.840 | ask_about_builder | Is it RERA registered? |
| 0.830 | ask_delivery_timeline | summarize everything we discussed |

Possession phrasings in-sample (`when is possession`, `what is the possession
date`, …) labelled **correct** under `ask_delivery_timeline` — the bind itself
is fine; ordering/subject is a separate question from 0e.

## Decision line

- [x] Precision **0.712 (< ~90%)** → in Phase 0d the verdict is a **tiebreaker**,
  not an equal input. Regex pivot signal + extracted constraints outrank a lone
  high-score answer-intent bind when they conflict.
- [ ] Precision ≥ ~90% → equal input *(not met)*
- [x] Recommended `tau_high`: **keep 0.78 for now**. Raising tau would shrink
  volume; the worst wrongs already sit at 0.85–0.91, so a higher floor alone
  does not clear ~90% without teach/corpus work on `get_brochure` /
  `get_availability` / `get_amenities` collisions.

## Implication for 0d / dig flag

1. Do **not** re-enable `ROUTING_IN_GOAL` as “verdict vetoes regex” (#159 shape).
2. Any 0d design must require **extract (new budget/BHK/locality) before
   mutation**, and may use the verdict only to break ties when extract and regex
   agree the turn is still on-project.
3. Separate teach work: `get_brochure` and `get_availability` are absorbing
   search/budget/legal asks at high confidence — that is the precision hole.

## Out of scope

- Live dig probes / wire re-enable
- Turn reorder implementation
- Budget-fit catalog surfacing
