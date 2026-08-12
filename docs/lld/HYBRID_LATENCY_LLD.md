# Hybrid latency + quality (80/20)

**Target:** non-LLM turns p50–p95 ~0.5–1s; ≤20% of turns may use one sync DeepSeek call; conversational voice on templates.

## Generic rules (not example-tied)

1. **Intent-before-slots** — if extract has an evaluative *stance* (stance/intensifier × cost lexicon, or budget-boundary), that intent wins over slot/topic fills (`askTopics=price` from BAML/embed). Lexicons grow by *token class*; do not add one-off full utterances as architecture.
2. **Hybrid compose gate** — keyed off `goal.kind` + evidence presence + extract confidence floor + conversation `llmUsedCount` rate — never off a named buyer phrase.
3. **Paid budget** — at most one sync DeepSeek call; repair/vary second calls off when hybrid on.

## Flags

| Env | Default (dev) | Meaning |
|-----|----------------|---------|
| `HYBRID_COMPOSE` | `on` | Prefer voice templates; cap paid calls |
| `SYNC_BAML_MODE` | `shadow` | BAML does not promote slots on sync when hybrid |
| `PAID_LLM_TIMEOUT_MS` | `1200` | Abort compose → template |
| `LLM_RATE_TARGET` | `0.2` | Soft cap `llmUsedCount / turnCount` |
| `INTENT_RECOVERY_MODE` | `promote` | Closed-label recovery when floor needs it |

## Modules

- `src/engine/hybrid.ts` — goal/evidence/confidence gate
- `src/engine/price-objection.ts` — compositional cost-stance detector
- `extract-authority.ts` — apply authority before/after BAML
- `speech-act/resolve.ts` — `hasCostStanceAct` → `chip.object`
- `turn.ts` — hybrid compose, catalog memo, timings
- `compose.ts` — human WA voice banks
- `adapters/llm.ts` — timeout + smaller max_tokens

## API budget

- **0 DeepSeek** on template path; catalog memoized once per turn
- **≤1** `POST /v1/chat/completions` when floor fails and goal not template-locked
- Desk: unchanged paths; prefer `projectCache` / single catalog

## Debug

`TurnDebug.timings`, `llm_used`, `llm_shed`, `compose_template`.
