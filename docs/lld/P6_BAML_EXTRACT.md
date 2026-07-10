# P6 — BAML ExtractTurnFacts (typed extract gap-fill)

**Status:** Implementing (P6a–P6c) · **Date:** 2026-07-10  
**Roadmap:** [`CONSOLIDATED_ROADMAP.md`](../CONSOLIDATED_ROADMAP.md) §P6  
**Depends on:** P1b funnel abstain gates · P2a provenance in ledger

## Why this layer

Ad-hoc `extractSignals` JSON prompts drift. After regex + INTENT/PROJECT embedder, some free-text turns still abstain on topics / location / transition. P6 adds a **typed** LLM contract for those gaps only.

## Layer ownership

| Own | Do not touch |
|-----|----------------|
| `baml/extract_turn_facts.baml` (contract) | Speech-act resolve / chip catalog |
| `src/engine/extract-baml.ts` (DeepSeek JSON impl) | RTI / turn-routing |
| `extract-authority.ts` — call **after** embedder merge | Compose / reply_quality |
| Provenance + ledger `resolved_intent.provenance` | New pipeline stage in `turn.ts` order |

**Workers note:** `@boundaryml/baml` NAPI is not the runtime path. Same pattern as `turn_intent.baml` + `llm-classifier.ts`: contract file + TS client.

## Modes (`BAML_EXTRACT_MODE`)

| Mode | Behavior |
|------|----------|
| `off` | Never call |
| `shadow` (default when API key present) | Call + log would_fill / disagree; **do not merge** |
| `promote` | Gap-fill empty fields only (never overwrite regex/embedder/chip) |

## Abstain gate (`needsBamlGapFill`)

Skip when chip primary resolved, or act ∈ {greet, stop, handoff}.  
Call when after embedder: missing topics + act=unknown, or missing location on search-like text, or missing transition on visit/details cues.

## Explicitly not P6

- BAML as speech-act authority  
- Replacing close-bound regex / chip path  
- `ClassifyTurnIntent` BAML wire (still P4 remaining)  
- P6d default-promote (only after Dev disagree rate + goldens green)

## Golden / quality

- Unit: parse, gate, shadow vs promote merge  
- No regression: ADV-H0*, SA-G0*, MEM-G01, RTI-G02 (BAML off or shadow must not change replies)
