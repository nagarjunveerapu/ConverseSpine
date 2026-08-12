# Intent recovery + focus-unit memory + train eligibility

**Status:** implemented 2026-08-12  
**Why:** Regex→embed→BAML slot-fill is not enough for human language; clarify-spam is wrong architecture. Also the bot must remember the unit it already answered (Ivory) and mark LLM turns for teach.

## Layers

| Module | Role |
|--------|------|
| `intent-recovery.ts` | Closed-label LLM after BAML abstain (`INTENT_RECOVERY_MODE`) |
| `extract-authority.ts` | Calls recovery; stamps `train_eligible` + proposal |
| `focus-unit.ts` + `state.focusUnit` | Pin config the bot listed; price/landed uses it |
| `ledger-write.ts` | Persists `train_eligible` / `train_proposal` on resolved_intent |
| Visit soft latch in `turn.ts` | saturday + coming from → `want_visit` while focused |

## Ivory memory (how)

1. Buyer: “2 bhk ivory if you have” → `listUnits` evidence.
2. `pickFocusUnit` matches distinctive token **Ivory** → `state.focusUnit = { projectId, unitType: "2 BHK (Ivory)", … }`.
3. Also written as disclosed `availability` fact (“Selected unit: …”).
4. Next: “full price with all charges” → `wantsCostBreakdown` + `focusUnitTypeForProject` → Desk `landedCost`/`pricing` with **that** `unit_type`, not a bare 2 BHK band.

Clear `focusUnit` on commit to a different project.

## Train eligibility

Whenever BAML or intent-recovery is **called** (even abstain), provenance sets:

- `train_eligible: true`
- `train_sources: ['baml' | 'intent_recovery']`
- `train_proposal: { text, labels|baml, phase }`

Ledger `resolved_intent` carries the same for Desk/export queues. Review → promote into SIL corpus; do not auto-upsert.

## Modes

- `INTENT_RECOVERY_MODE=off|shadow|promote` (default follows BAML promote when key present).
- Shadow: call + train_eligible, do not merge labels.
- Promote: merge closed labels into extract.

## Quality check

- INT-DEEP-ORCHARDS: Ivory → all-in stays on Ivory.
- INT-AIRPORT: “thoda mehengaa” / “koi cheaper” → objection/cheaper, not clarify.
- saturday + Whitefield while focused → visit path.
