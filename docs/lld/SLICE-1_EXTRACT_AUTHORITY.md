# Slice 1 — Single extraction authority

**Status:** Implemented  
**Scope:** ConverseSpine `src/engine/` only — not RTI, not compose, not turn-routing goal wiring.

## Problem

Extraction is split across three callers with implicit precedence:

1. `extractFacts` — regex + inline LLM signals
2. `semantic.enrich` — embeddings backfill
3. Ad-hoc patches in `turn.ts` (compare, recovery)

When layers disagree or run without shared gates (e.g. location embed on a price ask), focus release and wrong goals follow.

## Root cause layer

**Extraction merge** — no single function owns final `Extracted` or documents precedence.

## What we touch

| File | Why |
|------|-----|
| `engine/extract-authority.ts` | **New** — orchestrates extract + enrich + merge; documents precedence |
| `engine/facts.ts` | Fix LLM `transition` signals never applied (`asTransitionFromSignals(undefined)`) |
| `engine/adapters/semantic-nlu.ts` | Gate location embed when detail ask / topics present |
| `engine/turn.ts` | Replace inline `extractFacts` + `enrich` with `extractTurnAuthority` |
| `tests/extract-authority.test.ts` | Unit tests for merge rules |

## What we do NOT touch

| Layer | Why not |
|-------|---------|
| `turn-intent/` | Dialogue recovery (yes/no, chips) — not slot/topic extraction |
| `turn-routing/` | Visit vs answer telemetry — separate from `Extracted` |
| `compose.ts` / `grounding.ts` | Symptom layer — fixing upstream extraction |
| `phases/*.decide` | Consumes `Extracted`; unchanged contract |
| `advisor/` | Ingress prefs already merged before engine |

## Precedence rules

```text
Per field:
  askTopics / askTopic     → regex (extractFacts) wins; embedder fills only when empty
  constraints.location     → regex wins; LLM signal fills gap; embedder fills only when
                               still empty AND NOT isDetailAskTurn AND no askTopics
  constraints.bhk/budget/… → regex + LLM inside extractFacts only
  transition               → regex wins; LLM signal fills gap
```

## Consumers traced

| Field | Downstream |
|-------|------------|
| `askTopics` | `isDetailAskTurn`, `focused.decide`, `fetchAnswer`, `classifyTurnRouting` |
| `constraints.location` | `applyExtracted`, `locationBroaden`, `discover.searchFilters` |
| `transition` | phase transitions in `turn.ts`, `discover.decide` / `focused.decide` |

## Quality check

- Existing `tests/phase0-focused-depth.test.ts` must stay green
- New `tests/extract-authority.test.ts` for merge + enrich gate
- Manual: focused `"breakdown of costs"` — no `constraints.location` from embedder
