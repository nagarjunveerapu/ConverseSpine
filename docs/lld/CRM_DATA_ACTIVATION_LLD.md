# CRM Data Activation — API Upgrade & Search Extension (LLD · ACTIVE)

**Status:** Active · Phase 1–3 read path in flight · 2026-07-25  
**Companion:** `docs/designs/crm-data-coverage-map.html`  
**Scope:** Make the CRM's advisory/investment intelligence reachable and answerable **honestly**. Desk ships / joins data; ConverseSpine maps + speaks with provenance. Search filter/rank (Part C) is Phase 4.

> **Invariant:** activating data must never lower the honesty bar. Every market/investment answer carries **provenance** (source + `as_of`) and a **confidence/approval gate**; absence → failure-as-value decline, never fabrication. Retires C1 (fabricated yield).

---

## Improvisation vs original plan (2026-07-25)

Audit finding: much of the "dead" half is already on Desk's wire — `conversationContext` does `SELECT *` on `projects`, so investment + visit + `spec_json` already ship when focused. The bot adapter **drops** them. Market intel already has `GET /api/market-intel` (approved-only); it was never folded into `ProjectDetail`.

| Original A1 assumption | Reality / fix |
|---|---|
| Desk must newly ship investment fields | Already on `project` via `SELECT *` — **CS maps them** |
| Desk must invent micro_market FK | Reuse `matchIntelRow` (same as search re-rank) |
| Bot blocked until Desk nests intel | CS can hydrate via existing `marketIntel(microMarket)` even before Desk nests; Desk nest removes the extra RTT |

**τ (confidence floor):** `0.5` — serve approved intel only when `provenance.confidence ≥ 0.5`; below → treat as absent.

**Phasing kept:** Phase 1 market intel (yield/appreciation) → Phase 2 investment fields → Phase 3 amenities/visit → Phase 4 search. Phases 1–3 read-path ship together (no dependency on search).

---

## 1. Why

Coverage audit: bot reaches ~20 of ~45 dimensions. Dead half = advisor differentiator (`micro_market_intel`, investment fields, visit logistics, amenities/`spec_json`, upcoming infra). Buyers asking advisory questions get deflection or fabrication — not CRM truth.

## 2. Seams

| Seam | Today | Upgrade |
|---|---|---|
| **Read / detail** | Context ships full project row; adapter maps ~13 fields; market intel is a separate GET unused by engine detail | Nest `market_intel` on context + GET; map `detail.marketIntel` / `investment` / `visitLogistics` / `amenities` |
| **Search / rank** | Soft-rank may use intel internally; not a filter surface | Phase 4 — deferred |

**Contract:** additive + optional response keys only.

---

## 3. Part A — Data exposure

### A1. Desk
- `POST /api/conversation-context` → optional `market_intel` (approved + matched to `project.micro_market`, else `null`).
- `GET /api/projects/:id` → same sibling key (fallback path).
- Investment/visit/`spec_json` remain on `project` (no nested reshape required for Phase 1–2).

### A2. ConverseSpine
- `ProjectDetail`: `marketIntel?`, `investment?`, `visitLogistics?`, `amenities?`.
- Adapter: map from context/`getProject`; hydrate intel from nested key **or** `crm.marketIntel(microMarket)`.
- Format-once at adapter (W4): rent bands, %s, ROI + provenance string.

### A3. Honesty
- Provenance mandatory for market numbers.
- Gate: `review_status=approved` (Desk) ∧ `confidence ≥ 0.5` (CS).
- Decline-when-absent via answer-contract `no_data` (same speaker as C1).

---

## 4. Part B — Answer facets

- `rental_yield` FactKey: **deliver** when approved rent bands and/or project `expected_roi` present; else decline.
- New `appreciation` FactKey: deliver from 3yr/5yr pct; else decline.
- Compose speaks grounded lines; overview card must **not** swallow a required advisory atom.
- Compare "investment" line: grounded entry + available ROI/yield atoms, no "call me for yields" deflect when data exists.
- `policy_investment_metric` (CAGR/IRR promises) stays unsupported — separate from catalog ROI bands.

## 5. Part C — Search (Phase 4 · deferred)

New filter/soft-rank params + taught extraction — not in this change set.

## 6. Verification

- Decline when absent (C1 e2e still green).
- Deliver-when-present with provenance (unit + focused fake with intel).
- Never bare invented `%` without provenance when declining.
- Master quality: no regression on covered catalog facts.
