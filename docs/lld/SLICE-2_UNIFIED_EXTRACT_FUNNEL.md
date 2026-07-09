# Slice 2 (P1b) — Unified extract funnel + ingress provenance

**Status:** Design approved → implementing  
**Depends on:** [SLICE-1_EXTRACT_AUTHORITY.md](./SLICE-1_EXTRACT_AUTHORITY.md) (P1a merge precedence)  
**Blocks:** P2 turn ledger rows (needs `input_source` + field provenance in `snapshot_in`)

## Problem

Extraction still runs the full regex → LLM → embedder ladder even when:

1. The buyer tapped a **chip** (`action_id`) — RTI already owns the turn patch.
2. Advisor **preferences** already filled slots — regex re-parses chip labels or stale UI copy into `constraints`.
3. Free-text **detail asks** (`breakdown of costs`) — location parsers can still fire before intent is authoritative.

There is no **`input_source`** provenance at ingress, so ledger/debug cannot distinguish chip vs typed input.

## Root cause layer

**Ingress + extract funnel** — provenance is not set at channel entry; extract does not know which slots are UI-closed.

## Options

| Option | Pros | Cons |
|--------|------|------|
| **A — Funnel flags in `extractTurnAuthority`** (recommended) | Single entry; Slice 1 merge preserved; testable | Touches `facts.ts` options |
| B — Skip extract entirely on chip in `turn.ts` | Minimal extract CPU | Duplicated chip dialogue signals if RTI misses |
| C — Post-hoc strip in `applyExtracted` | Small diff | Regex/LLM/embed still run; wastes KV-quality signals |

**Recommendation:** **A** — chip path returns minimal dialogue-only `Extracted` and skips enrich/LLM; free-text runs intent-first then gap-only deterministic with ingress slot masks.

## Target funnel

```text
Ingress (advisor / whatsapp / chat):
  input_source = action_id ? 'chip' : 'free_text'
  ingressFilledSlots = keys from preferences + project_id this turn

RTI (unchanged — runs before extract when gated)

extractTurnAuthority:
  chip → extractFactsChip (affirm/decline/stop/recall/visit only); skip enrich
  free_text:
    detectTopics FIRST (already in extractFacts)
    regex/LLM on GAP slots only (skip ingress-filled unless text override)
    mergeExtractedAuthority (Slice 1 rules)
    provenance per field → debug
```

### Text override

`\b(actually|instead|rather|change|switch|update|not X but)\b` re-opens all ingress-filled slots for this turn so typed corrections win.

### Ingress-filled slots

| Advisor key | Slot key |
|-------------|----------|
| `location` | `location` |
| `budget` | `budget` |
| `bhk` | `bhk` |
| `property_type` | `propertyType` |
| `purpose` | `purpose` |
| `project_id` (no pivot) | tracked at ingress; focus commit happens pre-engine |

## What we touch

| File | Why |
|------|-----|
| `engine/ingress.ts` | **New** — `resolveInputSource`, `ingressFilledSlotsFromPreferences`, override + slot writability |
| `engine/extract-authority.ts` | Funnel branches, provenance, return `{ extracted, provenance }` |
| `engine/facts.ts` | `ExtractFactsOptions`; chip minimal; gap-slot gating in async + sync paths |
| `engine/types.ts` | `TurnInputSource`, `ExtractProvenance`, extend `TurnDebug` |
| `engine/turn.ts` | `EngineTurnInput.ingressFilledSlots`; wire funnel; debug fields |
| `advisor/apply-preferences.ts` | `ingressFilledSlotsFromPreferences` |
| `advisor/handle-turn.ts` | Pass `ingressFilledSlots`, implicit `input_source` via `action_id` |
| `turn/run-turn.ts` | WhatsApp ingress passes through `action_id` (already) |
| `tests/extract-funnel.test.ts` | **New** — chip skip, ingress block, override, intent-first |

## What we do NOT touch

| Layer | Why not |
|-------|---------|
| `turn-intent/` | RTI owns chip patches — extract must not compete |
| `compose.ts` / `grounding.ts` | Symptom layer |
| Turn ledger read/write | **P2** — consumes provenance we add here |
| BAML runtime | **P6** |
| Facet templates | **P3** |

## Consumers traced

| Value | Consumer |
|-------|----------|
| `input_source` | `TurnDebug` → advisor client, future `turn_ledger.snapshot_in` (P2) |
| `extract_provenance` | `TurnDebug`, regression asserts |
| Stripped `constraints` | `applyExtracted`, `discover.searchFilters`, phase `decide` |
| Chip-minimal `Extracted` | `decideGoal`, visit slot handling — affirm/decline only |

## Quality check

| Thread | Assert |
|--------|--------|
| **P0-G01** | Coorg → Ayana → `breakdown of costs` — no `constraints.location`, `askTopics` has `price` |
| **CHIP-G01** | Chip `clear_bhk` + prefs bhk set — extract path `chip_skip`, no embedder location |
| **ING-G01** | Advisor prefs location=Whitefield + text "show me options" — no regex location |
| **OVR-G01** | Prefs location + "actually near Coorg" — location writable, regex may set Coorg |

Run: `npm test` (unit) + `tests/phase0-focused-depth.test.ts` unchanged green.

## Open questions (founder)

1. Persist `input_source` in KV state vs per-turn `debug` only? **This slice: debug only** (P2 ledger carries it).
2. Intent pass: regex `detectTopics` first vs embedder when empty? **Unchanged — regex topics first (Slice 1).**

## Exit criteria

- [ ] `input_source` on every `TurnDebug`
- [ ] Chip path skips enrich + open-set LLM
- [ ] Ingress-filled slots blocked unless text override
- [ ] `extract_provenance` on free-text turns
- [ ] Unit tests + phase0 suite green
