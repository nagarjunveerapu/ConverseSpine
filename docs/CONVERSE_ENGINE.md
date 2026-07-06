# ConverseEngine

**The bot kernel** — built in this repo. Not a patch on legacy Naya.

## Design

One control loop per turn:

```text
extract facts (deterministic + LLM signals) → merge state → decide GOAL
  → fetch EVIDENCE (NayaDesk) → compose → verify → repair fallback → persist
```

| Layer | Owns |
|-------|------|
| **Goals** | `recommend`, `answer`, `compare`, `objection`, `visit_*`, … |
| **Extract** | Closed-set parsers (budget, BHK, compare topic) + bounded LLM signals (location, property type) |
| **References** | `project_references.ts` — names, anaphora ("both", "these"), shortlist binding |
| **Evidence** | Search, pricing, compare table, playbooks — **state-first** (compare uses shortlist IDs, never re-search) |
| **Compose** | One LLM path + deterministic `fallbackReply(goal, evidence)` |
| **Verify** | Every ₹ in reply must trace to evidence; structured repair for legal/compare |

Legacy `src/turn/decide.ts` (intent → template router) is **retired** — do not extend it.

## Layout

```text
src/engine/
  turn.ts                 Main loop
  facts.ts                Deterministic + LLM signal extraction
  project_references.ts   Anaphora + name resolution (ported from Naya)
  compare_resolve.ts      Compare ID resolution from shortlist + text
  compose.ts              Prompt + grounded fallback
  grounding.ts            Verifier + banned phrase strip
  phases/                 discover, focused, visit, handoff goal tables
  adapters/               NayaDesk data + DeepSeek LLM
  store-kv.ts             Conversation state in TURN_CACHE KV
```

## Invariants

1. **Compare beats recommend** when ≥2 project IDs are resolved.
2. **Never wipe `lastOffered`** on empty search — `recordOffered` only when matches exist.
3. **Empty search → `no_fit`**, not "tell me more" with a dead shortlist.
4. **Property type** maps to NayaDesk `project_type`; soft-fallback if label mismatch.

## Run

```bash
npm run demo          # CLI chat (ConverseEngine)
npm run eval:scenarios
npm test              # includes Coorg compare funnel in tests/engine.test.ts
```
