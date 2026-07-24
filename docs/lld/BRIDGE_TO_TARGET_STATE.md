# Bridge to Target State — Stages & Strict Quality Gates

**Status:** Active execution plan · v1 · 2026-07-24
**Scope:** The eight near-term latency / scalability / infra items that precede the target-state migration (`SYSTEM_DESIGN_LLD.md`, `Naya/docs/TARGET_STATE_ARCHITECTURE.md`). Each item is the **cheap Phase-1 of a target-state component**, built so the later phase is a swap, not a rewrite.

**The rule:** *no stage merges unless every one of its gates is green AND the master quality gate holds.* Gates are binary and measured — never "looks fine." Ship behind a flag in shadow, measure against the gate, flip only on green (ADR 005).

---

## Master quality gate (applies to EVERY stage)

The founder's non-negotiable: latency/scale work must not drop bot quality. So every stage, before flip, must clear:

| # | Gate | Threshold | How |
|---|------|-----------|-----|
| M1 | **Grounding-pass-rate** | ≥ baseline (zero regressions) | Persona families A–F replay + HTML report with the conversation |
| M2 | **Answer-contains-asked-fact** | ≥ baseline | Envelope anchor checks (ADR 015) across the persona set |
| M3 | **Over-answer rate** | ≤ baseline | Persona set; no new dumps |
| M4 | **Failure-speaker correctness** | 100% — every declined fact spoken by the one speaker, never invented | Failure-as-value assertions |
| M5 | **Reply-text parity** *(for stages that must not touch content — #2, #6, #7, #8)* | **byte-identical** replies pre/post | Shadow-compare on persona set; ANY diff = fail |
| M6 | **CI** | `tsc --noEmit` + `vitest run` green; `intent-projection-space` holds | CI |
| M7 | **HTML report published** | required artifact | The report contains the actual conversation, per standing rule |

**Rollback:** every stage ships behind a flag; a red gate flips the flag off, not a revert.

---

## Latency

### Stage 1 — Measure the per-stage split *(gate for everything else)*
**Change:** instrument `runEngineTurn` sub-stages (load / extract / route / fetch / compose / ground / tail) via the existing debug channel; report ms per stage. Dev-only, reverted after.
**Strict gates:**
- G1.1 **Zero reply-path impact** — instrumentation adds no blocking call; p50 total within ±5% of pre-instrument baseline.
- G1.2 **Full attribution** — Σ(stage ms) within ±10% of measured total (no unaccounted time), across ≥20 real turns spanning greet / discovery / focused-answer / no-match.
- G1.3 **Recorded decision** — a written verdict: "compose = X% of buyer-work → latency-play / quality-play," which sets the sequencing of #4 and the compose rewrite.
- G1.4 HTML report with the per-turn, per-stage breakdown.

### Stage 2 — Async tail → `ctx.waitUntil`
**Change:** thread `ctx` into `handleAdvisorTurn`; move `syncFacts`/`syncTelemetry`/`logTurn`/`appendMessage` into `ctx.waitUntil`. `store.save` (KV) stays awaited.
**Strict gates:**
- G2.1 **State parity** — turn N+1 reads identical state whether the tail ran sync or async (a two-turn test asserts byte-identical loaded state).
- G2.2 **No-loss** — invocation counts of every tail write equal pre/post (spy in test + dev soak comparing Desk row deltas per N turns).
- G2.3 **Latency win** — p50 drops by the measured tail cost (~0.7–1.4s) ±20%; error-rate unchanged.
- G2.4 **M5 reply parity = byte-identical** (the tail is post-reply; any reply change is a bug).

### Stage 3 — Parallelize understand (embed-route ∥ LLM-extract)
**Change:** run the embedding route concurrently with the LLM extract; merge before routing. (First verify the routing→extract data dependency; parallelize only what's independent.)
**Strict gates:**
- G3.1 **Semantic identity** — extracted constraints + routing verdict byte-identical to the sequential path on the frozen 192-Q + persona set. ANY diff = fail (unless a documented dependency forces order, then that path stays sequential).
- G3.2 **Intent accuracy** — holdout ≥ baseline (the 192-Q gate; ≥ current confident-accuracy). No regression.
- G3.3 **Latency win** — understand-stage p50 trends to max(extract, route), net ~1–2s measured.

---

## Scalability

### Stage 4 — Materialize the `project_doc` / segment card
**Change:** materialize the denormalized `{project, units, faqs, holdable}` that `conversation_context.ts` assembles today — as a KV segment card (and/or a D1 `json_set` column) — with **event-driven invalidation on catalog publish**.
**Strict gates:**
- G4.1 **Freshness = grounding (the strict one)** — on publish, the card refreshes/invalidates within a bounded window (assert publish→card-updated in a test). A **staleness canary** compares card vs live Desk truth for a sample; ANY mismatch on a **stable** field (name/builder/area/type) = fail. **Price/inventory fields carry a freshness stamp and fall back to live when older than TTL** — never served stale.
- G4.2 **Projection faithfulness** — reply built from the card is byte-identical to the reply from live `conversation_context` on the same state (shadow-compare 100% on persona set).
- G4.3 **Grounding** — M1 holds; zero cases of a card serving a value that differs from current Desk truth.
- G4.4 **Perf** — focused-answer fetch has no live Desk round trip on cache hit; hit-rate ≥ target on a soak.

### Stage 5 — Widen catalog scope → `(builder, area, property_type)`
**Change:** extend the scope param already threaded through `catalog/search/projectDetail` from `builderId` to the segment tuple.
**Strict gates:**
- G5.1 **Backward-compat** — with only `builderId` set, behavior is byte-identical to today (new params default to no-op). Full regression identical.
- G5.2 **Zero leakage** — when area/type are set, the candidate set ⊆ the segment; no project outside `(builder, area, property_type)` ever appears (multi-area/multi-type fixture test).
- G5.3 **Serviceability honesty** — an unserved area yields the honest "not served yet" outcome, never a cross-area result (the Devanahalli-to-a-Mumbai-buyer failure must be impossible; locality-contract test).

### Stage 6 — Log the choice-set *(irreversible — do not skip)*
**Change:** every recommendation turn emits `{offered[], responded, rejected[]}` as a first-class, schema-versioned event on the async plane (the moat's RUM training data).
**Strict gates:**
- G6.1 **100% coverage** — every recommend/shortlist goal emits exactly one choice-set event; dev soak shows event-count == recommend-turn-count. No silent gaps.
- G6.2 **Schema validity** — every event validates against the frozen schema (offered ids + scores, response, rejections); producer rejects malformed.
- G6.3 **Loss visibility** — written on `waitUntil` (never blocks the reply), but a write failure emits a metric — we must *know* if we're losing moat data, never swallow it.
- G6.4 **M5 reply parity = byte-identical** (post-reply event).

---

## Infra / seams

### Stage 7 — Unify the LLM adapter
**Change:** route both DeepSeek callers (`llm/composer.ts`, `nlu/classifier.ts`) through the single `llm` adapter.
**Strict gates:**
- G7.1 **Request identity** — same endpoint/model/params/outputs vs pre-refactor (replay identical).
- G7.2 **Seam closed** — a lint/test fails the build if any raw `fetch(...deepseek...)` exists outside the one adapter; grep = zero.
- G7.3 **Swap-proof** — a stub provider injected once makes both compose *and* classify use it (test proves the seam).

### Stage 8 — Keep state behind `store` (+ move CRM ctx-cache)
**Change:** move the CRM `ctx:*` read-cache out of raw `TURN_CACHE` into the adapter; assert conversation-state keys are touched only via `store-kv.ts`.
**Strict gates:**
- G8.1 **Seam closed** — a test/lint asserts no conversation-state-key access outside `store-kv.ts`.
- G8.2 **Swap-proof** — the full suite passes against an in-memory `store` implementation (proves KV→DO is a swap, not a rewrite).
- G8.3 **Correctness** — full regression identical after the ctx-cache move; invalidation still fires on takeover/egress.

---

## Sequence & discipline
1 (measure) → 2, 3 (safe latency wins) → 4 (read-projection, the big scale foundation) → 5, 6 (scope + choice-set) → 7, 8 (seam hygiene).
Each: **flag → shadow → measure against gates → flip on green.** No stage flips on a red master gate. Every test publishes the HTML report with the conversation.

**Not built here (over-engineering guard):** DO state layer, Queues/Kafka, Analytics Engine, Postgres, OpenSearch, speculative prefetch — all deferred behind their triggers (CP-RLS → Postgres; city-scale faceted search → OpenSearch; concurrent-conversation volume → DO; >100k turns/day → event plane).
