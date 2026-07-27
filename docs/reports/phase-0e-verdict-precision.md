# Phase 0e — verdict precision (WIP)

**Status:** scaffold only — no labels yet. Blocks opening a Phase 0d code PR
(`DIALOGUE_STATE_ARCHITECTURE_LLD.md` §3c).

**Dig posture:** `ROUTING_IN_GOAL=false` until 0e outputs exist and 0d’s truth gate
passes. Do not flip the flag from this report.

## Method (locked)

1. Export ≥200 rows with `sil_score >= 0.78` (`ROUTING_TAU_HIGH`) via
   `scripts/phase-0e-sample.sql` against NayaDesk dig D1 (`intent_review_queue`).
2. Hand-label each bind: `correct` | `wrong` | `ambiguous` (§3c rule).
3. Fill the table below; write the decision line.

Hard negatives that must appear in the sample (or be appended):

| buyer_text | must not bind |
|---|---|
| `70L` (budget-only) | `get_brochure` |
| `summarize everything we discussed` | `ask_delivery_timeline` |

Grade the **bound intent kind**, not whether dig stayed focused.

## Per-kind precision (empty until labelled)

Answer-intent kinds (from `ANSWER_INTENTS` in `embedder-map.ts`):

| kind | n | correct | wrong | ambiguous | precision |
|---|---|---|---|---|---|
| get_price | — | — | — | — | — |
| get_legal_info | — | — | — | — | — |
| get_availability | — | — | — | — | — |
| get_unit_configs | — | — | — | — | — |
| get_brochure | — | — | — | — | — |
| get_media | — | — | — | — | — |
| get_amenities | — | — | — | — | — |
| get_location_info | — | — | — | — | — |
| ask_delivery_timeline | — | — | — | — | — |
| get_project_info | — | — | — | — | — |
| ask_about_builder | — | — | — | — | — |
| compute_emi | — | — | — | — | — |
| get_payment_plan | — | — | — | — | — |
| negotiate_price | — | — | — | — | — |
| ask_investment_return | — | — | — | — | — |

Overall answer-intent precision @ `tau_high=0.78`: **TBD**

## Decision line (required before 0d)

- [ ] Precision ≥ ~90% → verdict may be an equal input in 0d as designed
- [ ] Precision < ~90% → verdict is a **tiebreaker** only; amend §3b design before reorder
- [ ] Recommended `tau_high`: keep `0.78` / change to ____ (holdout numbers attached)

## Out of scope here

- Live dig probes / wire re-enable
- Turn reorder (0d)
- Budget-fit catalog surfacing (separate track)
