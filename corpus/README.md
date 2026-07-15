# corpus/ — the semantic intent registry

`intent-registry.jsonl` is the git source of truth for the `naya-intent-phrasings-*`
Vectorize indexes (SEMANTIC_INTENT_LAYER_LLD §4.1). **The registry is the source;
the index is a build artifact.** Never hand-edit the index — edit this file in a
reviewed PR and rebuild.

## Provenance

Recovered 2026-07-15 by dumping all 13,555 vectors of `naya-intent-phrasings-dev`
(`scripts/vectorize-dump-registry.py`). The corpus had been seeded out-of-band
(~2026-06-08→20, no seeder ever in git) and served zero queries until SIL Phase 0.

## Row shape

```json
{"id": "ph_…", "phrasing": "namaste, koi legal issue toh nahi",
 "intent_kind": "get_legal_info", "language": "hi-en",
 "is_negative": false, "hard_negative_for": "", "source": "corpus_v2"}
```

## Census at recovery (audit 2026-07-15)

| Measure | Value |
|---|---|
| Rows | 13,555 (en 9,436 · hi-en 4,119 — 30.4% Hinglish) |
| Distinct `intent_kind` | 30 (Naya's legacy 30-intent taxonomy) |
| Kinds mapped by the runtime (`embedder-map.ts`) | 19 → 10,774 rows (79.5%) |
| Kinds INVISIBLE to routing | 11 → 2,781 rows (20.5%) — e.g. `confirm_action` 354, `request_callback` 334, `provide_qualification` 317, `express_objection` 315, `opt_out` 210 |
| P5 contamination (other-builder or locality tokens in phrasing) | 4,764 rows (35.1%) — builders 15.0%, localities 24.3% |
| `builder_scope` set | **0 rows** — the runtime's builder-scoped query always returns empty |
| Negative rows (`is_negative`) | 94 (with `hard_negative_for`) — the runtime does not read this field |
| Sources | corpus_v2 13,123 · retroactive_mined 244 · embedding_gap_batch_1 188 |

Known label defects (per-kind stratified audit pending, LLD §4.2): invisible kinds
win nearest-neighbor and mask mapped kinds (measured: "what return can I expect?"
→ `provide_qualification` by a 0.00008 margin over #2); `ask_about_builder` rows
name competitor builders.

## Rules

- Every change lands via PR — labels are buyer-routing decisions, they get eyes.
- Dedupe at cosine ≥ 0.95 against existing rows before appending.
- No place/project facts in phrasings (P5) — new rows must be generic.
- Fixes for misunderstood phrasings go HERE, never into understanding regexes (P7).
