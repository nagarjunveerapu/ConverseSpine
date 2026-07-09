# Speech-act contract — ConverseSpine

**Status:** Design — **ruthless cut**, revisited after naya-db-dev corpus + architecture counter-check (2026-07-09)  
**Rule:** An intent earns a name only if it changes **goal kind**, **extract permissions**, or **evidence tool**. Everything else is lexicon → existing bucket, or deferred product work.  
**Sources:** ~24k inbound `messages` + ~17.5k `turn_traces` on Cloudflare **naya-db-dev** / **naya-bot-telemetry-dev**; Naya 30 `IntentKind`s; Spine docs below.  
**Does not replace:** RTI, PROJECT_VECTORS, visit time FSM, compose polish, Slice-1/2 extract authority.

**Related:** [`CONSOLIDATED_ROADMAP.md`](../CONSOLIDATED_ROADMAP.md) · [`CONVERSESPINE_ARCHITECTURE.md`](../CONVERSESPINE_ARCHITECTURE.md) · [`CONVERSE_ENGINE.md`](../CONVERSE_ENGINE.md) · [`SLICE-1`](./SLICE-1_EXTRACT_AUTHORITY.md) · [`SLICE-2`](./SLICE-2_UNIFIED_EXTRACT_FUNNEL.md) · Naya [`INTENT_TAXONOMY_v3.md`](../../../Naya/docs/INTENT_TAXONOMY_v3.md)

---

## 0. Revisit verdict (corpus × architecture)

### 0.1 What Dev corpus says we must fix first

| Rank | Buyer pattern (approx inbound hits) | Failure mode seen on Dev / UAT | Speech-act fix |
|------|-------------------------------------|--------------------------------|----------------|
| 1 | Visit ~2.0k | Book vs recall mixed (“site visit” vs “my visits”) | `visit_book` ≠ `visit_recall` |
| 2 | Price ~1.7k | Usually OK when focused; thin when wrong goal | act=`answer` + topic `price` (exists) |
| 3 | Compare / both / vs ~0.9k | Wrong pair / shortlist | act=`compare` + discussed/anaphora (P1c) |
| 4 | Legal ~0.8k / EMI ~0.8k | Mostly answer path | keep topics; don’t add kinds |
| 5 | **Sizes/configs ~0.7k** | Treated as **search** → “closest fit / tap a button” | act=`answer` + `availability`; **block propertyType** |
| 6 | Media ~0.6k | mediaShare exists | topic `media` |
| 7 | ROI/yield ~0.6k / payment plan ~0.1k | Real asks; Naya often wrong template | **DEFER** topic until tool — honest unknown under `answer` |
| 8 | Objection ~0.3k / handoff ~0.2k / stop ~0.1k | Need distinct goals | `object` / `handoff` / `stop` |
| — | Broker ~60 | Rare | **CUT** as act |

Telemetry smell: ~10k `template_fired` vs ~6k brain; ~350 turns with missed intents — **more IntentKinds did not buy understanding**.

### 0.2 Locked Spine decisions we must not violate

| Decision (doc) | Implication for speech-act |
|----------------|----------------------------|
| One loop: extract → goal → evidence → compose → verify ([`CONVERSE_ENGINE.md`](../CONVERSE_ENGINE.md)) | Speech act is a **gate before/around extract**, not a parallel brain |
| **Chip paths win**; free text resolves to chips; then path-local rules; embedder/LLM last ([`CONVERSESPINE_ARCHITECTURE.md`](../CONVERSESPINE_ARCHITECTURE.md) §Authority) | “Regex wins” = **closed chip menu**, not unbounded free-text regex. Free text → same Compare/Legal/… paths as Advisor chips |
| PROJECT_VECTORS = **which project** (P1c); no regex name ladder | Act/chip owns *move*; vectors own *identity*; anaphora skip vectors on “them/both” |
| RTI before extract when pending ([roadmap](../CONSOLIDATED_ROADMAP.md) P4, Slice-2) | Pending `action_id` **is** chip path — outranks free-text resolve |
| Slice-1/2: intent/topic **first**, then gap slots | Speech act **= resolved chip path**; then permissions filter slots |
| Compare beats recommend; don’t wipe shortlist ([`CONVERSE_ENGINE.md`](../CONVERSE_ENGINE.md) invariants) | act=`compare` must not fall through to `search`/`no_fit` |
| P3 facet depth paused; P2 ledger critical; P5 routing unused | **SA ships before P3 templates**; ledger should record `speech_act`; P5 becomes “routing ≡ act” not a second classifier |
| P6 BAML abstain-only; P8 OpenSearch deferred | No BAML/RAG as speech-act owner; no ghost payment-plan intent for brochure RAG |
| No quality regression / no broad verify strip | Fix act upstream; don’t ban-phrase plot-size failures |

### 0.3 Plan changes after this revisit

| Earlier idea | Revised |
|--------------|---------|
| Wait for P2 ledger before any facet work | **SA-0…2 can ship without P2** — corpus failures are act collisions, not missing memory |
| P3 facet extractors (ec/banks/…) next | **After** SA answer-vs-search gate; P3 deepens *copy/evidence*, doesn’t invent acts |
| P5 wire `lastRouting` as independent authority | **Demote:** routing becomes **projection of speech act** (same closed set) |
| INTENT_VECTORS as primary “intent” | Keep as **topic gap-fill only** under act=`answer`/`search`; never invent `visit_book` from embed noise |
| Expand AnswerTopic for payment_plan/investment now | Stay **DEFER** — corpus volume exists but tool+honest path first |
| `recommend_ask` separate act | Stay **FOLD → search** — corpus doesn’t need a second hunt desk |

### 0.4 Chip-canonical path (NayaAdvisor + WhatsApp — same engine)

**Founder clarification (2026-07-09):** “Regex/rules win” means **chip paths win**, not unbounded free-text regex sprawl.

```text
Chip tap (action_id / structured pref)
  → exact closed path (Compare / Legal / Price / Visit / …)
  → same decide + evidence + compose as today

Free text
  → resolve to chip path(s) FIRST (same IDs / same speech act + topic)
  → then run that path’s rules (easy, closed)
  → if no chip match → INTENT/PROJECT embedder (gap-fill)
  → if still abstain → LLM signals / compose (last resort)
```

| Surface | Example | Resolves to |
|---------|---------|-------------|
| Chip | **Compare Projects** | act=`compare` (action_id authority) |
| Free text | “can you compare the projects” | **same** compare path (not a new intent) |
| Chip | **Legal** | act=`answer` topic=`legal` |
| Free text | “are there any legal issues?” | Legal path + optional `object` if concern tone — **compound chip resolution**, still closed |

**Why this fits Advisor + WhatsApp:** one engine; Advisor chips and recovery chips **define the menu**; typed language is a soft entry into that menu. Regex after resolve is small (path-local), not a second taxonomy.

**Compound resolution (v1):** free text may map to **1 primary chip path + at most 1 secondary** (e.g. Legal + Objection). Primary drives goal; secondary may add evidence/playbook. Do not explode into Naya multi-intent tournaments.

**Embedder role (unchanged architecture, sharper):**  
- After failed chip-resolve only (or to fill topic when act=`answer` and topic empty)  
- PROJECT_VECTORS still = which project name  
- Never invent a chip that isn’t on the menu  

### 0.5 Revised pipeline (fits north-star + chips)

```text
load + bootstrap
→ RTI if pending chip/yes-no     # action_id already = chip path
→ resolveFreeTextToChipPaths     # NEW — map utterance → chip id(s) / act+topic
→ classifySpeechAct (from chip)  # closed; chip wins over guess
→ extractTurnAuthority           # gap slots only; permissions by act
→ PROJECT_VECTORS / refs         # identity (gated)
→ decideGoal(act) → evidence → compose → verify → ledger
→ if unresolved: embedder → LLM abstain/fallback
```

---

## 1. How Naya got fat (do not repeat)

Naya’s 30 intents mixed **dialogue moves**, **info facets**, **sales theatre**, and **ambient tags** in one enum. Then:

- classifier + extractors + dispatcher + obligations + reply_planner + brain competed  
- more intents → more obligations → more templates → Stage 1.6 over-strip  

Spine already has goals for almost every *real* move. The hole is **not** missing intent names — it is **wrong act classification** (facet vs search, book vs recall) and **thin evidence binding** (availability → units).

**Anti-goal:** Port the 30-kind taxonomy.  
**Goal:** ~10 speech acts + Spine’s existing ~10 topics, with gates so they stop colliding.

---

## 2. Admission test (use on every candidate)

Add a `SpeechActKind` or `FacetIntent` **only if** ≥1 is true:

| # | Test | If false → |
|---|------|------------|
| A | Changes `TurnGoal.kind` (or visit ask subtype) vs nearest existing act | **FOLD** into existing act |
| B | Changes extract permissions (e.g. may/may-not write `propertyType`) | else FOLD |
| C | Changes which `EngineData.*` tool runs | else FOLD into existing facet |
| D | Has a **shipped** evidence/API path today (or in the same PR) | else **DEFER** (no ghost intent) |

Ambient signals (`I'm NRI`, `ok thanks`) that only write CRM facts → **side-effect**, not an act.

---

## 3. Verdict table — all 30 Naya intents

Legend: **KEEP** = first-class in Spine contract · **FOLD** = map to KEEP without new kind · **DEFER** = no kind until tool+copy exist · **CUT** = do not port

| Naya IntentKind | Verdict | Spine home | Why |
|-----------------|---------|------------|-----|
| `find_projects` | **KEEP** | act `search` | Changes goal → recommend/probe/no_fit; may write constraints |
| `recommend` | **FOLD** | act `search` (+ compare-advice if shortlist≥2) | Same tool (`search` / shortlist); “suggest” is copy, not a new machine |
| `compare_projects` | **KEEP** | act `compare` | Different goal + compare tool + ID resolution |
| `get_project_info` | **FOLD** | act `answer` + facet `overview` **or** act `switch` if named≠focus | Overview already exists |
| `ask_about_builder` | **DEFER** | — | No builder dossier tool; FAQ under overview/legal until API exists |
| `get_price` | **KEEP** | facet `price` | pricing / landedCost tools |
| `negotiate_price` | **FOLD** | act `object` (topic price) **or** facet `price` | Same playbooks/pricing; separate kind was classifier theatre |
| `compute_emi` | **KEEP** | facet `emi` | Distinct tool path (priceBasis + EMI) |
| `ask_investment_return` | **DEFER** | — | No ROI evidence bundle; don’t invent facet |
| `get_payment_plan` | **DEFER** | — | No payment-plan API in Spine ports; don’t ghost-intent |
| `get_availability` | **KEEP** | facet `availability` | listUnits / configs — **plot sizes** |
| `ask_delivery_timeline` | **FOLD** | facet `legal` (possession lines in detail) | Detail already carries possession; split later only if verify needs it |
| `get_amenities` | **KEEP** | facet `amenities` | faq/detail path exists (thin but real) |
| `get_location_info` | **KEEP** | facet `location` | location evidence exists |
| `get_legal_info` | **KEEP** | facet `legal` | detail legal fields |
| `get_brochure` | **KEEP** | facet `media` | mediaShare exists |
| `book_visit` | **KEEP** | act `visit_book` | Visit FSM; ≠ recall |
| `reschedule_visit` | **FOLD** | act `visit_book` + visit state (has booked) | Same FSM; reschedule is slot rewrite, not new act |
| `request_callback` | **FOLD** | act `handoff` | One exit ramp; subtype in payload if needed later |
| `provide_qualification` | **CUT** as intent | side-effect on any act | Writes facts only; Naya ambient |
| `commit` | **FOLD** | act `switch` | Same as named project commit |
| `confirm_action` | **FOLD** | state gate: visit.awaitingConfirm → visit_booked; else RTI / warm_ack | Not a free-text act — **pending owns it** |
| `express_objection` | **KEEP** | act `object` | objection goal + playbooks |
| `broker_inquiry` | **CUT** | treat as `search` + optional flag later | Product policy, not turn kernel v1 |
| `status_check` | **FOLD** | `visit_recall` if visit-shaped; else `handoff` | Don’t add third status machine |
| `report_issue` | **FOLD** | act `handoff` | Same exit ramp |
| `escalate_to_human` | **KEEP** | act `handoff` | Explicit exit |
| `opt_out` | **KEEP** | act `stop` | Hard stop / delete path |
| `acknowledge` | **FOLD** | warm_ack / affirm in phase | State-dependent; RTI/visit already handle |
| `small_talk` | **FOLD** | act `greet` | One social act |
| `other` | **FOLD** | act `unknown` | Abstain |

**Score:** Naya 30 → **KEEP 14 concepts** (8 acts + 6 must-have facets already in Spine) + folds. **DEFER 3**. **CUT 2** as kinds.

---

## 4. Minimal closed sets (what we actually build)

### 4.0 Chip catalog = speech-act menu (Advisor + engine)

Speech acts are not a parallel taxonomy. They are the **server chip / NBA / recovery action menu** expressed as moves. Free text must resolve into that menu.

| Chip / action family (illustrative) | Speech act | Topic / payload |
|-------------------------------------|------------|-----------------|
| Compare Projects / Compare both | `compare` | discussed / named IDs |
| Legal / RERA | `answer` | `legal` |
| Pricing / Cost | `answer` | `price` |
| Configurations / Plot sizes / Units | `answer` | `availability` |
| Brochure / Floor plan | `answer` | `media` |
| EMI | `answer` | `emi` |
| Book visit / Schedule | `visit_book` | visit seed |
| My visits / Bookings | `visit_recall` | itinerary |
| Show more / Change area / budget chips | `search` | constraint patch |
| Talk to human / Call me | `handoff` | — |
| Stop | `stop` | — |

**Free-text resolve examples (same paths):**

| Free text | Chip path(s) |
|-----------|----------------|
| “can you compare the projects” | Compare Projects |
| “are there any legal issues?” | Legal (+ Objection if concern tone) |
| “plot sizes offered?” | Configurations / availability — **not** “change property type” search chip |
| “ok lets do a site visit” | Book visit |
| “tell me about my visits” | My visits |

Adding a new Advisor chip later = add one catalog row + resolve phrases — **not** a new Naya IntentKind enum.

### 3.1 Speech acts — **8 + unknown**

```typescript
type SpeechActKind =
  | 'greet'          // hi / how are you
  | 'search'         // find / refine brief / "show options" / folded recommend
  | 'answer'         // focused (or named) project Q&A — all get_* facets
  | 'switch'         // commit / tell me about other project
  | 'compare'        // side-by-side
  | 'visit_book'     // schedule / reschedule / continue visit FSM
  | 'visit_recall'   // my bookings / itinerary only
  | 'object'         // objection / negotiate-as-objection
  | 'handoff'        // human / callback / complaint
  | 'stop'           // opt out
  | 'unknown';
```

**Dropped vs earlier draft (were Naya-creep):**

| Removed | Why |
|---------|-----|
| `recommend_ask` | Folds into `search` |
| `visit_reschedule` | Folds into `visit_book` |
| `visit_confirm` | State/RTI — not classified from free text |
| `reject` | `Extracted.rejected` → existing `ack_reject_recommend` |
| `affirm_continue` | Phase/RTI |
| `focused_facet` rename | Call it **`answer`** — matches `TurnGoal.answer` |
| `brief_refine` rename | Call it **`search`** — matches recommend path |
| `project_switch` rename | Call it **`switch`** |
| `smalltalk` | Fold into `greet` |

### 3.2 Facets — **use existing `AnswerTopic` only**

Do **not** invent a parallel `FacetIntent` enum in v1. Reuse:

```typescript
// already in types.ts
type AnswerTopic =
  | 'price' | 'legal' | 'emi' | 'amenities' | 'availability'
  | 'location' | 'media' | 'overview' | 'property_type' | 'compare';
```

| Topic | KEEP why | Lexicon adds (not new kinds) |
|-------|----------|------------------------------|
| `availability` | units tool | **plot sizes, unit sizes, sqft, configurations** |
| `price` | pricing/landed | breakdown, per sqft, cost |
| `emi` | EMI tool | EMI, installment |
| `legal` | detail legal + possession lines | RERA, EC, khata, possession, banks |
| `amenities` | faq | amenities, pool |
| `location` | location evidence | where, connectivity |
| `media` | mediaShare | brochure, floor plan |
| `overview` | detail summary | tell me more, details |
| `property_type` | rare Q&A “is this a villa?” | **not** search constraint when act=`answer` |
| `compare` | only under act=`compare` | — |

**DEFER as topics until tool exists:** `payment_plan`, `investment`, `builder`.  
When they ship: add **one** `AnswerTopic` + one evidence function — not a speech act.

---

## 5. Two-axis model (slim)

```text
SpeechAct (8+unknown)  →  permissions + goal family
AnswerTopic[]          →  evidence tools (only if act = answer | switch | compare)
Payload                →  namedProjects, compareIds, visit seed, constraints (act-scoped)
```

```text
RTI if pending → classifySpeechAct → detectTopics (if act allows)
  → extract scoped → decide → fetch → compose
```

Multi-topic v1: allow `askTopics[]` under `answer` (price+media) — Spine already supports multi-topic answer. **Primary topic** drives verify; no obligation tournament.

---

## 6. Precedence (speech act only)

```text
0. stop / handoff / greet (whole-utterance)
1. RTI pending → RTI owns turn
2. visit.awaitingConfirm + affirm → visit_booked (no act classify needed)
3. visit_recall  ONLY booking deixis ("my visits", "what did I book")
4. visit_book    schedule intent incl. "come for the visit", "visit them", reschedule cues
5. compare
6. switch        named ≠ focus
7. object
8. answer        focus|named|singleton + facet lexicon  → FORBID propertyType overwrite
9. search        constraint / list / suggest
10. unknown
```

### Gates that fix UAT (no new intents)

| Collision | Rule |
|-----------|------|
| plot sizes vs search | act=`answer` + topic=`availability`; discard `propertyType` from utterance |
| the visit vs recall | recall only with booking deixis; else `visit_book` |
| visit after compare | seed stops from `discussedProjects` / named / focus |
| Ayana @ visit lastAsk | visit slot fill under `visit_book`, not `search` |

---

## 7. Extract permissions

| Act | Write constraints? | Topics? | Vectors? |
|-----|--------------------|---------|----------|
| `search` | ✅ | ❌ | optional |
| `answer` | ❌ type/loc from facet nouns | ✅ | if name in text |
| `switch` | ❌ | optional follow-up | ✅ |
| `compare` | ❌ | compare (+optional) | ✅ / anaphora |
| `visit_book` | ❌ | ❌ | ✅ / anaphora skip |
| `visit_recall` | ❌ | ❌ | ❌ |
| `object` | ❌ | ❌ | if named |
| `handoff` / `stop` / `greet` | ❌ | ❌ | ❌ |
| `unknown` | conservative | gap | abstain |

---

## 8. Tools — bind what exists; don’t invent intents for missing tools

### Ship now (bind under act/topic)

| Tool | When |
|------|------|
| `search` | act=`search` |
| `compare` | act=`compare` |
| `projectDetail` | answer: overview/legal/amenities/location |
| `pricing` / `landedCost` | answer: price |
| `priceBasis`+EMI | answer: emi |
| `listUnits` / configurations | answer: **availability** (plot sizes) |
| `mediaShare` | answer: media |
| `objectionContext` | act=`object` |
| visit FSM + `recordVisit` / itinerary | visit_book / visit_recall |

### Do **not** add intents waiting on these

| Missing capability | Until then |
|--------------------|------------|
| Payment plan API | DEFER topic; answer overview/price honestly |
| ROI / investment bundle | DEFER |
| Builder dossier | DEFER; soft overview |
| Docs RAG | DEFER; mediaShare only |
| Market intel | CUT from kernel |
| Lead status CRM | FOLD visit_recall / handoff |

**Quality lever for plot sizes:** lexicon → `availability` + ensure `listUnits`/configs in evidence — **not** a new intent kind.

---

## 9. Goal projection (acts → existing TurnGoal)

| Act | Goal |
|-----|------|
| `greet` | `greet` / `smalltalk` |
| `search` | `recommend` / `probe` / `no_fit` / `ack_reject_recommend` |
| `answer` | `answer{topic, projectId}` |
| `switch` | `commit` (+ optional follow-up `answer`) |
| `compare` | `answer{compare}` |
| `visit_book` | `propose_visit` / `visit_ask` / `visit_propose` |
| `visit_recall` | `visit_recall` |
| `object` | `objection` |
| `handoff` | `handoff` |
| `stop` | stop / delete memory |
| `unknown` | phase default |

No new `TurnGoal` kinds required for v1.

---

## 10. What recreates Naya (explicit reject list)

| Temptation | Reject because |
|------------|----------------|
| 30 speech acts | Classifier sprawl |
| Parallel FacetIntent enum + AnswerTopic | Two sources of truth |
| `recommend` / `negotiate` / `payment_plan` / `investment` as first-class before tools | Ghost intents → thin templates / wrong goals |
| Obligation tournament / reply_planner | Quality collapse mode |
| Multi-agent intent router | Opaque, slow, untestable |
| Compose/grounding patches for plot sizes | Wrong layer |
| `confirm_action` as free-text act | Pending state already owns yes |

---

## 11. Implementation slices (after go) — ordered vs roadmap

Corpus rank + architecture constraints → ship order:

| Slice | Scope | Unblocks | Roadmap relation |
|-------|-------|----------|------------------|
| **SA-0** | Chip catalog table + free-text→chip resolve + act classify tests | Foundation; Advisor/WhatsApp parity | **✅ landed** (`src/engine/speech-act/`, wired in `extract-authority`) |
| **SA-1** | Permissions: resolved `answer`/Legal/Configs blocks propertyType search | Plot sizes / configs (~0.7k Dev) | **✅ landed** (`permissions.ts` + focused-pivot gate); verified via `npm run test:scenarios` |
| **SA-2** | `visit_book` vs `visit_recall` + discussed seed | Visit book/recall (~2k / ~0.15k) | 🟡 PR — discussed multi-seed + chip seeds + SA-G02/G02b |
| **SA-3** | availability lexicon → always pull units/configs | Thin size answers | Mini-P3 evidence bind; full P3 copy later |
| **SA-4** | `lastRouting` / decide ≡ speech act | Dedup routers | **Is** P5-core, not a second system |
| **SA-5** | Ledger `speech_act` + topics in `resolved_intent_json` | Debug on Dev | P2a column fill |

**Do not wait on:** P2 full read loop, P3 facet templates, P6 BAML, P8 OpenSearch.  
**Out of v1:** payment_plan/investment/builder topics, broker act, recommend_ask, FacetIntent enum, multi-agent router.

```text
SA-0 ✅ (chip catalog + free-text resolve) → SA-1 ✅ (answer blocks propertyType) → SA-2..3
                              ↓
                         SA-5 with P2a
                              ↓
                         SA-4 = P5-core
                              ↓
                         P3 deep facets (ec/banks) on top of stable act=answer
                              ↓
                         P4/P6 BAML shadow only (abstain), never act authority
```

---

## 12. Golden threads

1. Focused → “plot sizes?” → act=`answer` topic=`availability` → units — not no_fit  
2. After compare → “come for the visit” → act=`visit_book` — not recall  
3. “compare them” → act=`compare` + discussed IDs  
4. No focus → “plots in sakleshpur” → act=`search` propertyType ok  
5. “my visits?” → act=`visit_recall`  
6. “any discount?” → act=`object` (not new negotiate intent)

---

## 13. Decision ask

Approve the **chip-canonical** model:

1. **Chips define the closed menu** (Advisor + recovery + NBA)  
2. **Free text resolves into those chip paths first** — then path-local rules  
3. **Embedder → LLM only if no chip match** (gap-fill / last resort)  
4. **Compound max 1+1** (e.g. Legal + Objection) — no 30-intent tournament  
5. Slim acts + existing AnswerTopics; SA-0 = catalog + resolve  

Reject: unbounded free-text regex as authority; embeddings inventing paths not on the chip menu.
