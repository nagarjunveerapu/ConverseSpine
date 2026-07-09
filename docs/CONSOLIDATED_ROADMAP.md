# ConverseSpine — consolidated implementation phases

Single sequencing doc merging: **Phase 0 fixes**, **Advisor Phase 1 (focused depth)**, **extract funnel / chip vs free-text**, **turn ledger memory**, **RTI**, and **BAML** — into one ordered plan.

**Rule:** Design review + explicit **go implement** per phase ([`discuss-before-implement`](../../Naya/.cursor/rules/discuss-before-implement.mdc)).  
**Quality:** Turn-by-turn golden threads; pass count alone is insufficient ([`no-quality-regression`](../../Naya/.cursor/rules/no-quality-regression.mdc)).

**Related docs:** [`CONVERSESPINE_LAYER_GUIDE.md`](./CONVERSESPINE_LAYER_GUIDE.md) · [`CONVERSESPINE_ARCHITECTURE.md`](./CONVERSESPINE_ARCHITECTURE.md) · Naya [`docs/lld/README.md`](../../Naya/docs/lld/README.md)

**Last updated:** 2026-07-09 (P4-CTA + Desk cutover track added)

**Rule for live failures:** Classify against this doc + [`CONVERSESPINE_LAYER_GUIDE.md`](./CONVERSESPINE_LAYER_GUIDE.md) **before** coding. Prefer the next open phase slice over a one-off patch that drifts the plan.

---

## Where we are (ops snapshot — 2026-07-09)

| Track | Status | Notes |
|-------|--------|-------|
| Desk tooling → Spine (Playground / agent-send) | ✅ Phase 1 | NayaDesk PRs #183–#184; WhatsApp buyers still on Naya |
| Desk location expand (North Bangalore graph) | ✅ | NayaDesk [#185](https://github.com/nagarjunveerapu/NayaDesk/pull/185) |
| Units enrichment / BHK-scoped list | ✅ | Spine #23; Desk #182 |
| **Focused CTA → bare `yes`** | ✅ **P4-CTA** | Merged [#24](https://github.com/nagarjunveerapu/ConverseSpine/pull/24); RTI-G02 green |
| **SA-2 visit book ≠ recall** | ✅ | Merged [#25](https://github.com/nagarjunveerapu/ConverseSpine/pull/25) |
| **SA-3 availability → units** | 🟡 | offer_pricing must not swallow size asks; deterministic units compose |
| Empty Neo pricing copy | ⏸️ DATA | `price_min_paise=0` — honest “not published” later; not a routing bug |

**Do not** keep stacking playground patches outside the phase table. File the symptom under the owning phase, then implement that slice.

---

## North-star pipeline (target)

```text
Turn start:
  load KV + read turn_ledger.prior (structured memory)
  bootstrap NayaDesk (CRM, returning buyer)

Ingress:
  input_source = chip | free_text
  merge UI struct (preferences, project_id, action_id)

RTI hook (when pending_prompt / recovery / chip):
  contextual yes/no, recovery patches — NOT slot extraction

Speech act (free-text; see docs/lld/SPEECH_ACT_CONTRACT_LLD.md):
  classify move (search|answer|switch|compare|visit_book|visit_recall|…)
  → permissions gate slots (answer must not overwrite propertyType)

Extract funnel (same for all channels):
  chip → deterministic action_id only
  free_text → topics (scoped by act) → close-bound deterministic (gap slots only)
            → embedder gap-fill (INTENT topic / PROJECT identity; abstain gates)
            → BAML ExtractTurnFacts (abstain only, P6)

Kernel (always code):
  phase guards → decide goal (≡ speech act) → fetch evidence → compose (+ prior context from DB)
  → verify → append turn_ledger (incl. speech_act) → KV save
```

---

## Status at a glance

| Phase | Name | Status |
|-------|------|--------|
| **P0** | Focus stability & depth gates | ✅ Shipped (PR [#19](https://github.com/nagarjunveerapu/ConverseSpine/pull/19)) |
| **P1** | Extract authority & ingress flags | 🟡 P1a + P1b implemented locally; PR TBD |
| **P1c** | PROJECT_VECTORS + discussedProjects | 🟡 Local (switch/compare); deploy TBD |
| **SA** | Speech-act contract (slim) | 🟡 SA-0/1/2 ✅ · **SA-3 PR** · SA-4=P5 next |
| **P2** | Turn ledger memory loop | 🔴 Designed (D1 table exists); not wired in loop |
| **P3** | Focused facet depth | ⏸️ Paused — **after SA** (act=answer stable first) |
| **P4** | Contextual dialogue (RTI) | 🟡 Partial — **P4-CTA ✅** ([#24](https://github.com/nagarjunveerapu/ConverseSpine/pull/24)); BAML RTI not wired |
| **P5** | Routing → goal enforcement | 🔴 **= SA-4** (routing ≡ speech act; not a second classifier) |
| **P6** | BAML extract production | 🔴 Contract only; abstain-only — never act authority |
| **P7** | Advisor UX parity | 🟡 API adapter exists; NBA / checklist_snapshot thin |
| **P8** | Platform scale | ⏸️ Deferred (Redis, OpenSearch, Kafka, Postgres) |
| **Desk** | Catalog search / cutover | 🟡 Location expand PR #185; WA cutover = later phase |

---

## P0 — Focus stability & depth gates ✅

**Problem:** Focused turns poisoned location, released focus on price/detail asks, weak implicit project pick.

**Delivered:**

- `isDetailAskTurn`, gated `extractLocation`, tightened `isFocusedSearchPivot`
- Landed-cost path (`wantsCostBreakdown` → `landedCost` → compose)
- `tests/phase0-focused-depth.test.ts`
- Dev: `npm run chat`, wrangler dev `remote = true`
- Docs: architecture + layer guide

**Exit criteria:** ✅ Golden thread Coorg → Ayana → breakdown → details-of-project stays focused.

**Do not reopen** unless regression fails — extend in P1/P2 instead.

---

## P1 — Extract authority & ingress flags

**Problem:** Three extractors (regex, embedder, LLM) with implicit precedence; no chip vs free-text provenance; regex runs on already-filled UI slots.

### P1a — Slice 1: merge precedence ✅ (local / PR TBD)

| Touch | Why |
|-------|-----|
| `extract-authority.ts` | Single `extractTurnAuthority` entry |
| `facts.ts` | LLM transition signals wired |
| `semantic-nlu.ts` | Location embed gated on detail ask |
| `turn.ts` | One extract call |

**Not:** RTI, compose, turn-routing goal wiring.

### P1b — Slice 2: unified funnel + `input_source` ✅ (local)

| Deliverable | Detail |
|-------------|--------|
| `input_source: 'chip' \| 'free_text'` | Set at ingress only (UI button / advisor `action_id`) |
| Chip path | `action_id` authority; skip extract ladder |
| Free-text path | Intent/topic pass **first** → scoped deterministic on **gap slots** |
| UI pre-fill | Skip extract for slots already in `preferences` / `project_id` |
| Text override | `"actually"`, `"instead"`, `"change"` re-opens slot |
| `mergeExtractedAuthority` | Per-field provenance in `debug` |

**LLD:** [`docs/lld/SLICE-2_UNIFIED_EXTRACT_FUNNEL.md`](./lld/SLICE-2_UNIFIED_EXTRACT_FUNNEL.md)

---

## P2 — Turn ledger memory loop 🔴 CRITICAL

**Problem:** Bot does not read structured per-turn context from DB; compose/extract use this message only. Raw `messages` ≠ machine memory.

**Infrastructure:** NayaDesk `turn_ledger` (0092) + GET/append API — **exists**. ConverseSpine writes **stub rows**, reads **rejected ids only**.

### P2a — Write full ledger row (every turn)

| Column | Persist |
|--------|---------|
| `snapshot_in_json` | phase, focus, constraints, shortlist, `pending_prompt`, `input_source` |
| `resolved_intent_json` | `ask_topics`, transition, slots + **provenance** |
| `action_plan_json` | goal kind, topic(s) |
| `tool_runs_json` | pricing, landedCost, compare, … |
| `disclosed_facts_json` | RERA, price lines, legal facets stated in reply |
| `offered_project_ids_json` | shortlist shown |
| `reply_text` | bot reply (for “what did we ask?”) |

**Touch:** `turn.ts` `syncTelemetry`, `adapters/nayadesk.ts`  
**Why not compose-first:** Must record before we can read.

### P2b — Read `prior` at turn start

| Load into | Use |
|-----------|-----|
| `TurnFeedForward` on state or turn input | `priorGoal`, `priorTopics`, `awaitingResponse`, `disclosedFacts`, `priorReplyExcerpt` |
| RTI | `"yes"` / `"no"` with `awaiting_response` |
| Free-text intent pass | `"tell me more"` → continue `priorTopics` |
| Extract | Don't re-derive focus from text if ledger says focused |

**Touch:** `bootstrapContext`, `turn.ts` top, `buildTurnIntentInput`, P1b extract

### P2c — Compose consumes TurnContext

| Pack block | Source |
|------------|--------|
| `PRIOR CONTEXT` | ledger `prior` + disclosed_facts |
| `THIS TURN` | current text + goal + evidence |
| Templates | Skip repeat RERA if in `disclosed_facts` |

**Touch:** `compose.ts` `renderComposePrompt`, `fallbackReply`

**Exit criteria:**

- Golden: legal turn → `"what banks approved?"` uses prior + facet — **not** generic snapshot (ADV-F01 banks line)
- `"yes"` after offer_project uses `prior.awaiting_response` without RTI guess
- Ledger row inspectable in NayaDesk for any turn

**LLD to write:** `docs/lld/P2_TURN_LEDGER_MEMORY.md`

**Blocks:** P3 facet compose (needs “already disclosed”), P4 contextual RTI quality.

---

## P3 — Focused facet depth ⏸️ (original “Phase 1”)

**Problem:** Narrow follow-ups (`EC clear?`, `what banks?`, `price break-up`) get generic project snapshot despite bundle having data.

**Source LLD:** [`ADVISOR_FOCUSED_DEPTH_LLD.md`](../../Naya/docs/lld/ADVISOR_FOCUSED_DEPTH_LLD.md) slices A–F.

| Slice | Deliverable | Depends on |
|-------|-------------|------------|
| **A — Extract** | Facet extractors (`ec`, `banks`, `price`, `location`, …) | P1b intent-first (scope regex) |
| **B — Decide** | Forbid generic snapshot when facet topic set | A |
| **C — Evidence** | Bundle slice by facet; KV hydrate on focus | B |
| **D — Compose + verify** | Facet templates + `verify` mentions facet | C, **P2c** (disclosed_facts) |
| **E — Ingress** | `board_tab`, focus in advisor envelope | D |
| **F — Golden** | `ADV-F01` Orchards 7-question thread | E |

**Why after P2:** Facet follow-ups need prior topic + disclosed facts, not just regex on one line.

**Exit criteria:** §1 trace in ADVISOR_FOCUSED_DEPTH — all 7 lines address the facet.

**Explicitly defer:** BAML shadow (→ P6), OpenSearch, Redis.

---

## P4 — Contextual dialogue (RTI) 🟡

**Problem:** Recovery yes/no, chip equivalence, free-text recovery patches, and **focused follow-up CTAs** need **dialogue** memory — not extract funnel / PROJECT_VECTORS.

**Source LLD:** [`ADVISOR_CONTEXTUAL_TURN_INTENT_LLD.md`](../../Naya/docs/lld/ADVISOR_CONTEXTUAL_TURN_INTENT_LLD.md) · layer guide §2 + §13

| Item | Status |
|------|--------|
| RTI-2 recovery patches | ✅ |
| RTI-B focused pivot | ✅ |
| RTI-D…G visit/compare/shortlist | ✅ |
| RTI rules + `llm-classifier.ts` | ✅ hand-rolled JSON |
| **P4-CTA — focused CTA → bare affirm** | 🟡 PR pending — unit + RTI-G02 live green (2026-07-09) |
| BAML `ClassifyTurnIntent` wired | 🔴 |
| RTI reads ledger `prior` | 🔴 (P2b — strengthens P4-CTA; not a hard gate for KV `pendingPrompt`) |

### P4-CTA — Focused availability CTA → `yes` (added 2026-07-09)

**Symptom (playground):** North Bangalore → focus Eldorado → “details on 2BHK” → *Want pricing on a specific size?* → **`yes`** → reply about **Brigade Buena Vista** (wrong project).

**Root cause (compound):**

1. `buildPendingPrompt` only covers recovery / `offer_project` / chip menus — **not** focused `answer`+`availability` CTAs → `rti.pendingPrompt` unset → RTI skipped on bare `yes`.
2. `shouldQueryProjectVectors` returns true for any focused text ≥3 chars → `"yes"` hits full-catalog PROJECT_VECTORS → hallucinated `namedProjects` (e.g. Buena Vista).
3. `detectFocusedSwitchIntent` commits on that name before `focused.decide` can answer price on Eldorado.

**Why this phase (not compose / not SA):** Layer guide — *“What does yes mean?”* → **RTI (2)**. CTA wording in compose is fine; binding the next affirm is RTI + persist.

**Why not wait for full P2:** KV `rti.pendingPrompt` is enough for this CTA shape. P2b (`awaiting_response` from ledger) is the durable upgrade later — do not block P4-CTA on ledger read.

| Touch | Role |
|-------|------|
| `turn-intent/types.ts` | New `PendingPromptKind` e.g. `offer_pricing` (topic + focus project) |
| `turn-intent/pending-prompt.ts` | Persist when `answer` + `availability` + units (and clear on success turns carefully) |
| `turn-intent/classify.ts` | Bare affirm + `offer_pricing` → stay focused, seed `askTopic: 'price'` |
| `adapters/semantic-nlu.ts` | Gate: bare affirm must **not** query PROJECT_VECTORS |
| `project_switch.ts` | Belt: affirm without pick/named project must not switch |
| Tests | Golden **RTI-G02** — Eldorado 2BHK list → `yes` → `answer`/`price` on Eldorado; no Buena Vista |

**Explicitly reject:** compose CTA regex; `reply_quality` strips; LLM prompt tweaks; discover re-search.

**Exit criteria:** RTI-G02 green on local + playground smoke; existing RTI-G01 (`offer_project` → yes) still green.

**Remaining (after P4-CTA):**

- Wire BAML for `ClassifyTurnIntent` (replaces `llm-classifier.ts`)
- RTI consumes `TurnFeedForward` not only KV `recentMessages[-4]` (P2b)
- Chip label ↔ `action_id` parity table (same patch)
- Generalize pending kinds for other focused CTAs (“Want pricing, legal, or a visit?”) without unbounded regex

**Exit criteria (full P4):** Scenarios S15, S17, ADV-R02 + **RTI-G01/G02**.

**Runs parallel to P1b** only for chip fast-path — RTI hook stays **before** extract funnel.

---

## P5 — Routing → goal enforcement 🔴

**Problem:** `turn-routing` (RTI-3A/3B) stored in `rti.lastRouting` but barely drives `decideGoal`; visit vs explore still wrong on edge cases (V02).

**Source LLD:** [`RTI_3_VISIT_EXPLORE_INTENT_LLD.md`](../../Naya/docs/lld/RTI_3_VISIT_EXPLORE_INTENT_LLD.md)

| Slice | Deliverable |
|-------|-------------|
| RTI-3C | LLM band τ_low–τ_high; visit-phase RTI gate cleanup |
| P5-core | `classifyTurnRouting` result → `visit.decide` / `discover.decide` inputs |
| | `project_references` for picks beyond compare |

**Depends on:** P1b (topic authority), P2b (booked stops context in routing query)

**Exit criteria:** V01–V08 visit vs explore scenarios; no visit hijack on configuration asks.

---

## P6 — BAML extract production 🔴

**Problem:** Ad-hoc JSON prompts drift; no typed `ExtractTurnFacts`.

| Step | Deliverable |
|------|-------------|
| P6a | `baml/extract_turn_facts.baml` → `Extracted` schema |
| P6b | Wire after embedder abstain in `extract-authority.ts` |
| P6c | Shadow mode: log BAML vs deterministic disagree rate |
| P6d | Promote when regression green |

**Depends on:** P1b funnel (clear abstain gates), P2a (persist BAML provenance in ledger)

**Not:** Replace chip path or close-bound regex.

---

## P7 — Advisor UX parity 🟡

**Source:** [`ARCHITECTURE_VISION.md`](../../NayaAdvisor/docs/ARCHITECTURE_VISION.md) P0–P2

| Item | Status |
|------|--------|
| `advisor/handle-turn` + map-response | ✅ |
| `visit_queue` / `visit_itinerary` | ✅ |
| `search_recovery` chips | ✅ |
| `checklist_snapshot` authoritative in response | 🔴 |
| Server-driven `nba[]` after facet answers | 🔴 (P3 + P2) |
| Board tab sync (`board_tab` ingress) | 🔴 (P3-E) |

**Exit criteria:** Chat and board never diverge on focus/phase; chips from server not client guess.

---

## P8 — Platform scale ⏸️ DEFERRED

| Item | When |
|------|------|
| Redis session checklist | MAU / checklist scale |
| OpenSearch brochure RAG | Brochure-heavy asks fail in UAT |
| Kafka turn.completed | Analytics flywheel |
| Postgres NayaDesk | D1 limits hit |

**Do not** invert P0–P3 for infra experiments.

---

## Recommended execution order

```text
P0 ✅
  ↓
P1a/b (extract authority + funnel) ✅ local
  ↓
P1c (PROJECT_VECTORS / discussed) 🟡 local
  ↓
SA-0 ✅ (chip catalog + free-text→chip resolve)
  ↓
┌─────────────────────────────────────────────────────────────┐
│  NEXT (parallel OK — different layers):                     │
│  • P4-CTA  — focused CTA → yes (RTI pendingPrompt)  ← LIVE  │
│  • Desk #185 merge + migrate — North Bangalore expand       │
│  • SA-1..3 — permissions / visit_book≠recall / availability │
└─────────────────────────────────────────────────────────────┘
  ↓
SA-5 + P2a (ledger write incl. speech_act) → P2b/c
  ↓
SA-4 = P5 (routing ≡ speech act)
  ↓
P3 A→F (facet depth copy/evidence — on stable act=answer)
  ↓
P4 remainder (BAML ClassifyTurnIntent) + P6 (BAML extract abstain)
  ↓
P7 (NBA, checklist_snapshot, board_tab)
  ↓
Desk Phase 2 — WhatsApp buyer cutover to Spine (after SA + P2a + P4-CTA green)
```

**Parallel allowed:**

- **P4-CTA** with SA-1..3 (RTI vs speech-act — different layers; do not conflate)
- Desk #185 merge/migrate while Spine P4-CTA lands
- P1 PR ship while SA tests land
- NayaAdvisor UI (P7) after P3-E contract frozen

**Serial gates (do not skip):**

1. **SA-1 before P3** — answer vs search must be stable before deep facet templates  
2. **P1b before P6** — abstain gates must exist; BAML never owns speech act  
3. **P2a (with `speech_act`) before relying on Dev debug** — ledger must record the stamp  
4. **Do not invent payment_plan/ROI topics before EngineData tools**  
5. **P2c before P3-D polish** — disclosed_facts still needed for “don’t repeat RERA”  
6. **P4-CTA before WhatsApp cutover** — bare `yes` after focused CTAs must not invent projects  
7. **Do not “fix playground” outside this table** — add a row / golden ID first  

---

## Golden threads (regression ownership)

| ID | Phase | Scenario |
|----|-------|----------|
| **P0-G01** | P0 | Coorg brief → Ayana → breakdown → details-of-project |
| **SA-G01** | SA | Focused → plot/unit sizes → availability answer (not no_fit / tap button) |
| **SA-G02** | SA | “lets do a site visit” vs “my visits” — book ≠ recall |
| **SA-G03** | SA | After discuss A+B → “compare both” uses discussed pair |
| **ADV-F01** | P3 | Orchards 7 facet questions (banks, EC, price, …) |
| **MEM-G01** | P2 | legal → `"what banks?"` — uses ledger prior, not generic snapshot |
| **RTI-G01** | P4 | offer_project → `yes` commits; offer_widen → `yes` probes |
| **RTI-G02** | P4-CTA | Focus Eldorado → 2BHK listUnits CTA → `yes` → `answer`/`price` on Eldorado (not Buena Vista / vector noise) |
| **V01–V08** | P5/SA-4 | Visit vs explore routing |
| **CHIP-G01** | P1b | `action_id` vs typed chip label same patch |
| **LOC-G01** | Desk | “North Bangalore” search → Eldorado/Orchards/Neo identity ahead of geo-only (after #185) |

---

## Per-phase design review template

Before each phase implementation, post:

1. **Why** — symptom + root layer (from layer guide)  
2. **Files touched** — and **why not** other layers  
3. **Consumers traced**  
4. **Depends on** — prior phase exit criteria  
5. **Golden thread** — which ID  
6. **Open questions** — founder only  

---

## Deferred backlog (explicitly not in P0–P7)

| Item | Notes |
|------|-------|
| Project switch mid-focused ("what about Cornerstone?") | P1c vectors + SA `switch` — partially local |
| V02 visit follow-up after single stop booked | Visit LLD §11 — partial; SA-2 seeds discussed |
| payment_plan / investment / builder topics | DEFER until EngineData tools (speech-act LLD) |
| Prod soak / deploy ConverseSpine prod | After SA + P2a + **P4-CTA** on Dev golden |
| Wire Slice 1 / P1c to main if not merged | PR follow-up |
| Empty / zero-price unit UX (“not published” vs “on file”) | DATA + compose honesty — not RTI |
| Soft-match WA recovery | After P4-CTA |
| WhatsApp full cutover (Desk Phase 2) | After P4-CTA + SA + P2a green |

---

## Doc index to create (as phases start)

| Phase | LLD path |
|-------|----------|
| **SA** | [`lld/SPEECH_ACT_CONTRACT_LLD.md`](./lld/SPEECH_ACT_CONTRACT_LLD.md) ✅ |
| P1b | `ConverseSpine/docs/lld/SLICE-2_UNIFIED_EXTRACT_FUNNEL.md` |
| P2 | `ConverseSpine/docs/lld/P2_TURN_LEDGER_MEMORY.md` |
| P3 | exists: `Naya/docs/lld/ADVISOR_FOCUSED_DEPTH_LLD.md` |
| P4 | exists: `Naya/docs/lld/ADVISOR_CONTEXTUAL_TURN_INTENT_LLD.md` |
| P5 | exists: `Naya/docs/lld/RTI_3_VISIT_EXPLORE_INTENT_LLD.md` |
| P6 | TBD: `ConverseSpine/docs/lld/P6_BAML_EXTRACT.md` |

---

*This doc supersedes ad-hoc “Phase 1 stopped / Slice 1 only” discussions — use it as the single sequencing reference.*
