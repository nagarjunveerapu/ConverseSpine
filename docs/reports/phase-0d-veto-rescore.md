# Phase 0d-3 — veto-class truth re-score (dig)

**Generated:** 2026-07-31T04:58:40Z  
**Build:** dig (`converse-spine-dev`) with `UNDERSTANDING_BEFORE_MUTATION=true`, post PR #172 (Wave 3 / focus-hold).  
**Source:** `docs/reports/phase-0d-veto-class.jsonl` (80 texts)  
**Raw JSON:** `docs/reports/phase-0d-veto-rescore.json`  
**Runner:** `node --import tsx scripts/probe-0d-veto-rescore.mjs`

## Result

| Class | Pass | Total |
|-------|------|-------|
| pivot (new budget / locality / explore / named switch) | **53** | 53 |
| answer (facet / FactKey / short chip on focused project) | **27** | 27 |
| **TOTAL** | **80** | **80** |

Prior baseline (2026-07-29, pre Wave 3): **67/80** (answer 20/33). Delta: **+13**, answer-class cliff closed.

## Grader (truth, not focus-stay alone)

- **Answer class:** must not dump shortlist / unknown-clarify; must stay on focused answer path (catalog fact or honest miss).
- **Pivot class:** must not ignore new budget/locality by pinning Eldorado-only pricing; must reflect constraint or search/no_fit/recommend.

Pinned setup: brief → `Tell me about Brigade Eldorado` → veto text.

## Founder decision (gate)

| Item | Recommendation |
|------|----------------|
| Keep `UNDERSTANDING_BEFORE_MUTATION=true` on dig | **Yes** — 80/80 on veto class |
| Revive `ROUTING_IN_GOAL` as equal veto | **No** — stay tiebreaker-only per 0e |
| Dig default remains on | **Yes** (already true in `wrangler.toml` `[env.dev]`) |
| Prod flag | Separate soak; not part of this gate |

## Known residual quality (not 0d-3 blockers)

- Bare `when` / `loan` / `discount` chips now hold and answer (possession / banks / pricing).
- Comparative “which project has the best rental yield?” offline-labels as answer → honest miss on focused project (acceptable; not shortlist cliff).
- Some pivot replies still use junk location captures (`ready in whitefield or sarjapur`) — extract hygiene, not 0d ordering.

## Next

- Phase **0a** ledger truth (tool_runs observed success, `engine_status`, promote snapshot fields) — same PR train.
- Phase **0b** port result wrappers for real absence vs transport + `latency_ms`.
