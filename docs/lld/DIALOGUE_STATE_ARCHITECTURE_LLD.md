# Dialogue state architecture — LLD

**Audience:** implementer + reviewer
**Scope:** ConverseSpine `origin/main` @ `0243356` — the understanding/state/policy seam
**Status:** proposed, awaiting founder approval
**Supersedes:** the Lane A sequencing in [`SUBJECT_RESOLUTION_PLAN.md`](../SUBJECT_RESOLUTION_PLAN.md) (PR-2 and PR-4 are absorbed here; PR-1 has shipped as #150)
**Evidence base:** [`SUBJECT_RESOLUTION_MAP.md`](../SUBJECT_RESOLUTION_MAP.md) — every claim below was verified by executing the code, not by reading it

---

## 0. How to use this doc

1. **No phase ships without its gate.** Gates are behavioural (what the buyer gets), not structural (what the code looks like).
2. **Refactor phases (0, 1, 4) have no buyer-visible win.** They are the ones that get skipped and the ones that make the rest possible. Skipping them means shipping 2/3/5 half-working and patching forever — which is the history this document exists to end.
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

### Design
- `EngineData` methods return a discriminated result rather than `T | null`, so absence and failure are distinct at the port. Minimal shape: `{ ok: true, value } | { ok: false, reason: 'absent' | 'transport' }`.
- `ledger-write.ts` `tool_runs[].success` reflects the real outcome; `latency_ms` is real.
- `postChoiceEvent` `engine_status` reflects the turn.
- `journey-signals.ts` drops the `Math.max(…, 2)` floor on `projects_compared`.
- Promote the fields `observability/turn-log-snapshot.ts` already computes — `named_projects` as `id:name` pairs, `switch_intent`, full `extract_provenance` — from the wrangler-dev-only path into the deployed ledger row.

### Gate
A forced adapter failure appears as `success: false`. One ledger row answers *"what bound, what goal, what reply, and did the data exist."*

### Size
Small. One day. Everything after it is unreadable without it.

---

## 4. Phase 1 — one entity store

### Problem
Discourse entities live in `discover.lastOffered`, `discover.discussedProjects`, `focus`, `projectCache`, `visit.queued`. Four distinct pool orderings across 21 resolvers, catalogued in the map. `compare_resolve.projectPool` is `discussed → focus → lastOffered` and the catalog appears in none — that is J7.

### Design

Replace the scattered arrays with one store. Sketch, not final:

```ts
type EntityRole = 'offered' | 'discussed' | 'focused' | 'rejected' | 'queued';

interface DiscourseEntity {
  projectId: string;
  name: string;              // never the slug — ProjectDetail.name's invariant
  roles: Set<EntityRole>;
  firstSeenTurn: number;
  lastTouchedTurn: number;
  microMarket?: string;
}

interface DiscourseState {
  entities: Map<string, DiscourseEntity>;
  /** Most recent first. Depth > 1, so "the other one" and "go back" resolve. */
  focusStack: string[];
  /** Single ordering every resolver reads. */
  salience(): DiscourseEntity[];
}
```

**Salience order** (one definition, written once): current focus → focus stack depth → recency of touch → offered-this-turn → catalog. Rejected entities are ranked last, never removed — a rejection is information.

Resolvers become **views over `salience()`**, not private pool constructions. `resolveCompareProjectIds`, `resolveNamed`, `matchOfferedName`, `deferToProjectAnswer`, `candidatesOf`, `projectPool` all collapse into calls against one ordering.

The catalog joins the pool used for **matching**. The **fallback** pool stays conversation-scoped — compare-what's-on-screen must never become compare-anything-in-the-catalog.

### What this subsumes
Most of the planned PR-2. A pool-disagreement bug cannot exist when there is one pool. What survives from PR-2 is the *typing* half — `Extracted` gains a channel for **name-shaped tokens that resolved to nothing**, so "the buyer named nothing" and "the buyer named something I could not bind" stop being the same value. That is a one-field change once the store exists.

### Gate
- J7 compares Eldorado + Sanctuary
- `NAME-06` (currently a standing red scenario) goes green — `"what about cornerstone utopia"` switches to the sibling
- `"the other one"` resolves
- Resolver count drops measurably
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

### Design
- Take every match above τ with adequate margin, not `[0]`. Emit as `askTopics[]`.
- **τ must be recalibrated.** Multi-label changes the threshold regime — a threshold tuned for argmax is wrong for independent firing. Re-score the frozen 1,894-row holdout; do not assume.
- Cap the set (2–3) and order by score, so compose's existing top-2 policy still applies.
- Hard negatives ride the gate: `find_projects` and `get_price` must not degrade. A lift that breaks the transactional core is a regression wearing a win's clothes.

### Gate
*"price and is it RERA approved"* answers both facets. Holdout re-scored at the new τ with no per-intent regression.

---

## 7. Phase 4 — confidence on slots

### Problem
Slots are point values. `constraints.location = 'rush'` carries no confidence, so the geography authority has only two moves: keep it or hard-drop it. That binary is why `place-frame.ts` — one regex matching the word "in" anywhere — decides between *silently discarding a real place* and *telling the buyer their sentence fragment is not a place*:

> *"I don't have apartments in **rush**"* — and the actual brief (2 BHK, under 80L) is never searched.

### Design
- Extracted values carry `{ value, confidence, source }`. `constraintAuthority` already proves the pattern works for provenance; this extends it to certainty.
- The geography gate gets a third outcome: **hold provisionally and ask** — *"did you mean an area, or shall I use your budget and BHK?"*
- `looksLikePlaceFramedAsk` is replaced by the signal already fetched three lines below it: `deps.data.resolveGeo(asked)`. Geocodes → a real place we do not serve. Does not geocode → not a place → drop and continue.

### Blocker
Confirm against `nayadesk-dev` that `resolveGeo` resolves real-but-unserved Indian cities. `fakes.ts:396` returns `null` for Gurgaon, which is untrue of the real geocoder — a fixture asserting something false about a dependency. If the real one also misses, this design is wrong and needs a different signal.

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
0 ──► 1 ──► 2
      └───► 4        3 independent      5 after 1
```

| phase | depends on | buyer-visible | size |
|---|---|---|---|
| 0 ledger truth | — | no | S |
| 1 entity store | 0 (to measure) | no | L |
| 2 state → understanding | 1 | **yes** | M |
| 3 multi-label | — | **yes** | M |
| 4 slot confidence | 1 | **yes** | M |
| 5 LLM extract branch | 1 | **yes** | M |

Phase 3 can run in parallel with 1 — it touches the router, not the state.

---

## 11. Risks

| risk | mitigation |
|---|---|
| Phase 1 is a large refactor with wide blast radius | 937 unit tests + 89 scenarios + main-baseline turn diff; ship behind no flag but merge only on a clean diff |
| τ recalibration regresses currently-correct intents | frozen holdout re-scored per intent; hard negatives in the behavioural gate |
| Phase 5 reintroduces hallucination | it returns *acts*, never facts; `fetchEvidence` remains the only fact source |
| Phases 0/1/4 get deprioritised for lacking a visible win | stated here as the primary risk; they are the reason 2/3/5 work at all |
| We measure routing accuracy and call it quality | gates are behavioural. Three times this session a probe predicate was too loose to grade its own answer — assert the **fact the reply must carry**, not a word it might contain |

---

## 12. Open questions

1. Does `resolveGeo` on `nayadesk-dev` cover real-but-unserved Indian cities? Blocks Phase 4.
2. Does `compare_projects` route through `embedder-map.ts` or the speech-act lane? Decides whether its 46 taught rows have a consumer.
3. Focus stack depth — is 3 enough, or does the visit itinerary need more?
4. Should `rejectedProjectIds` expire? Currently `state.ts` has `recordDiscussed` and no removal; the pool only grows (cap 6).

---

## 13. Verification, every phase

1. Defect probe committed and **shown failing on `main`** before any source edit.
2. `tsc --noEmit` + full `npm test`.
3. Dev deploy; all 89 scenarios; `main` deployed to the same worker for a turn-level baseline diff.
4. HTML report with the conversations, per the standing rule that a test result is the transcript, not the tally.
5. Independent PRs off fresh `main`, held for founder merge. No stacking.
