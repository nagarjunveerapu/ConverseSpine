# ConverseSpine layer guide

Per-layer reference: **what each layer does**, **when it runs**, **when it skips**, and **concrete examples**.

Companion to [`CONVERSESPINE_ARCHITECTURE.md`](./CONVERSESPINE_ARCHITECTURE.md) (diagrams) and [`CONVERSE_ENGINE.md`](./CONVERSE_ENGINE.md) (invariants).

**Last updated:** 2026-07-08

---

## How to read this doc

Layers run in roughly this order inside `runEngineTurn` (`src/engine/turn.ts`). Not every layer runs every turn — each section lists its **gate**.

```text
Ingress → Load state → Bootstrap → [RTI] → extractFacts → [LLM signals] → [Embeddings]
  → apply state → [Phase guards] → [Turn routing] → decide goal → fetch evidence → compose → verify → persist
```

---

## Layer 0 — Channel ingress

### What it does

Routes HTTP/webhook traffic into the same kernel with channel-specific **pre-state** setup.

| Entry | File | Extra before engine |
|-------|------|---------------------|
| `POST /chat` | `worker/routes.ts` → `turn/run-turn.ts` | Upsert lead if no `conversation_id` |
| `POST /api/advisor/turn` | `advisor/handle-turn.ts` | Merge `preferences`, sticky `project_id`, `action_id` |
| `POST /webhook` | `webhook/whatsapp.ts` → `runTurn` | Debounce, phone resolve |
| `npm run chat` | `chat-repl.ts` | Same as `/chat` |

### When it runs

Every request. Always first.

### Examples

| Client | Request | Effect |
|--------|---------|--------|
| Terminal | `POST /chat { text: "Hi", buyer_phone: "+91999…" }` | `channel: 'whatsapp'` in engine |
| NayaAdvisor | `POST /api/advisor/turn { session_id, preferences: { location: "Coorg" }, text: "show options" }` | Constraints merged **before** turn; `channel: 'advisor_web'` |
| Advisor chip | Same + `action_id: "clear_bhk"` | RTI always runs (chip tap) |

### Why it exists

Advisor UI sends structured state the engine cannot infer from text alone. Ingress normalizes both paths to `runEngineTurn`.

**Files:** `src/index.ts`, `advisor/handle-turn.ts`, `worker/routes.ts`, `advisor/apply-preferences.ts`, `advisor/session.ts`

---

## Layer 1 — State load & bootstrap

### What it does

- **`store.load(convId)`** — read `ConversationState` from KV (`TURN_CACHE`).
- **`bootstrapContext(nd)`** — merge NayaDesk context: returning buyer, recent messages, rejected projects, builder persona.

### When it runs

Every turn with a valid NayaDesk conversation id.

### When it skips

- Fresh session with no ND lead yet (bootstrap runs next turn after `ensureLead`).
- ND unreachable → bootstrap silently no-ops.

### Examples

| Situation | Bootstrap adds |
|-----------|----------------|
| Buyer returns after 2 days | `returningBuyer: { daysSinceLastSeen: 2, buyerName: "Arjun" }` → greet uses "Welcome back" |
| Buyer rejected Ayana in prior session | `rejectedProjectIds` merged into `state.discover` |
| Prior WhatsApp thread exists | `recentMessages` appended for RTI LLM context |

### Why it exists

KV holds engine state; NayaDesk holds CRM truth. Bootstrap prevents amnesia on returning buyers and cross-channel continuity.

**Files:** `engine/store-kv.ts`, `engine/turn.ts` (~110), `adapters/nayadesk.ts` (`bootstrapContext`)

**Breakpoint:** `turn.ts:111`

---

## Layer 2 — Turn-intent (RTI) — recovery & disambiguation

### What it does

Classifies **conversational actions** before fact extraction:

- Chip taps (`action_id`)
- Contextual **yes/no** after bot offered a project or chips
- **Recovery patches** during `no_fit` / `search_recovery` ("2 Cr any apartment")
- **Focused search pivots** ("show me other projects") → release focus

**Does not** pick price/legal topics for normal project Q&A.

### When it runs (`shouldRunTurnIntent`)

| Condition | RTI runs? |
|-----------|-----------|
| `action_id` present (chip tap) | **Yes** |
| `lastGoalKind === 'no_fit'` or `ui_mode === 'search_recovery'` | **Yes** |
| `rti.pendingPrompt` set (bot asked a question) | **Yes** |
| Focused + search pivot text (`isFocusedSearchPivot`) | **Yes** |
| Focused + `"breakdown of costs"` | **No** — project Q&A |
| `phase === 'visit'` | **No** (visit owns scheduling) |
| `isCompareAmongOfferedTurn` | **No** |

### Authority

**Rules first** (`ruleClassify`) → **LLM** (`llm-classifier.ts`) if rules abstain → **probe** fallback.

### Examples

| Prior bot message | Buyer says | RTI result | Next |
|-------------------|------------|------------|------|
| "Want me to open *Ayana*?" | `yes` | `confirm_suggestion` → commit focus | May early-return or answer@focus |
| `no_fit` + chips shown | `Any configuration` | `apply_recovery_patch` → clear BHK | Continue to search |
| `no_fit` + chips | `increase budget to 3 Cr` | `apply_recovery_patch` | Re-search with new budget |
| Focused on Ayana | `show me other projects` | `release_focus` | Discover recommend |
| Focused on Ayana | `breakdown of costs` | **Skipped** | Layer 3 (`extractFacts`) |
| Bare `yes` with chip menu, no pending project | `yes` | `probe` — early return | "Tell me what to change…" |

### Why it exists

Free text like `"yes"` is meaningless without dialogue memory. RTI binds replies to `pendingPrompt` and recovery chips so the engine doesn't guess.

**Files:** `engine/turn-intent/*` — start at `classify.ts`, `focused-intent.ts`, `pending-prompt.ts`

**Breakpoint:** `turn.ts:196`, `classify.ts:101` (`ruleClassify`)

---

## Layer 3 — Fact extraction (regex) — `extractFacts`

### What it does

Deterministic first pass over buyer text:

- **Slots:** budget, BHK, location, property type, purpose
- **Topics:** `askTopic` / `askTopics` — price, legal, compare, media, …
- **Transitions:** `want_details`, `see_others`, `want_visit`
- **Signals:** objection, affirm, recall, named projects, EMI params, media kind

### When it runs

**Every turn** that did not early-return from RTI probe/commit shortcuts.

### When parts skip inside

| Sub-extractor | Skips when |
|---------------|------------|
| `extractLocation` | `askTopics` present, visit day utterance, detail/recovery phrases |
| Location in constraints | Compare topic, visit utterance |

### Authority

**Primary authority** for closed-set patterns. Advisor `preferences` may have already set constraints via ingress.

### Examples

| Message | Regex output |
|---------|----------------|
| `"3BHK in Coorg under 1.2 Cr"` | `constraints: { bhk, location, budgetMaxInr }` |
| `"breakdown of costs"` | `askTopics: ['price']`, no location |
| `"legal status and RERA"` | `askTopics: ['legal']` |
| `"tell me about Ayana"` | `namedProjects`, `transition: 'want_details'` |
| `"Hi"` | mostly empty — gaps for Layer 4/5 |

### Why it exists

Fast, testable, no network. Most buyer messages with clear structure never need LLM/embeddings.

**Files:** `engine/facts.ts`

**Breakpoint:** `facts.ts` top of `extractFacts`, `turn.ts:262`

---

## Layer 4 — LLM signal extraction — `extractSignals`

### What it does

DeepSeek JSON extraction for **unfilled slots only**:

- `location`, `property_type`, `purpose`, `transition`

### When it runs

Inside `extractFacts` when `needLlm` is non-empty:

| Signal | Added to `needLlm` when |
|--------|-------------------------|
| `location` | No location **and** no askTopics **and** phase not `focused`/`visit` |
| `property_type` | Not already set |
| `purpose` | Not already set |
| `transition` | Not already set by regex |

### When it skips

- No `DEEPSEEK_API_KEY` → returns `[]`
- Regex already filled the slot
- Focused phase location (location LLM suppressed)

### Examples

| Message | Regex | LLM may add |
|---------|-------|-------------|
| `"something nice near my office in Whitefield"` | maybe partial | `location: "Whitefield"` |
| `"breakdown of costs"` (focused) | `askTopics: ['price']` | **Skipped** — topics block location LLM |
| `"for investment purposes"` | purpose regex hit | **Skipped** |

### Why it exists

Regex cannot cover every paraphrase. LLM fills **gaps only** — does not override regex hits.

**Files:** `engine/adapters/llm.ts` (`extractSignals`), called from `facts.ts:111`

---

## Layer 5 — Semantic enrich (embeddings)

### What it does

Two embedding backfills via Workers AI + Vectorize:

1. **Intent Vectorize** — if `askTopics` still empty → query `INTENT_VECTORS` (≥ 0.72) → set topic
2. **Location cosine** — if `constraints.location` still empty → embed vs catalog `microMarkets` (≥ 0.78)

### When it runs

Every turn after `extractFacts`, if `env.AI` is bound.

### When it skips

| Path | Skip condition |
|------|----------------|
| Intent Vectorize | `askTopics.length > 0` after regex |
| Location embed | `constraints.location` already set |
| Entire layer | No `env.AI` → passthrough |

### Examples

| Message | After regex | Embedding may add |
|---------|-------------|-------------------|
| `"what would I pay all in?"` (vague) | no topic | `askTopics: ['price']` via Vectorize |
| `"breakdown of costs"` | `price` topic | **Intent embed skipped** |
| `"near that area where Brigade is"` | no location | location cosine if close to a micro-market |
| `"Hi"` | empty | may fuzzy-match intent (low value) or abstain |

### Why it exists

Handles vague phrasing without making embeddings the primary authority. Regex wins when it already filled slots.

**Files:** `engine/adapters/semantic-nlu.ts`

**Breakpoint:** `semantic-nlu.ts:49` (`enrich`), `turn.ts:264`

---

## Layer 6 — State merge — `applyExtracted`

### What it does

Merges `Extracted` into `ConversationState`:

- Updates `constraints` (respecting RTI `clearedKeys`)
- Sets discover flags, rejected projects, transcript hooks
- Prepares compare IDs (`prepareCompareExtracted`, `resolveCompareProjectIds`)

### When it runs

Every turn after extraction + enrich.

### Examples

| Extracted | State change |
|-----------|--------------|
| `constraints.budgetMaxInr: 1.2e7` | `state.constraints.budgetMaxInr` updated |
| RTI cleared `bhk` | budget patch applied, BHK deleted |
| Compare turn + 3 shortlist items | `compareProjectIds` bound to last offered |

**Files:** `engine/state.ts` (`applyExtracted`), `engine/compare_resolve.ts`, `turn-intent/compare-intent.ts`

**Breakpoint:** `turn.ts:298`

---

## Layer 7 — Phase guards (focus & location)

### What it does

Prevents wrong phase transitions after extraction.

**`isDetailAskTurn`** — price/legal/detail turn must not release focus:

```ts
// true when askTopics has non-compare topic, or want_details, or implicitProjectPick
```

**`locationBroaden`** — if **not** detail ask AND (broaden phrase OR location constraint changed) → release focus → discover.

Other guards: `see_others`, `want_visit`, visit day detection, compare-among-offered release.

### When it runs

After `applyExtracted`, before goal decision.

### Examples

| Phase | Message | Guard | Outcome |
|-------|---------|-------|---------|
| `focused` | `"breakdown of costs"` | `isDetailAskTurn` true → no broaden | **Stay focused** |
| `focused` | `"projects in Bangalore"` | detail false + locationBroaden | **Release to discover** |
| `focused` | `"show me others"` | RTI may already have released; else `see_others` transition | Discover |
| `focused` | `"book a visit Saturday"` | `want_visit` | `phase: visit` |

### Why it exists

Phase 0 bugs: price asks poisoned location and released focus. Guards separate **detail Q&A** from **area search pivots**.

**Files:** `engine/facts.ts` (`isDetailAskTurn`), `engine/turn.ts` (~309–370)

**Breakpoint:** `turn.ts:310`

---

## Layer 8 — Turn routing (RTI-3A / 3B) — telemetry gate

### What it does

Classifies routing kind for **visit vs answer** telemetry and a few phase nudges:

- `answer_on_project`, `visit_schedule_stop`, `visit_confirm`, `defer`

Rules first; embedder only on `defer` (≥ 0.78).

Stored in `state.rti.lastRouting`. **Does not** choose compose goal directly — `phases/*.decide` does.

### When it runs

Every turn after phase guards (~`turn.ts:300`).

### When embedder runs

Only when `classifyTurnRoutingRules` returns `routing: 'defer'`.

### Examples

| Message | Routing result | Effect |
|---------|----------------|--------|
| `"breakdown of costs"` (price topic) | `answer_on_project` | Stored; goal still from `focused.decide` |
| `"visit this weekend"` | `visit_schedule_stop` | May nudge `phase: visit` in discover+shortlist |
| Vague utterance, rules abstain | embedder or `defer` | Telemetry only |

### Why it exists

Separates visit-scheduling signals from answer signals for analytics and visit-phase entry hints. Not the main intent authority.

**Files:** `engine/turn-routing/classify.ts`, `embedder-map.ts`, `build-query.ts`

**Breakpoint:** `turn-routing/classify.ts:114`

---

## Layer 9 — Goal decision — `decideGoal` + phases

### What it does

Picks **one `TurnGoal`** from phase + extracted facts:

| Phase | Module | Typical goals |
|-------|--------|---------------|
| `discover` | `phases/discover.ts` | `greet`, `orient`, `probe`, `recommend`, `no_fit`, `commit` |
| `focused` | `phases/focused.ts` | `answer` (topic), `objection`, `propose_visit` |
| `visit` | `phases/visit.ts` | `visit_ask`, `visit_propose`, `visit_booked` |
| `handoff` | `phases/handoff.ts` | wrap-up, `warm_ack` |

`decideGoalAsync` may intercept focused **project switch** before phase decide.

### When it runs

After routing, unless RTI already returned early with probe/no_fit floor.

### Examples

| Phase | Message | Goal |
|-------|---------|------|
| `discover` | `"Coorg 3BHK 1Cr"` | `recommend` |
| `discover` | no matches | `no_fit` |
| `discover` | `"the first one"` + shortlist | `commit` → then `answer` |
| `focused` | `"breakdown of costs"` | `answer { topic: 'price', projectId: focus }` |
| `focused` | `"too expensive"` | `objection` |
| `visit` | `"Saturday 11am"` | `visit_propose` or `visit_booked` |

**Files:** `engine/turn.ts` (`decideGoalAsync`), `engine/phases/*.ts`

**Breakpoint:** `turn.ts:454`, `phases/focused.ts:11`

---

## Layer 10 — Evidence fetch (NayaDesk tools)

### What it does

Fetches **grounded facts** for the goal — no buyer-facing copy yet.

| Goal kind | Typical tools |
|-----------|---------------|
| `answer/price` | `pricing`, `landedCost` (if breakdown ask + BHK) |
| `answer/legal` | `projectDetail` (RERA, khata, …) |
| `answer/compare` | `compare` → matrix |
| `recommend` | `search` |
| `objection` | objection playbooks |
| `visit_*` | visit calendar, itinerary, CRM record |

### When it runs

After goal is known. Skips if goal is `greet`, `probe`, `smalltalk` (lighter `fetchEvidence`).

### Examples

| Goal | Buyer text | Evidence |
|------|------------|----------|
| `answer/price` | `"breakdown of costs"` + BHK in constraints | `landedCost` components |
| `answer/price` | `"pricing"` | `pricing` components |
| `answer/legal` | `"RERA number?"` | `detail.reraNumber`, khata fields |
| `recommend` | `"Coorg plantations"` | `matches[]` from search |

### Why it exists

Compose may only state what evidence contains (`grounding.ts`). Tools are the source of truth for ₹, RERA, availability.

**Files:** `engine/turn.ts` (`fetchAnswer`, `fetchRecommend`, …), `adapters/nayadesk.ts`

**Breakpoint:** `turn.ts:1039` (`fetchAnswer`)

---

## Layer 11 — Compose

### What it does

Builds buyer-visible reply from `goal + evidence + context`.

1. `buildComposeRequest` — bundles prompt context
2. **Deterministic** `fallbackReply` for gated shapes (visit, compare, multi-topic, shortlist, location snapshot, …)
3. **`llm.compose`** (DeepSeek) for single-topic answers when not deterministic
4. `stripBanned` — policy phrases

### When deterministic vs LLM

| Deterministic (`fallbackReply`) | LLM compose |
|--------------------------------|-------------|
| Visit ask/propose/booked | Single-topic price/legal/overview |
| First shortlist turn | When DeepSeek key present |
| Compare, multi-topic answer | Falls back if LLM empty/errors |
| Location/media with evidence | |
| `warm_ack`, property_type snapshot | |

### Examples

| Goal | Evidence | Path | Sample output shape |
|------|----------|------|---------------------|
| `answer/price` | `landedCost` | LLM or fallback | Component breakdown + visit CTA |
| `recommend` | 3 matches | **Deterministic** | "Here's what fits: *A*; *B*; *C*…" |
| `answer` legal+price | multi-topic | **Deterministic** | Two chunks joined |
| `visit_booked` | slot confirmed | **Deterministic** | Confirmation + next stop prompt |

**Files:** `engine/compose.ts`, `engine/adapters/llm.ts` (`compose`)

**Breakpoint:** `turn.ts:483`, `turn.ts:524`

---

## Layer 12 — Grounding & repair

### What it does

- `checkGrounding` — every ₹/RERA claim must trace to evidence
- `needsStructuredRepair` — legal/compare shape enforcement
- On fail → replace with `fallbackReply` (`grounding: 'repaired'`)

### When it runs

Every turn after compose.

### Examples

| Situation | Result |
|-----------|--------|
| LLM invents ₹85L not in evidence | Repair → deterministic price template |
| Legal answer omits RERA when in evidence | Structured repair |
| Grounded reply | `grounding: 'pass'` |

**Files:** `engine/grounding.ts`, `turn.ts` (~531–538)

---

## Layer 13 — Persist & RTI memory

### What it does

- `applyGoalToState` — update focus, shortlist, visit queue, project cache
- `buildRtiStateUpdate` — set `pendingPrompt`, `lastSuggestedActions`, `lastUiMode` for **next** turn's RTI
- `store.save` + `crm.appendMessage` + journey signals

### When it runs

End of every completed turn.

### Examples

| This turn goal | Next turn RTI memory |
|----------------|----------------------|
| `no_fit` + budget gap chips | `pendingPrompt: { kind: 'chip_menu' }`, `lastUiMode: 'search_recovery'` |
| `recommend` with matches | `lastGoalKind: 'recommend'`, clear pending |
| Offered alternate project | `pendingPrompt: { kind: 'offer_project', project_id }` → next `yes` commits |

**Files:** `engine/turn-intent/pending-prompt.ts`, `engine/turn.ts` (tail), `engine/store-kv.ts`

---

## Layer 14 — Advisor egress (web only)

### What it does

Maps engine output → `AdvisorTurnResponse` for NayaAdvisor UI:

- `projects[]` cards, `shortlist`, `focused_project`
- `visit_queue`, `visit_itinerary`
- `compare_matrix`, `search_recovery`, `ui_mode`

### When it runs

`POST /api/advisor/turn` only — not `/chat` or WhatsApp.

### Examples

| Engine result | UI receives |
|---------------|-------------|
| `recommend` + 3 matches | `projects: [{ id, name, micro_market, price_label }]` |
| `visit_booked` | `visit_booked` + `visit_itinerary` |
| `no_fit` | `search_recovery.suggested_actions` chips |

**Files:** `advisor/map-response.ts`, `map-visit-queue.ts`, `map-visit-itinerary.ts`

---

## Layer 15 — WhatsApp egress

### What it does

- `postTurnEgress` — journey signals to NayaDesk
- `whatsappActions` — up to 3 recovery buttons on no_fit/recovery turns
- Langfuse trace span

### When it runs

`runTurn` wrapper after engine (`turn/run-turn.ts`) for WhatsApp and `/chat` paths.

**Files:** `turn/run-turn.ts`, `turn/egress.ts`, `engine/recovery-planner.ts`

---

## End-to-end walkthroughs

### A — Focused price ask (free text)

```text
"breakdown of costs" @ focused Ayana
```

| Layer | Runs? | Result |
|-------|-------|--------|
| 0 Ingress | `/chat` | text only |
| 1 Bootstrap | yes | returning buyer if any |
| 2 RTI | **no** | not a search pivot |
| 3 Regex | yes | `askTopics: ['price']` |
| 4 LLM signals | partial skip | topics block location LLM |
| 5 Embeddings | intent **skipped** | topics already set |
| 6 State merge | yes | constraints unchanged |
| 7 Phase guard | `isDetailAskTurn` true | focus kept |
| 8 Routing | `answer_on_project` | telemetry |
| 9 Goal | `answer/price` | |
| 10 Evidence | `landedCost` or `pricing` | |
| 11 Compose | LLM or fallback | price reply |
| 12 Grounding | verify | pass/repair |
| 13 Persist | save + RTI update | |

---

### B — Recovery chip after no_fit (advisor)

```text
Bot: "No 3BHK at ₹1Cr — try Any configuration?"
Buyer taps chip: action_id=clear_bhk
```

| Layer | Runs? | Result |
|-------|-------|--------|
| 0 Ingress | advisor | `action_id` + preferences optional |
| 2 RTI | **yes** | `apply_recovery_patch` → clear BHK |
| 3–5 | yes | may add nothing new |
| 9 Goal | `recommend` | re-search |
| 10 Evidence | search matches | |
| 11 Compose | deterministic shortlist | |
| 13 Persist | `ui_mode: search_recovery` or matches_hub | |

---

### C — Focused → discover pivot

```text
Focused Ayana → "show me other projects"
```

| Layer | Runs? | Result |
|-------|-------|--------|
| 2 RTI | **yes** | `release_focus` |
| 7 Phase guard | released | `phase: discover` |
| 3 Regex | yes | `see_others` / wantsMore may also fire |
| 9 Goal | `recommend` | new search |
| 10 Evidence | search (exclude offered if wantsMore) | |

---

### D — Contextual yes after offer

```text
Bot: "Closest is *Krishnaja* — want me to open it?"
Buyer: "yes"
```

| Layer | Runs? | Result |
|-------|-------|--------|
| 2 RTI | **yes** | `pendingPrompt.kind=offer_project` → `confirm_suggestion` |
| apply | `focusCommitted` | early commit path or continue to answer |
| 3 Regex | may run after | `affirm` detected but focus already committed |

---

## Authority cheat sheet

| Question | Primary layer | Fallback |
|----------|---------------|----------|
| "What does yes mean?" | **RTI (2)** | RTI LLM |
| "What topic is this?" | **Regex (3)** | Embeddings (5) |
| "What location?" | **Regex (3)** | LLM signals (4) → Embeddings (5) |
| "Stay focused or search?" | **RTI pivot (2)** + **Phase guard (7)** | |
| "What goal?" | **Phases (9)** | |
| "What facts?" | **NayaDesk tools (10)** | |
| "What words?" | **Compose (11)** | fallbackReply repair (12) |

---

## Debug order (single turn)

1. `turn.ts:86` — entry
2. `turn.ts:196` — RTI gate
3. `facts.ts` — `extractFacts`
4. `semantic-nlu.ts:49` — enrich
5. `turn.ts:310` — `isDetailAskTurn`
6. `phases/focused.ts:11` or `discover.ts:5` — goal
7. `turn.ts:1039` — evidence
8. `turn.ts:524` — compose
9. `grounding.ts` — verify

---

## Related docs

- [`CONVERSESPINE_ARCHITECTURE.md`](./CONVERSESPINE_ARCHITECTURE.md) — Mermaid diagrams
- [`CONVERSE_ENGINE.md`](./CONVERSE_ENGINE.md) — invariants
- [`PRODUCTION_STACK.md`](./PRODUCTION_STACK.md) — bindings (`AI`, `INTENT_VECTORS`, `DEEPSEEK_API_KEY`)
