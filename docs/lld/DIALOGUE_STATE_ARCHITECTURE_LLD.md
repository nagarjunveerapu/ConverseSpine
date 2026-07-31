# Dialogue state architecture — LLD

**Audience:** implementer + reviewer
**Scope:** ConverseSpine `origin/main` @ `0243356` — the understanding/state/policy seam
**Status:** proposed, awaiting founder approval — review of 2026-07-26 folded into the body; **§3b/§3c added 2026-07-27; gate criteria corrected the same day (truth grader, not focus-stay)**
**Supersedes:** the Lane A sequencing in [`SUBJECT_RESOLUTION_PLAN.md`](../SUBJECT_RESOLUTION_PLAN.md) (PR-2 and PR-4 are absorbed here; PR-1 has shipped as #150)
**Evidence base:** [`SUBJECT_RESOLUTION_MAP.md`](../SUBJECT_RESOLUTION_MAP.md) — every claim below was verified by executing the code, not by reading it

---

## 0. How to use this doc

1. **No phase ships without its gate.** Gates are behavioural (what the buyer gets), not structural (what the code looks like).
2. **Phase 0 and 4a have no buyer-visible win; Phase 1 does.** Its gate is J7 and `NAME-06` going green, which a buyer sees. What 0 and 4a buy is the ability to *tell whether anything worked* — the part that gets skipped, and the reason 2/3/5 would otherwise ship half-working and get patched forever.
3. **Every defect probe is committed failing on `main` before its fix is written.** If it does not fail, the defect is not real and the change is dropped.
4. **No new pipeline stage.** This changes the shape of state and the direction of one arrow. It does not add a layer.
5. Understanding misses are fixed in the **embedding/teach lane**, never with new regex.

---

## 1. Problem statement

Three defects, all verified live this session, all with the same root:

| symptom | verified | root |
|---|---|---|
| `"comparing Eldorado and Sanctuary"` → compares Ayana / Desire Spaces / Vanam | `resolveCompareProjectIds → ["ayana","desire-spaces","vanam"]` | 21 resolvers read entity pools in 4 different orderings; the catalog is in none of them |
| `"I like this"`, `"what's next"` unanswerable | `ask_next_step` has zero consumers; `grep -rn` returns nothing | understanding receives `uₜ` only, never `bₜ₋₁` |
| `"price and is it RERA approved"` answers one | router emits a single `top_kind` | producer is argmax; `askTopics[]` and AB-8 compose already accept a set |

The state's **contents** are strong — `constraintAuthority` (declared vs inferred), `disclosedFacts` (common ground), `rejectedProjectIds` (negative preference), `pendingPrompt` (system-act memory). Few production systems track those.

The state's **structure** is the problem. There is no canonical entity store, no salience order, no focus stack, and no uncertainty. Every consumer re-derives its own projection — and 21 hand-rolled projections of one state *is* the bug class.

> A rich schema with no normal form.

---

## 2. Target architecture

```
                              ┌──────────────────────────────┐
                              │  DIALOGUE STATE  (belief)    │
                              │  entity store · focus stack  │
              conditions      │  salience · confidence       │
        ┌─────────────────────┤  disclosed facts             │
        │                     └──────────▲───────────────────┘
        │                                │ updates
        ▼                                │
 ┌─────────────────┐                     │
 │ UNDERSTANDING   ├─────────────────────┘
 │ bi-encoder      │◄──────► LLM extract (hard turns, 10–20%)
 │ multi-label     │
 │ refs resolved   │
 └────────┬────────┘
          │  a SET of acts, references resolved
          ▼
     POLICY  decide()
          ▼
     EVIDENCE  Desk facts only        ← unchanged, and the reason we don't hallucinate
          ▼
     COMPOSER  templates first        ← unchanged
          ▼
     Reply                            → TURN LEDGER (bind, goal, outcome)
```

**The load-bearing change is the arrow from state back into understanding.** Formally:

```
bₜ = f(bₜ₋₁, uₜ)          not          bₜ = update(bₜ₋₁, extract(uₜ))
```

`"I like this"` has no meaning under the second form. That is the whole of the `ask_next_step` problem.

### What does not change

`fetchEvidence` remains the only source of facts, and compose remains templates-first with the LLM as fallback. That spine is why the bot declines instead of inventing. **No phase touches it.** The industry's LLM-collapsed architecture deletes that box, which is precisely why those systems invent RERA numbers.

---

## 3. Phase 0 — the ledger tells the truth

### Problem
`ledger-write.ts` writes `success: true` for every tool run. `nayadesk.ts:907` writes `engine_status: 'ok'` unconditionally. Every Desk adapter is `catch { return null }`. So a Desk 500 during `pricing` is recorded as a **successful** `pricing` run in a turn marked `ok`.

No store distinguishes *"the project has no price"* from *"the price fetch failed."* Every phase below is measured through this instrument.

### Design — tiered, because the port change is not one day

`EngineData` should return a discriminated result rather than `T | null`, so absence and failure are distinct at the port:

```ts
{ ok: true, value: T } | { ok: false, reason: 'absent' | 'transport' }
```

But ~15 methods use nullable contracts today (`projectDetail`, `pricing`, `compare`, `mediaShare`, `conversationContext`, `builder`, …). Migrating all of them is not a day's work, so the phase is tiered and **only 0a is required to close it**:

| tier | scope | size |
|---|---|---|
| **0a** | `tool_runs[].success` + real `latency_ms`; `postChoiceEvent` `engine_status`; drop the `Math.max(…, 2)` floor on `projects_compared`; promote the fields `observability/turn-log-snapshot.ts` already computes (`named_projects` as `id:name` pairs, `switch_intent`, full `extract_provenance`) from the wrangler-dev-only path into the deployed ledger row | **S — the "one day"** (landed) |
| **0b** | result wrappers for the methods 0a measures: `pricing`, `landedCost`, `priceBasis`, `faqLookup`, `projectDetail` + multi-intent compose join policy | M — **landed** |
| 0c | remainder of `EngineData` | separate PR |

### Phase 0b contract (landed)

```ts
type DataResult<T> =
  | { ok: true; value: T; latency_ms: number }
  | { ok: false; reason: 'absent' | 'transport'; latency_ms: number };
```

- Desk empty / 404 / no row → `absent`
- thrown / network / unexpected → `transport`
- success → `ok` with wall-clock `latency_ms`
- Ledger: `produced_evidence` only on `ok`; carry `latency_ms`; optional `failure_reason` on the tool run
- Scenario gate: `npm run test:phase-0b` / `test:phase-0b:live` (IDs `0B-01`…`0B-14`, including multi-intent articulation)

### Gate
A forced adapter failure appears as `success: false`. One ledger row answers *"what bound, what goal, what reply, and did the data exist."* **0c is not required to merge 0a.**

---

## 3b. Phase 0d — understanding before mutation

> **Implementation design note (awaiting founder approval before code):**
> [`PHASE_0D_UNDERSTANDING_BEFORE_MUTATION.md`](./PHASE_0D_UNDERSTANDING_BEFORE_MUTATION.md)

> **Added 2026-07-27, from measurement.** This phase did not exist when §§1–13
> were written, and every one of those phases silently assumes it. §5's own
> gate says `ask_next_step` must be "wired as a state-conditioned **consumer**"
> — there is no consumer, and there is no point in the pipeline where one could
> be added, because the decision happens before the understanding exists.

### Problem

The turn destroys the conversation's subject before it works out what the turn
meant.

```
turn.ts:341   const intent = await deps.turnIntent.classify(intentInput)   ← LLM
turn.ts:343   applyTurnIntentResult(...)  →  releaseToDiscover()           ← subject deleted
       ⋮
turn.ts:927   routing = await classifyTurnRouting(...)                     ← verdict computed
```

584 lines apart. And the gate that decides whether `341` runs at all reaches
`isFocusedSearchPivot` (`turn-intent/focused-intent.ts:97`) — **a regex.** No
LLM, no embedder. That predicate is the real authority on whether a focused
turn is the buyer walking away.

Measured directly on the predicate, and live on dev with Brigade Eldorado
focused, six fresh conversations per phrasing:

| utterance | `isFocusedSearchPivot` | embedder bind | focus kept |
|---|---|---|---|
| `when is possession` | **true** | `ask_delivery_timeline` 0.874 | 0/6 |
| `what is the possession date` | false | `ask_delivery_timeline` 0.880 | 6/6 |
| `has this area appreciated` | **true** | `ask_investment_return` 0.828 | 0/6 |

Same intent, same confidence, opposite outcomes — 100% correlated with the
regex. `embedder-map.ts` had already mapped `ask_delivery_timeline → availability`
and listed it in `ANSWER_INTENTS`. Everything needed to answer was in hand
before the turn went shopping, and nothing asked. The shortlist that replaces
the project then *becomes* the subject: chained, 5 of 8 asks collapse with no
recovery path.

**This is the concrete mechanism behind "every intent-layer gain measures inert
end-to-end."** Not a missing wire — an ordering. The corpus, the learned
projection, the teach loop and the Understanding board are all downstream of a
predicate that has already decided.

### Why a veto is not the fix — the measurement that proves it

#159 gave the embedder a vote against that regex. On the possession phrasing
cliff that is verified: `when is possession` went 0/6 → 6/6 keep-focus with the
wire on (same bind confidence as `what is the possession date`). An offline
audit over **1,751 unique real captured buyer texts** then sized the veto class:

```
answer-intent binds ≥ tau_high      306
  regex says "pivot"                 64   ← where a veto fires
    predicted NEW search constraint  ~31  ← genuine pivots (offline label)
    predicted answer-on-focus        ~33  ← defects if regex wins
```

Those ~31/~33 counts are an **offline sizing**, not a live pass bar. A first
live probe with the wire on did show genuine pivots answered on the focused
project (e.g. budget/locality moves returning Eldorado configs/pricing). That
failure mode is real. What is **not** authoritative: any early six-probe count
that graded *"did it stay on Eldorado"* instead of *"was the answer true to the
catalog."* That grader is discarded. Catalog anchors for re-grading:

- 21 projects in the dig catalog; no Jayanagar inventory
- cheapest 2BHK: Brigade Cornerstone Utopia from ₹45.0L
- Eldorado 2BHK from ₹57.5L
- Whitefield-only 3BHK from ₹1.55 Cr

#160 sets `ROUTING_IN_GOAL=false` on dig (merged + Deploy dig). Wire code stays;
flag stays off until this phase lands.

The narrowing the data suggests — *do not veto when the turn carries a new
constraint* — requires the **extract**, which has not run at that point. Adding
a constraint check by hand would be a second regex deciding meaning, which is
the thing being fixed. **Every narrow fix at this seam needs information that
does not exist yet when the decision is taken.** That is the argument for the
phase, and it is evidence rather than taste.

The audit also found confident binds that are simply wrong — `"70L"` →
`get_brochure` @ 0.870, `"summarize everything we discussed"` →
`ask_delivery_timeline`. Anything that leans on the verdict inherits that error
rate, which is why §3c below is a prerequisite of the gate and not a nicety.

### Design

The LLD's central formula already says it:

```
bₜ = f(bₜ₋₁, uₜ)     not     bₜ = update(bₜ₋₁, extract(uₜ))
```

Phase 0d is the half nobody built: **uₜ must be complete before bₜ is
computed.** Today `uₜ` is assembled in pieces across 900 lines while `bₜ` is
mutated in the middle of it.

This is **not a new stage** (§0 rule 4). It reorders existing ones:

1. **Assemble `uₜ` first.** Run the embed route and the LLM extract
   concurrently on the raw message — they read the same input and neither needs
   the other — and join before any state write. This is the same change the
   latency plan already scopes as "parallelize the extract"; the ~1–2s saving is
   a side effect, not the reason.
2. **Every state mutation moves after the join.** `releaseToDiscover`,
   `commitTo`, constraint writes. The turn-intent classifier keeps its job but
   becomes one input to `f`, not a direct writer.
3. **`isFocusedSearchPivot` stops being an authority and becomes a signal** —
   one input among the verdict, the extracted constraints and the prior state.
   It is not deleted; it is demoted. A turn that carries a new budget, BHK or
   locality *is* a pivot regardless of the bind (the offline ~31 class), and the
   extract is what makes that knowable.
4. **`decideGoal` gains the verdict in its signature.** `decideGoal(s, ex,
   visitCtx, text)` cannot see routing today; after the reorder there is a
   complete `uₜ` to pass.

### Gate

Behavioural, per §0 rule 1. **Grade the fact in the reply, never "stayed on
focus."** Offline ~31/~33 is a sizing hint only — live gate uses catalog truth.

**Pivot class (must broaden / re-search, not pin):** focused buyer states a new
budget, BHK, and/or locality. Minimum live probes (Eldorado focused first):

| utterance | reply must |
|---|---|
| `actually my budget is only 50L` | surface budget-fit inventory (Cornerstone from ₹45L qualifies; must not answer as Eldorado-only pricing that ignores the new cap) |
| `2 BHK in Jayanagar` | not invent Jayanagar stock; not dump Eldorado 2BHK as if that were the ask |
| `show me other projects in Whitefield` | leave Eldorado focus; shortlist other Whitefield options |

**Answer class (must keep focus and answer the facet):**

| utterance | reply must |
|---|---|
| `when is possession` | Eldorado possession/delivery fact (same run as below) |
| `what is the possession date` | same |
| `has this area appreciated` | investment/return answer on focused project / its locality — not a fresh shortlist that replaces subject |

Also:

- `when is possession` and `what is the possession date` both 6/6 in the same pinned run.
- 90-scenario suite: no new failures — **necessary, not sufficient.** Clean suite
  on #159 coexisted with broken pivots; suite alone never gates subject resolution.
- Every live run pinned (`scripts/pinned-run.sh`).
- Re-score the full 64 veto-class texts live with the **truth** grader before
  flipping `ROUTING_IN_GOAL` on. Do not ship on a focus-stay grader.

### Dependency

Nothing depends on it that is not already blocked. **Phases 2, 3, 4b and 5 all
sharpen `uₜ`, and none of them can change behaviour until `uₜ` arrives before
`bₜ`.** Sequence **0e → 0d** before all of them. Phase 1 (entity store) is
orthogonal and can proceed either side. Dig keeps `ROUTING_IN_GOAL=false` until
0d's gate passes.

### Risk

Reordering touches every turn — the largest blast radius in this document.
Mitigations: build behind a flag; keep the old order reachable for one release;
gate on the truth probes above rather than on the scenario suite; and land it as
its own PR with nothing else in it.

**The specific trap:** a reorder that "works" on a handful of probes is exactly
what #159 was. Do not accept fewer than the full 64-text audit re-run live with
catalog-truth grading.

---

## 3c. Phase 0e — how wrong is the verdict? (prerequisite of 0d's gate)

Phase 0d makes the verdict load-bearing. Before it does, its error rate has to
be a number rather than an impression.

`"70L"` → `get_brochure` @ 0.870 and `"summarize everything we discussed"` →
`ask_delivery_timeline` are both ≥ tau_high and both wrong. Unknown today: how
common that is.

**Method:** sample N ≥ 200 of the ≥ tau_high binds from `intent_review_queue`
(or an export of the same shape), hand-label them against the boundary rulebook,
report precision per intent kind. Cheap, offline, no deploy.

**Label rule (one row = one bind):**

| label | when |
|---|---|
| `correct` | bound kind is what a sales-aware reader would route the utterance to |
| `wrong` | bound kind is not that route (even if confidence is high) |
| `ambiguous` | two answerable kinds both fit; do not force a winner |

**Output (blocks 0d start):**

1. Per-kind precision table for answer-intent kinds at current `tau_high`
2. Recommended `tau_high` from holdout (or explicit "keep inherited" with numbers)
3. Decision line: if answer-intent precision is below ~90%, 0d treats the verdict
   as a **tiebreaker** (regex + extract still vote); if at or above ~90%, verdict
   may sit as an equal input as designed in §3b

### Result (2026-07-27)

Filed at [`docs/reports/phase-0e-verdict-precision.md`](../reports/phase-0e-verdict-precision.md)
(+ `phase-0e-labels.json`). Dig D1 sample, N=203 distinct answer-intent binds @
`tau_high=0.78`, hand-labelled from buyer text alone.

- Overall precision **0.712** (121 correct / 49 wrong; 33 ambiguous)
- Decision: verdict is a **tiebreaker** for 0d — not an equal input
- Keep `tau_high=0.78`; worst wrongs already sit at 0.85–0.91
- Dig keeps `ROUTING_IN_GOAL=false`; do not revive the #159 “verdict vetoes regex”
  shape

0d implementation may open only as **extract-before-mutation + tiebreaker
verdict**, not as equal-weight wire.

---

## 4. Phase 1 — one entity store

### Problem
Discourse entities live in `discover.lastOffered`, `discover.discussedProjects`, `focus`, `projectCache`, `visit.queued`. Four distinct pool orderings across 21 resolvers, catalogued in the map. `compare_resolve.projectPool` is `discussed → focus → lastOffered` and the catalog appears in none — that is J7.

### Design

Replace the scattered arrays with one store. Sketch, not final:

`ConversationState` is persisted as JSON — `store-kv.ts:28` is `JSON.stringify(state)`. `Map`, `Set` and methods do **not** survive that:

```
JSON round-trip of { entities: Map, roles: Set }  →  {"entities":{},"roles":{}}
```

A `Map`-shaped store would silently empty itself on every save, and it would typecheck. So the durable shape is plain JSON and salience is a **pure helper**, never a method on state:

```ts
type EntityRole = 'offered' | 'discussed' | 'focused' | 'rejected' | 'queued';

interface DiscourseEntityRecord {
  projectId: string;
  name: string;                 // never the slug — ProjectDetail.name's invariant
  roles: EntityRole[];          // array, not Set
  firstSeenTurn: number;
  lastTouchedTurn: number;
  microMarket?: string;
}

// on ConversationState (durable, JSON-safe):
//   entities: Record<string, DiscourseEntityRecord>;
//   focusStack: string[];       // most recent first; depth > 1
//
// pure helper, not a method:
function salience(state: ConversationState): DiscourseEntityRecord[];
```

A turn may build a `Map` in memory for convenience — never as the stored field. Same pattern `disclosedFacts` already uses.

**Salience order** (one definition, written once): current focus → focus stack depth → recency of touch → offered-this-turn → catalog. Rejected entities are ranked last, never removed — a rejection is information.

Resolvers become **views over `salience()`**, not private pool constructions. `resolveCompareProjectIds`, `resolveNamed`, `matchOfferedName`, `deferToProjectAnswer`, `candidatesOf`, `projectPool` all collapse into calls against one ordering.

The catalog joins the pool used for **matching**. The **fallback** pool stays conversation-scoped — compare-what's-on-screen must never become compare-anything-in-the-catalog.

### Staging — dual-write, migrate, delete

A big-bang swap of five state fields read by 21 resolvers is not reviewable. Three steps:

| step | what |
|---|---|
| **1a** | write the new store **alongside** the old fields; nothing reads it yet |
| **1b** | migrate consumers by family (compare → named-resolve → visit → chips), asserting `salience(state)` matches the old pool projection at each step |
| **1c** | delete the old fields once no reader remains |

### Ship the honesty fix ahead of the store

`Extracted` gains a channel for **name-shaped tokens that resolved to nothing**, so *"the buyer named nothing"* and *"the buyer named something I could not bind"* stop being the same value. This is a one-field change and it makes J7 **honest** (clarify rather than guess) without waiting for the refactor. Ship it first; the store then makes J7 **correct** (compares the two projects actually named).

### Gate — buyer-visible, despite being a refactor
- J7 compares Eldorado + Sanctuary (unbound-name / PR-2-lite — landed)
- `NAME-06` goes green — `"what about cornerstone utopia"` switches to the sibling (`test:name-06` — **landed** for named-resolve/switch family; broader salience migration still open)
- `"the other one"` resolves (needs focus-stack consumers — still open)
- Resolver count drops measurably (full 1b/1c)
- **Zero scenario regressions**, proven the way #150 was: deploy `main` to the same worker, run all 89, diff at turn level

### Size
Largest phase. Pure refactor — no new capability, high blast radius, fully covered by 937 unit tests + 89 scenarios.

---

## 5. Phase 2 — close the loop

### Problem
`buildTurnRoutingInput` already carries `phase`, `focus`, `visit`, `named_project_ids`, `ask_topics`. State is **in the call** and is used only to *gate* whether the embedder runs and to arbitrate *after* the bind. The embedding query is over buyer text alone.

We are fitting `text → intent` when the function is `(state, text) → intent`. No corpus size fixes a missing input dimension.

### Design
- **State tokens in the canonical embed.** `SIL_CANONICAL_EMBED` already masks entities (`"1bhk chahiye <place> ke paas"`). Extend the same mechanism with a state prefix: `<focused>`, `<board:3>`, `<visit_pending>`, `<cold>`. Query and corpus must be masked in lockstep — which is exactly what that flag was built to guarantee.
- **Corpus rows gain a state field** — `(state, phrasing) → intent_kind`. Only for intents whose meaning is state-dependent: `ask_next_step`, `confirm_action`, deixis (`this one`, `both`, `the second`). Irrelevant for `get_price`. A targeted multiplier, not a blanket one.
- **Reference resolution against the focus stack**, not the embedding. `"this"` resolves by *pointing at* an entity, the copy-mechanism idea from TRADE / TripPy — not by classifying it. The vector space is a metric; it cannot carry reference.

### Gate
`ask_next_step` wired as a **state-conditioned** consumer and correct across four states: after shortlist (compare or open one), after focus (visit or price), after visit (booking), cold (probe). This is the proof case — if it works on 35 rows and four states, the design is right and everything else is execution.

### Dependency
Requires Phase 1. You cannot condition on a state with no canonical form.

---

## 6. Phase 3 — multi-label producer

### Problem
`classifyTurnRouting` emits one `top_kind`. `Extracted.askTopics` is already `AnswerTopic[]` and AB-8 multi-topic compose already ships. **The consumer is multi-intent; the producer is not.**

Nearest-neighbour retrieval has no `and` operator: the embedding of *"price and RERA and visit Saturday"* lands between three clusters and is often closest to none.

### Design — the set needs a landing type

`TurnRoutingResult` has singular `answer_topic?: AnswerTopic` (`turn-routing/types.ts`). Without specifying where the set lands, an implementer can add multi-match scoring, ship the telemetry, and still drop the second facet. The contract:

1. router emits `answer_topics: AnswerTopic[]`; keep `answer_topic = answer_topics[0]` for compatibility
2. intent authority merges it into `Extracted.askTopics` — which compose and `fetchAnswer` already consume
3. the gate asserts **both facets answered**, not that `top_kind` changed

- Take every match above τ with adequate margin, not `[0]`.
- **τ must be recalibrated.** Multi-label changes the threshold regime — a threshold tuned for argmax is wrong for independent firing. Re-score the frozen 1,894-row holdout; do not assume.
- Cap the set (2–3) and order by score, so compose's existing top-2 policy still applies.
- Hard negatives ride the gate: `find_projects` and `get_price` must not degrade. A lift that breaks the transactional core is a regression wearing a win's clothes.

### Consumer compose contract (ships with Phase 0b — independent of producer)

AB-8 **fetch** (multiple topics → evidence atoms) is necessary but **not sufficient**. Stitching atom templates that each re-stamp the project name produces awkward multi-intent copy:

> Pricing — Eldorado: 2BHK …  
> Eldorado is in …

**Locked join policy** for `topics.length > 1` under focused evidence (`compose.ts`):

1. Resolve **one** display subject (`focusProjectName` / detail / pricing name).
2. Emit a **lead** once: `On *{Subject}*:`.
3. Emit **facet atoms** that do **not** re-prefix the project name (price components, location micro-market, media title+URL, FAQ body, legal snapshot body).
4. Join facets under the lead (`; ` or short lines); single park/CTA at the end.
5. **Single-topic path unchanged** — no thinning of “just price” / “just location”.

Proof cases: `0B-13` (price + location), `0B-14` (brochure + starting price), plus Wave-3 multi-atom holds (`0B-07`, `0B-08`). Scenario suite: `npm run test:phase-0b`.

### Gate
*"price and is it RERA approved"* answers both facets. Holdout re-scored at the new τ with no per-intent regression. Articulated multi-intent consumer gate (0b) does **not** wait on the producer.

### Independence, honestly
The **scoring** change is independent of Phase 1 — it touches the router, not the state. The **product** gate is not: answering two facets still needs a subject, and on a shortlist that subject comes from the entity store. Phase 3 can be built in parallel; its multi-topic gate may need Phase 1 to pass. The **compose join policy** above can (and does) ship with 0b without waiting on the multi-label router.

---

## 7. Phase 4 — confidence on slots

### Problem
Slots are point values. `constraints.location = 'rush'` carries no confidence, so the geography authority has only two moves: keep it or hard-drop it. That binary is why `place-frame.ts` — one regex matching the word "in" anywhere — decides between *silently discarding a real place* and *telling the buyer their sentence fragment is not a place*:

> *"I don't have apartments in **rush**"* — and the actual brief (2 BHK, under 80L) is never searched.

### Split into 4a and 4b

**4a — the geography gate (small, ships alone).** `looksLikePlaceFramedAsk` is replaced by the **`resolveLocation`** tri-state, not `resolveGeo`:

| `resolveLocation` | buyer-facing move |
|---|---|
| `resolved` + unserved | outside-served copy — *"I don't have anything in Gurgaon; I have…"* |
| `unresolved` | drop the fragment, continue the brief — the `"rush"` case |
| `unavailable` | **fail open** — never claim "not a place" |

An earlier draft of this LLD named `resolveGeo`. That was wrong: its contract is `Promise<{lat,lng} | null>`, and `null` cannot separate *not a place* from *geocoder down*, so a transport outage would silently discard a real locality. `resolveLocation` exists with exactly this tri-state (`ports.ts:179`) and `geography-authority.ts` already documents the principle — *"a transport outage is not evidence that the buyer named a bad place."* Reserve `resolveGeo` for distance and ranking.

**4b — confidence on slots.** Extracted values carry `{ value, confidence, source }`. `constraintAuthority` already proves the pattern for provenance; this extends it to certainty, and gives the gate a fourth move: **hold provisionally and ask** — *"did you mean an area, or shall I use your budget and BHK?"*

### Blocker (4a)
Confirm on `nayadesk-dev` how `resolveLocation` statuses distribute over real-but-unserved Indian cities. Note `fakes.ts:396` returns `null` from `resolveGeo` for Gurgaon — a fixture asserting something untrue of the real geocoder, which must be corrected either way.

### Gate
The four-input table in map §13.1, asserting on **reply text**, not just durable state.

---

## 8. Phase 5 — structured extract for the hard minority

### Design
BAML out of shadow (`turn.ts:201` already requires `promote`), routed to the ~10–20% of turns that are genuinely compositional or anaphoric. It receives the canonical state (exists after Phase 1) and returns a **set of acts with references resolved**.

This is the two-stage retrieval pattern: bi-encoder for recall on the 80%, a cross-encoder-shaped stage for precision on the tail. Deterministic spine, LLM only where composition is actually required.

### Gate
Honesty suite green (no over-answer, no invented facts, correct decline on `faqMiss`). Latency budget held on the 80% that never reach it.

---

## 9. Then the corpus at volume

Deliberately last. Rows generated before Phases 2 and 3 lack the state dimension and multi-label labelling, so they would be regenerated. After, the schema is stable and volume is execution.

**Sizing note.** Lakhs of vectors across 43 intents is the wrong shape — it over-fits phrasing variety for intents that already bind. The catalog carries **64 approved FAQ keys** on `naya-advisor` alone, each a question a human decided buyers ask *and wrote an answer for*. The right target is `(intent_kind, facet)` pairs derived from those keys — roughly 10k vectors that each land on a real answer, rather than a lakh that mostly land on `get_price`.

Pre-traffic sources, in order of value: the FAQ keys themselves (self-consuming, human-curated), the builders' sales teams (top 200 questions, an afternoon's work), personas at scale (`src/eval/persona-library.ts`), and the existing conversation dumps.

---

## 10. Sequencing

```
0a ──► unbound-name typing ──► 1a dual-write ──► 1b consumers ──► 1c delete
 │      (J7 honest)
 ├──► 4a  resolveLocation gate
 │
 └──► 0e verdict precision ──► 0d understanding-before-mutation ──┬──► 2
      (measure, offline)       (reorder; EVERYTHING below needs it) ├──► 3
                                                                    ├──► 4b
                                                                    └──► 5
```

**0d is the gate on the whole right-hand side.** 2, 3, 4b and 5 all sharpen
`uₜ`, and none of them can change buyer behaviour until `uₜ` arrives before
`bₜ` (§3b). Phase 1 is orthogonal and runs either side. This supersedes the
earlier reading that 3 could ship in parallel with 1 and land a product gain —
it can be *built* in parallel; it cannot *measure* until 0d.

Prod infra cutover (Desk D1, service bindings, Advisor URL matrix, SQL seed hygiene) is a **separate track**. 0a helps ops; do not start 1a big-bang during prod provisioning.

| phase | depends on | buyer-visible | size |
|---|---|---|---|
| 0a ledger truth | — | no | S |
| **0e verdict precision** | — | no | S — offline, no deploy |
| **0d understanding before mutation** | 0e | **yes** (the phrasing cliff) | **L — reorders every turn** |
| 0b/0c port results | 0a | no | M |
| unbound-name typing | — | **yes** (J7 honest + correct named compare) | S — **landed** (`UN-01`…`UN-05`) |
| 1 entity store (a/b/c) | 0a to measure | **yes** (J7 correct, NAME-06) | L |
| 2 state → understanding | 1 | **yes** | M |
| 3 multi-label | — (gate may need 1) | **yes** | M |
| 4a geography gate | — | **yes** | S |
| 4b slot confidence | 1 | **yes** | M |
| 5 LLM extract branch | 1 | **yes** | M |

Phase 3 can run in parallel with 1 — it touches the router, not the state.

---

## 11. Risks

| risk | mitigation |
|---|---|
| Phase 1 is a large refactor with wide blast radius | 937 unit tests + 89 scenarios + main-baseline turn diff; ship behind no flag but merge only on a clean diff |
| τ recalibration regresses currently-correct intents | frozen holdout re-scored per intent; hard negatives in the behavioural gate |
| Phase 5 reintroduces hallucination | it returns *acts*, never facts; `fetchEvidence` remains the only fact source |
| Phase 0a and 4a get deprioritised for lacking a visible win | stated here as the primary risk; they are the reason 2/3/5 are measurable at all |
| A `Map`/`Set` sneaks back into durable state | it typechecks and silently empties on save — `store-kv.ts:28` is `JSON.stringify`. Durable state stays plain JSON; a lint or a round-trip assertion is cheap insurance |
| Phase 1 dual-write drifts from the old projection | 1b asserts `salience(state)` equals the old pool projection per consumer family before deleting anything |
| We measure routing accuracy and call it quality | gates are behavioural. Three times this session a probe predicate was too loose to grade its own answer — assert the **fact the reply must carry**, not a word it might contain |

---

## 12. Open questions

1. How do `resolveLocation` statuses distribute over real-but-unserved Indian cities on `nayadesk-dev`? Blocks Phase 4a. (`fakes.ts:396` is wrong about Gurgaon either way.)
2. Does `compare_projects` route through `embedder-map.ts` or the speech-act lane? Decides whether its 46 taught rows have a consumer.
3. Focus stack depth — is 3 enough, or does the visit itinerary need more?
4. Should `rejectedProjectIds` expire? Currently `state.ts` has `recordDiscussed` and no removal; the pool only grows (cap 6).
5. **Consumer map.** Which `intent_kind`s bind but have no consumer? `ask_next_step` is confirmed; `compare_projects` is unknown. Every unmapped kind is corpus work that cannot pay off — audit before Phase 2, not after.
6. **Dual-write invariant.** What exactly asserts `salience(state)` equals the old projection during 1a/1b — a shadow comparison logged per turn, or a test-only assertion?

---

## 12b. Out of scope — Lane B, deliberately not absorbed

These are genuine quality failures and they are **not** owned by dialogue-state normal form. Tracked separately so this document does not become the dump for every journey failure:

| failure | actual owner |
|---|---|
| soft openers (*"first home"*, *"most home for money"*) → clarify | teach lane, then Phase 2/5 consumers |
| legal stuck (RERA/OC → khata repeat) | facet / evidence routing (S3) |
| raw slug in orient copy | display invariant, #149-class |
| sticky shortlist when a facet was asked | goal / evidence selection, not salience |
| emotional-distress and jailbreak scenario bars | not conversation-quality gates at all |

An earlier draft claimed Lane B "mostly resolves inside Phases 1–3." It does not, and claiming so would quietly widen this LLD until nothing in it ships.

---

## 13. Verification, every phase

1. Defect probe committed and **shown failing on `main`** before any source edit.
2. `tsc --noEmit` + full `npm test`.
3. Dev deploy; all 89 scenarios; `main` deployed to the same worker for a turn-level baseline diff.
4. HTML report with the conversations, per the standing rule that a test result is the transcript, not the tally.
5. Independent PRs off fresh `main`, held for founder merge. No stacking.

---

## 14. Review amendments (append-only — 2026-07-26)

> **Status: FOLDED into §§0–13 on 2026-07-26. This appendix is now history, not
> the authority — read the body.** Both P1s were reproduced before folding:
> a `Map`/`Set` round-trips to `{}` through `store-kv.ts:28`'s `JSON.stringify`,
> and `resolveGeo`'s `{lat,lng} | null` cannot separate "not a place" from
> "geocoder down" while `resolveLocation` (`ports.ts:179`) is tri-state.
> Kept verbatim below so the reasoning survives.

### 14.1 Phase 1 durable shape — no `Map` / `Set` / methods on persisted state

**Finding (P1):** The §4 sketch uses `Map<string, DiscourseEntity>`,
`Set<EntityRole>`, and `salience()` as a method on state. `ConversationState`
(`src/engine/types.ts`) is JSON-shaped durable KV/ledger state today. Literal
`Map`/`Set`/methods will not survive persistence cleanly.

**Recommendation — serialized shape + pure helper:**

```ts
type EntityRole = 'offered' | 'discussed' | 'focused' | 'rejected' | 'queued';

interface DiscourseEntityRecord {
  projectId: string;
  name: string; // never the slug — ProjectDetail.name invariant
  roles: EntityRole[]; // array, not Set
  firstSeenTurn: number;
  lastTouchedTurn: number;
  microMarket?: string;
}

// On ConversationState (durable):
//   entities: Record<string, DiscourseEntityRecord>;
//   focusStack: string[];  // most recent first

/** Pure helper — not a method on persisted state. */
function salience(state: ConversationState): DiscourseEntityRecord[];
```

Runtime may build a `Map` inside a turn for convenience; **never** as the stored
field. Same pattern as `disclosedFacts` helpers.

**Also recommended when folding §4:** stage Phase 1 (dual-write → migrate
consumers by family → delete old pools). Pull a thin “unbound name-shaped token”
typing fix (SUBJECT plan PR-2(i)) ahead of the full store so J7 honesty does not
wait on the rewrite. Gates that make J7 / NAME-06 green are buyer-visible — do
not label Phase 1 as “no buyer-visible win.”

### 14.2 Phase 4 geography authority — `resolveLocation`, not `resolveGeo`

**Finding (P1):** §7 says `resolveGeo(asked)` decides “real place” vs “not a
place.” The port already has `resolveLocation()` with a tri-state contract
(`resolved` | `unresolved` | `unavailable`) — see `ports.ts` and
`geography-authority.ts`. `resolveGeo()` returns `null`, which cannot distinguish
“not a place” from “geocoder unavailable.”

**Recommendation:**

| `resolveLocation` status | buyer-facing move |
|---|---|
| `resolved` + unserved | outside-served copy |
| `unresolved` | drop fragment / continue brief (e.g. “rush”) |
| `unavailable` | fail-open — do **not** claim “not a place” |

- Use **`resolveLocation` as the geography-gate authority.**
- Reserve **`resolveGeo` for distance / ranking** only.
- Split Phase 4 when folding: **4a** = geocode/location gate (small); **4b** =
  `{ value, confidence, source }` on slots + provisional ask.
- Rephrase open question §12.1 against `resolveLocation` statuses on
  `nayadesk-dev`, not `resolveGeo(Gurgaon)` alone.

### 14.3 Phase 3 multi-label — define where the set lands

**Finding (P2):** §6 says emit `askTopics[]`, but `TurnRoutingResult` today only
has singular `answer_topic?: AnswerTopic` (`turn-routing/types.ts`).
`TurnRoutingInput` already carries `ask_topics?: AnswerTopic[]`. Without a landing
type, implementers may add scoring telemetry and still drop the second facet.

**Recommendation — specify the contract when folding §6:**

1. Router emits `answer_topics: AnswerTopic[]` (keep `answer_topic` = `[0]` for
   compat).
2. Intent authority merges into `Extracted.askTopics` (compose / `fetchAnswer`
   already consume the set).
3. Behavioural gate asserts both facets answered, not only `top_kind`.

“Router only / independent of state” remains true for scoring code, but the
**product** gate still needs a subject for compose — do not claim quality
independence from Phase 1 for multi-topic answers.

### 14.4 Phase 0 sizing — scope the port migration

**Finding (P2):** §3 proposes `EngineData` methods return discriminated results
instead of `T | null`. Many methods use nullable contracts today (`projectDetail`,
`pricing`, `compare`, `mediaShare`, `conversationContext`, `builder`, …). Right
direction; “small, one day” only holds if scoped.

**Recommendation — tier Phase 0 when folding §3:**

| Tier | Scope | Size |
|---|---|---|
| **0a** | Ledger `tool_runs[].success`, `postChoiceEvent` `engine_status`, drop `projects_compared` floor, promote `turn-log-snapshot` fields into deployed ledger | S — landed |
| **0b** | `DataResult<T>` wrappers for `pricing`, `landedCost`, `priceBasis`, `faqLookup`, `projectDetail` + multi-intent compose join policy + `test:phase-0b` gate (`0B-01`…`0B-14`) | M — **landed** |
| **unbound-name** | `Extracted.unboundProjectNames` + catalog in compare matching + block pool-guess; gates `test:unbound-name` / `:report` / `:live` (`UN-00` defect probe + `UN-01`…`UN-05`) | S — **landed** (PR-2-lite) |
| **1b (named-resolve / switch)** | Full sibling overshadows partial; refinement switch over compare; gate `test:name-06` (NAME-06 green). Broader salience consumer migration still open. | S — **partial landed** |
| **0c** | Remainder of `EngineData` | separate PR |

Gate for closing Phase 0 remains: forced adapter failure → `success: false` with
`failure_reason: 'transport' | 'absent'`. Do not require 0c to merge 0a/0b.

### 14.5 Out of scope for this LLD (Lane B — do not absorb)

These genuine quality failures are **not** owned by dialogue-state normal form.
Track separately so this doc does not become the dump for every journey fail:

- Soft openers (“first home”, “most home for money”) → teach / Phase 2+5 consumers
- Legal stuck (RERA/OC → khata repeat) → facet / evidence routing
- Raw slug copy in orient → display invariant (#149-class)
- Sticky shortlist when a facet was asked → goal / evidence, not salience alone
- Emotional-distress / jailbreak scenario bars → not conversation-quality gates

### 14.6 Sequencing delta (recommended vs §10)

```
0a ──► unbound-name typing (PR-2-lite) ──► 1 staged (dual-write → consumers → delete)
 │                                              ├──► 2
 │                                              ├──► 4b
 └──► 4a (resolveLocation gate)                 3 parallel (with landing type)
                                                5 after 1
```

Prod infra cutover (Desk D1, service bindings, Advisor URL matrix, SQL seed
hygiene) is a **separate track**. Phase 0a helps ops; do not start Phase 1
big-bang during prod provisioning.

### 14.7 Open questions — add / rephrase

Carry forward §12; when folding, add:

5. Consumer map: does `compare_projects` (and `ask_next_step`) have a live
   consumer today, or only taught rows with no bind path? Blocks wasted corpus
   work in Phase 2.
6. Dual-write invariant for Phase 1a/1b: how is `salience(state)` asserted equal
   to the old pool projection until 1c deletes the old fields?
