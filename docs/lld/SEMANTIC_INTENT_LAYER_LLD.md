# SEMANTIC_INTENT_LAYER_LLD — embeddings as the first-class understanding layer

**Status:** SIGNED 2026-07-15 (founder + external review) — P0–P1 go; P2 gated on §3.2 arbitration table + §6 held-out eval (both now written)
**Date:** 2026-07-15
**Scope:** ConverseSpine turn understanding (routing + fact-key binding) and Vectorize corpus operations. NayaDesk participates only as the fact source (FAQ rows, cost sheets, facets). Dialogue policy unchanged.
**Supersedes:** the SA-4/P5 "embedder only when act=unknown + defer" gating in `turn-routing/classify.ts`; amends the earlier answerability-kernel refusal of a semantic retrieval layer (the refusal of an LLM-answers-from-RAG kernel STANDS — see §2 P4).

---

## 1. Problem — measured, not felt

All numbers verified on dev, 2026-07-15:

| Finding | Evidence |
|---|---|
| The 13,555-phrasing intent corpus has NEVER served a query | `naya-intent-phrasings-dev` (13,555 vectors, last mutation 2026-06-20) is bound to **nothing**. `wrangler.toml:79` binds dev `INTENT_VECTORS` to `naya-intent-phrasings` — **0 vectors**. |
| Prod is structurally blind | `naya-intent-phrasings` (prod binding): 0 vectors. `naya-project-names` (prod binding): 0 vectors. Any prod cutover today ships with no name resolution and no intents. |
| Even when alive, the embedder was gated to a sliver of turns | `classifyTurnRouting` fires the embedder only after FOUR upstream layers decline: visit follow-up rule → speech-act projection → rule ladder → `speech_act === 'unknown'`. |
| Regex is carrying 100% of understanding, and it leaks | 21.5% FAQ key-miss rate (17/79 FAQ-shaped asks in the 192-Q harness); misroutes like "can I get a **loan** on a plot?" → RERA answer (`faq-keys.ts` pattern gap); every new phrasing is a code change. |
| No corpus lifecycle exists | No registry, no seeder, no rebuild script in git (checked: no seeding commit May 25–Jun 25). The corpus was seeded out-of-band and died silently for ~a month. No telemetry knows whether the semantic layer fired. |
| Every answerability number ever measured ran with the semantic layer dead | 53% baseline → 84.4% post-AB-8b: all regex-only. |

**Founder's contract (verbatim intent):** free-chat understanding must prefer embeddings; regex is never the last word on intent. When regex cannot bind, embeddings must bind correctly **≥80%** of the time; the LLM covers the rest. No layer may ever again silently stop the embeddings from firing.

## 2. Design principles

- **P1 — Embeddings-first for free text.** Regex remains only as a high-precision *structural* extractor (budgets, BHK counts, phone numbers, ordinals, bare affirms) and a fast path when it binds strongly. It never suppresses the semantic layer.
- **P2 — The semantic layer runs on every free-text turn.** Upstream layers may *arbitrate* against its output; they may not *prevent* its execution. (Deterministic sub-turns — bare "yes", ordinal picks, phone numbers — are exempt: there is nothing semantic to resolve.)
- **P3 — The 80% gate.** On the labeled eval set (§6), of turns where the regex ladder fails to bind an intent/fact-key, the embedding layer must bind correctly ≥80%. BAML LLM gap-fill covers the remainder. A confident miss degrades to an honest clarify — never a guess.
- **P4 — The truth boundary is unchanged.** Founder's words: *"the embeddings just tell what the user says, not what the bot has to say."* Embeddings and the LLM decide *what is being asked*. Only Desk rows decide *what is said*. Answers bound via embedding are still served **verbatim** from the Desk row (`faqLookup` by key). The grounding gate, the composer-directive strip, and the honest-miss paths are untouched. This is not a RAG kernel and not a second brain — it is an index over phrasings and keys.
- **P5 — No hardcoded domain knowledge.** The corpus contains *phrasings*, not place/project facts. Place knowledge stays in the Desk area registry; project identity stays in `PROJECT_VECTORS` (see `no-hardcoded-places` rule).
- **P6 — Nothing in Vectorize is hand-fed.** Every index is rebuilt from a git-reviewed registry (or derived from Desk rows). An empty or stale bound index fails CI and alerts at runtime — silent death becomes impossible.
- **P7 — Misses are fixed in the semantic lane (founder rule, 2026-07-15).** When a phrasing is misunderstood or an answer drops, the fix is a registry row (new phrasing or label correction), a τ adjustment, or a `fact_key` row derived from the Desk row it should have bound — **never a new or widened understanding regex**. The structural extractors (P1's list) are the only regex exemption. Enforcement is auditable: the fix PR must show the fixed phrasing re-binding with `bind_source = embed_intent | embed_fact`; a fix PR whose diff widens understanding regexes is review-blocked. Every fix routed through the corpus compounds; a regex fix doesn't — that asymmetry is the point of this layer.

## 3. Architecture

### 3.1 One semantic surface, two row kinds

Repurpose `naya-intent-phrasings-dev` (per founder: "re-purpose it to be used effectively") as the single semantic index, with `kind` metadata:

| Row kind | Content | Metadata | Source of truth |
|---|---|---|---|
| `intent` | buyer phrasing → intent | `{kind:'intent', intent_kind, builder_scope}` | `corpus/intent-registry.jsonl` (git) — recovered from the existing 13,555 rows, then enhanced |
| `fact_key` | a project's *own authored* FAQ question + aliases; cost-sheet component labels; facet canonical asks | `{kind:'fact_key', question_key \| component_id, project_id \| 'global', builder_scope}` | Desk rows — derived nightly/on-change; never hand-edited |

One index, metadata-filtered queries. The existing `builder_scope` filter pattern in `embedderRouting` is kept.

**`fact_key` cardinality & scoping (review amendment).** Fact rows are **canonical-global by default**: one row per phrasing variant of a canonical `question_key`/`component_id`, derived from the union of Desk FAQ questions deduped **by key** across the catalog (~40 served keys × a handful of phrasings, plus cost labels and facet asks → low hundreds of rows). They cannot swamp the 13.5k intent rows: the two kinds are queried under separate metadata filters, so they never compete in one topK. A per-`project_id` row is authored only where a project's own phrasing differs materially (a named amenity, a project-specific scheme). Every fact-lane query filters `project_id ∈ {focus_project, 'global'}` — cross-project FAQ bleed is structurally impossible, and an unfocused fact ask can bind only global keys.

### 3.2 The understanding ladder (per free-text turn)

```
1. STRUCTURAL regex extract        — constraints only (budget/BHK/phone/ordinal/affirm). Kept as-is.
2. SEMANTIC (always, in parallel with the regex topic pass):
     embed turn text ONCE (bge-base-en-v1.5, reused for project-name query too)
     → query kind=intent   (topK 5, builder-scoped then global)
     → query kind=fact_key (topK 5, scoped to focus project + global)
3. ARBITRATION:
     regex bound strongly & embedding agrees        → proceed (fast path)
     regex silent          & embed ≥ τ_bind         → EMBEDDING BINDS   ← the 80% lane
     regex weak            & embed ≥ τ_bind + margin → embedding wins the intent;
                                                       regex keeps its structural slots
     both silent / below τ                          → BAML LLM gap-fill (already per-turn)
     LLM also abstains                              → honest clarify (probe), never a guess
4. FACT LANE: a bound question_key → exact faqLookup → verbatim Desk answer.
   TOPIC LANE: intent_kind → topics via the corrected map (§3.4).
```

**Thresholds.** Two, not one: `τ_bind` (accept floor; start at the existing 0.78, tuned on the eval set) and `τ_margin` (top1−top2 gap; guards nearest-neighbor noise — the Century-Breeze lesson from AB-5). Both are constants in `embedder-map.ts`, tuned only via eval evidence.

**What is removed.** The `act && act !== 'unknown'` early-return and the defer-only gating in `classifyTurnRouting`. Speech-act projection and the rule ladder become arbitration inputs, not gatekeepers.

**Arbitration conflict table (review amendment — the AB protections, made explicit).** "Arbitrate, don't gate" must not re-open the focus-death / wrong-search / knowledge-dump classes that AB-4/AB-5/AB-2/AB-7 just closed. The winner per conflict:

| Conflict | Winner | The semantic lane may |
|---|---|---|
| Focused facet / media / LI ask (AB-4/AB-5 focus lock) | Focus holds | bind `fact_key`/topic **on the focused project only** — never emit `find_projects`/`recommend`, never move focus |
| Visit follow-up rule active | Visit machine | nothing — embed visit/search neighbors are discarded on these sub-turns |
| Visit-intent NN hit on an ordinary turn | speech-act / rule confirmation | a bare NN hit can **never** invent `visit_book`; it needs τ_bind + τ_margin **and** visit context (carries forward the Speech-Act contract — see supersession note) |
| Strong structural extract (budget / BHK / ordinal / affirm / phone) | Structural slots kept verbatim | add an intent/fact bind on top — additive only |
| Typed type-knowledge ask (AB-7 sink) | Knowledge sink | no `find_projects` from embed noise |
| Regex authoritative bind (list below) | Regex | ADD atoms per the §3.6 union — never remove or override one |
| Regex weak or silent | Embedding ≥ τ_bind | bind intent + fact keys — **the 80% lane** |

**When regex is the authority (defined, not fuzzy):** an exact FAQ-key hit **whose key the focused project actually serves** (verified Desk row), phone numbers, ordinal picks, bare affirm/negative, and budget/BHK slot extraction. Everything else regex produces is advisory input to arbitration, not a verdict.

**Supersession note.** `SPEECH_ACT_CONTRACT_LLD.md` scoped INTENT_VECTORS to "topic gap-fill only under act=`answer`/`search`". This LLD supersedes that **gating** role; that doc's "never invent `visit_book` from embed noise" rule is carried forward in the table above, strengthened with the margin requirement.

### 3.3 Provenance & telemetry (permanent)

Every turn stamps `bind_source ∈ {regex, embed_intent, embed_fact, llm, none}` + top score + margin into `extract_provenance.fields` (the one debug channel that survives the `/chat` route re-shape) and the turn ledger. Derived counters:

- embedding fire-rate (must be 100% of free-text turns — P2 is auditable),
- catch-rate on regex-miss turns (the 80% gate, continuously),
- per-`intent_kind` hit distribution (stale/dead kinds become visible).

The hit-rate question the founder asked ("how many times is it hitting embeddings/LLM") becomes a dashboard query, never again an archaeology dig.

### 3.4 Known map defects to fix with data (not silently)

`embedder-map.ts` `INTENT_TO_TOPIC` has at least one wrong row: `ask_investment_return → 'overview'` (ROI asks are a known miss family — they must route to the `rental_yield`/`roi` FAQ family). Phase 0 fixes rows *only* where the corpus audit (§4.2) or harness evidence proves the correction; every change lands with a test.

### 3.5 Chips — deterministic bind, corpus contributors (founder amendment)

Chips stay deterministic: a **tapped** chip carries its authored payload/key → direct bind (`bind_source=chip`), zero ambiguity, no query needed. Regex/structured handling of chip payloads is correct and kept (aligns with S2 chip→FAQ-key direct binding).

The embedder enters in two ways:

1. **Every authored chip text is auto-added to the corpus as a labeled `fact_key`/`intent` row** — chips are pre-labeled by their own key, so they are free, zero-review training rows. When a buyer *types* chip-like text instead of tapping ("send me the cost sheet" typed freely), the semantic lane catches it because the chip phrasing is already in the index.
2. A buyer who **edits or paraphrases** a chip produces free text → the normal semantic lane (§3.2). Telemetry distinguishes `chip` binds from `embed_*` binds, so chip-tap coverage vs free-text coverage is separately measurable.

### 3.6 Multi-intent — the semantic lane returns a SET, never just top-1 (founder amendment)

Single-best binding would regress the AB-8/AB-8b multi-atom wins ("price AND schools", "RERA AND loan"). Contract:

- The semantic lane accepts **every distinct key/intent ≥ `τ_bind`** from the topK results (per-key dedupe), **capped at 3 atoms**, score-ordered. `τ_margin` applies only to rejecting a *lone* ambiguous winner, never to trimming a genuine multi-ask.
- **Arbitration is a UNION:** embedding atoms are added to regex-bound topics; the semantic lane may **add** atoms but never remove a regex-bound one. The AB-8/AB-8b compose machinery (`goal.topics`, per-atom chunks, FAQ-additive rendering) is the consumer — it already exists and is tested.
- Answer policy stays S5: answer the top-2 atoms fully, park the rest with an explicit continuation — never silently drop.
- **Regression guard:** the I-family (multi-intent) rows are a permanent eval subset; a dropped atom counts as a MISS in the 80% metric. The frozen post-AB-8b baseline (`strict_baseline.json`, NayaDesk — strict PASS 162/192) is the floor no phase may dip under.
- **Division of labor stays sharp (review amendment):** the semantic lane decides *which atoms were asked*; the AB-8/AB-8b compose machinery decides *how they render*. This LLD adds **zero compose changes** — when two fact_keys both clear τ_bind, both bind and flow into the existing multi-atom path.

## 4. Corpus operations — recover, audit, enhance, rebuild

### 4.1 Recover the registry (the corpus becomes reviewable)

Dump all 13,555 rows (id, text, metadata) from `naya-intent-phrasings-dev` into `corpus/intent-registry.jsonl`, checked into git. From this commit forward, **the registry is the source and the index is a build artifact.**

### 4.2 Audit

- Distribution by `intent_kind`; verify against the 15 kinds the code maps; flag unmapped/dead kinds.
- Stratified hand-check with a **per-`intent_kind` floor** — min(20, kind size) rows per kind, not a flat global sample (a flat 200 can miss a dead kind entirely). Per-kind precision goes in the audit report; a kind below the precision floor is **killed or relabeled before Phase 2** — no unaudited kind ships into always-on arbitration.
- Verify `builder_scope` hygiene (no project/place facts smuggled into phrasings — P5).

### 4.3 Enhance from the last month of real interactions (founder ask)

Mine new phrasings from:
1. the 192-Q harness corpora — especially every SHALLOW / faqMiss / PARTIAL row: those are literally the regex-miss lane, pre-labeled by failure;
2. dev ledger buyer turns (July, real Advisor-door traffic);
3. the AB-wave bug phrasings ("loan on a plot", "green near the hills"-class probes).

Pipeline: LLM proposes labels → human review in the registry PR (labels are buyer-routing decisions — they get eyes) → dedupe at cosine ≥0.95 against existing rows → append to registry.

### 4.4 Rebuild pipeline + guards

`scripts/build-intent-index.ts`: registry (+ Desk-derived fact rows) → embed → upsert, targeting **both** `-dev` and prod indexes. Guards:

- CI lint: bound index `vectorCount` must equal registry count (catches the empty-index class at deploy time);
- runtime: if a semantic query path sees an empty index, log at error level (alert), never silently no-op;
- prod seeding becomes an explicit launch-checklist step (both prod indexes are empty today).

`fact_key` rows regenerate from Desk on FAQ/cost-sheet change (webhook or nightly cron) — derived cache, drift impossible by construction.

## 5. Rollout — four phases, each with a measured gate

| Phase | Work | Gate (go/no-go) |
|---|---|---|
| **0 — Revive** (day 1) | Fix `wrangler.toml:79` → `naya-intent-phrasings-dev`; deploy dev; ship `bind_source` telemetry; full 192-Q run, row-diff vs post-AB-8b baseline, **hand-read every changed row** | **Expect a real row-diff** — the flip alone activates today's gated call-sites (topic gap-fill on the `act=unknown` lane), so topic/FAQ-path rows CAN move even while fire-rate looks low under the gates. A zero diff is itself a finding to investigate (the gates may be suppressing everything), not a free pass. Gate: every changed row hand-read + classified improved/neutral/regressed; no regression class introduced; fire-rate & catch-rate reported for the first time. Phase 0 revives the layer — it does **not** mean "quality fixed" |
| **1 — Own** | Registry recovery (§4.1) + audit (§4.2) + rebuild script + CI lints (§4.4); evidence-backed map fixes (§3.4) | registry == index; audit report delivered; map fixes each carry a failing-then-passing test |
| **2 — Always-on** | Remove the act-gates; arbitration table + τ_margin; `fact_key` lane live | **≥80% embed catch on the regex-miss eval set**; zero POLLUTED regression; "loan on a plot"-class misroutes = 0 |
| **3 — Enhance** | Mine + label + dedupe last-month phrasings (§4.3); re-tune τ | 80% sustained on the refreshed eval set; corpus growth reviewed in PR |

Phases land as separate PRs off `main`; each gate's harness run is hand-read (strict grader alone has a proven false-credit record).

## 6. Eval set & the 80% metric — precise definition

**Two sets, or the 80% number is theater (review amendment).** Mining the harness's SHALLOW/faqMiss rows into the corpus (§4.3) and then scoring the same rows would be training on the test set. Split:

- **Tune set** — mined phrasings (§4.3): used for labeling, corpus growth, and τ tuning. Anything that enters the registry lives here.
- **Held-out gate set** — the 192-Q harness + fresh ledger turns **never used for mining or labeling**, refreshed monthly by promoting new never-mined traffic (§10). The moment a phrasing (or a near-dup at cosine ≥0.95) is mined into the registry, its matching gate rows are flagged `seen` and scored separately — **the 80% gate is computed on `unseen` rows only** (both numbers are reported).

Each row is labeled with its expected intent/fact-key. Regex-miss lane = the subset where step-1 regex binding fails or key-misses (currently ≥17 faqMiss + the SHALLOW misroutes).

**Metric:** `embed_catch = correct embedding binds / regex-miss lane size` on the **gate set**, per run, computed by the harness and stored alongside `strict.json`. Gate: ≥0.80 on unseen rows, hand-verified on the changed rows.

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Nearest-neighbor noise binds a wrong-but-close intent (Century-Breeze class) | `τ_margin` gap check; builder/project scoping; AB-5-style identity scrub stays |
| A 13.5k corpus of unknown quality goes live on the beta door | Phase 0 is flip + measure with hand-read diff, on dev only; keep-or-revert on evidence |
| Latency/cost | +1–2 Vectorize queries per turn (~ms); the embed call already exists for routing; BAML call already per-turn — net new cost negligible |
| Label drift as corpus grows | registry in git, PR review, dedupe threshold, per-kind hit telemetry exposes rot |
| Coarse intents can't reach 40+ fact keys | that is what the `fact_key` lane is for — fact asks bypass the intent map entirely |

## 8. Out of scope

- Wrong-place search results (Desk search-contract fix — chip filed, separate).
- Authoring missing Desk content rows (~13 honest-unknowns; human worklist, separate).
- Prod cutover (needs §4.4 seeding step in the launch checklist).
- Any change to compose truth gates, disclosure, or channel policy.

## 9. Acceptance (the founder's bar, verbatim → testable)

1. Embeddings fire on 100% of free-text turns — `bind_source` telemetry proves it continuously.
2. ≥80% correct semantic bind on the regex-miss lane, measured on the labeled eval set, hand-read. Multi-intent atoms count individually — a dropped atom is a miss.
3. No layer can suppress the semantic query; no index can be empty without CI failure + runtime alert.
4. Truth unchanged: zero new fabrications; grounding repair-rate not worse than baseline (36/192).
5. **Quality never drops:** every corpus/router PR runs the eval in CI and is blocked unless strict PASS ≥ the frozen baseline AND catch-rate ≥ the previous release. Regression is structurally unmergeable, not a matter of discipline. (Phase 0 measured a ±3–5 row composer-wording noise band in the strict grader — the gate therefore compares **row-level evidence diffs**, not raw counts; disputed rows are hand-read.)
6. **Uptick through the lane, not around it (P7):** each phase must show strict PASS above the frozen baseline with the improvement attributable to semantic binds (`bind_source` proves attribution), and no fix PR may route an understanding miss through new regex — structural extractors exempt.

## 10. The corpus flywheel — 6 months to production strength (founder direction)

The corpus + eval pair is treated as a **durable asset**, not a one-time fix. Once on production, real traffic continuously strengthens it:

| Cadence | Activity | Output |
|---|---|---|
| **Weekly** | Mine prod+dev ledger free-text turns where `bind_source ∈ {llm, none}` or grounding repaired — i.e., every turn the semantic layer *failed to own* | candidate phrasings, LLM-labeled → human-reviewed registry PR |
| **Monthly** | Eval refresh: promote reviewed real-traffic rows into the labeled eval set; re-run the full gate | growing eval set that mirrors real buyers, not synthetic catalogs |
| **Quarterly** | τ_bind / τ_margin re-tune on the enlarged eval; per-`intent_kind` hit review — dead kinds retired, hot gaps expanded | tuned thresholds with evidence |
| **Per release** | Freeze `strict_baseline.json` snapshot tagged to the release | the regression floor ratchets UP only |

Compounding effects by month 6:
- the corpus holds thousands of **real buyer phrasings** labeled by observed outcome — an asset no regex library or competitor prompt-pack replicates;
- the eval set doubles as the **prod regression suite for every future engine change** (any PR, semantic or not, runs against it);
- the regex-miss lane shrinks structurally: each week's misses become next week's index rows, so the same failure phrasing can never recur — the whack-a-mole loop is replaced by a ratchet.
