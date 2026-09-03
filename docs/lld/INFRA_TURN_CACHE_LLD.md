# Infra TURN_CACHE (L0–L4) — dig latency

**Status:** shipped on dig (`converse-spine-dev`). Measure only dig — not local wrangler.

## Layers

| Layer | Key | Owner |
|-------|-----|--------|
| L0 | Thread DO (`TurnDebouncer` `/state`, name `state:{threadId}`) + `ce:state:` KV | `store-kv.ts` |
| L1 | `seg:{builder}:{area}:{type}` | `nayadeskData.search` |
| L2 | Cache API + `proj:{projectId}` KV | `hydrateProjectDetail` + turn-local `projectCardMemo` |
| L3 | `emb:{projection}:{hash(text)}` | `cache/embed.ts` (routing + enrich) |
| L3q | `ivq:{projection}:{hash(query)}:{builder}` | Vectorize top-K for routing query — skip AI+Vectorize on hit |
| L4 | `search:{builder}:{hash(constraints)}` | `nayadeskData.search` / catalog |

**Quality rule:** L3q only reuses **identical** `buildRoutingQuery` text (incl. state tokens). Never skip free-text embed-first on novel utterances. Shadow BAML stays off the sync path when `waitUntil` is present (no slot promote).

## Flags (dev)

`HYBRID_COMPOSE=on`, `SYNC_BAML_MODE=shadow`, `LLM_RATE_TARGET=0.2`, `TOPIC_UNION=true`, `SIL_EMBED_FIRST=true`.

Chip taps still skip embed; free-text stays embed-first with L3 reuse.

## Invalidate

Desk PUT/PATCH project → `POST /internal/cache-invalidate` (`spine_cache_invalidate.ts`).

## Harness

```bash
npm run board:latency   # dig board + packed multi-intent
npm run soak:dig        # SOAK_CHATS=100 SOAK_CONCURRENCY=20
```

SLO target: warm p50 ≤500ms / p95 ≤1s. Interim soak gate: warm p95 ≤1.5s.

## Dig measurement (2026-08-12)

After L0–L4 + hybrid deploy + shadow-BAML async + bootstrap-once:

| Run | chats | warm p50 | warm p95 | cache hit | notes |
|-----|-------|----------|----------|-----------|-------|
| 100 @25c | 100 | ~4.7–6.6s | ~7–10s | ~76% | AI/Vectorize contention under concurrency |
| **1000 @10c** | **1000** | **2.5s** | **3.9s** | **73%** | pass_rate 1.0; interim gate 1.5s not yet met |
| Smoke (serial) | — | eng total ~2.7–4.6s | — | emb hits | extract ~0.4–0.9s on emb hit |

Dominant remaining cost: Workers AI + Vectorize on unique free-text (SIL_EMBED_FIRST), plus Desk evidence when L2 misses. Compose templates ≈0ms; LLM rate ≈0% under hybrid.

## Evidence parallel (2026-08-12)

`fetchAnswer` runs independent Desk topic tools in `Promise.all` (pricing / EMI / mediaShare / availability / FAQ keys), then merges patches in **fixed order** so settlement order cannot change EvidenceSet winners. Ordered deps stay serial: FAQ results → `needsDetail` / location intel / legal enrich.

`debug.timings.evidence_ms` measures the evidence stage (hold/answer/recommend/objection/…). Packed multi-intent wall should drop when several topic tools were previously serial; free-text embed-first is unchanged.

Packed probe after parallel (warm `proj:hit`): brochure+RERA `evidence_ms≈150` / `total_ms≈2.2s`; schools+price `evidence_ms≈0.5s` / `total_ms≈2.8s` (detail+LI still post-merge). Soak 40@5: warm_p95 **3700** vs prior **3100** — no clear soak win (soak mix is mostly single-topic; concurrency noise dominates). Residual wall: extract/SIL embed + post-evidence store/CRM, not serial topic tools on L2-warm packed turns.
