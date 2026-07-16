# Understanding Flywheel — LLD (design, pre-implementation)

**Status:** DESIGN / for founder review. No code yet.
**Owner surface:** NayaDesk "Understanding Board" (evolves the command center) + ConverseSpine intent pipeline.
**One line:** a self-improving data pipeline that learns what buyers *mean* (intents) and what they *talk about* (entities/places/types) from real traffic, auto-corrects where confident, and spends a human only where judgment truly moves the number.

---

## 0. North star & the two loops

North star: **the % of buyer turns the bot correctly understands**, trending up on its own, at 50k conversations/day across states, languages and thousands of projects — with **~20–40 human decisions/day, flat as volume grows.**

The machine is **two coupled loops** sharing one safety gate:

- **Intent loop** — "what are they asking?" (price / location / visit / investment / a *new* kind of question). Grows the intent taxonomy and the pattern corpus.
- **Entity loop** — "what are they talking about?" (which project / place / builder / property *type*). Grows the catalog + the mask vocabulary. **This is where "auto-adapt to new places/types" lives — the dictionary auto-refresh is one component of it.**

Both feed the same **retrain → shadow-eval → promote** gate, so nothing reaches a real buyer unproven.

Answer to "is this the dictionary refresh?": the dictionary refresh is **§7.4 — one component of the entity loop.** The full machine is intent-loop + entity-loop + safe promotion.

---

## 1. What kind of machine this is (paradigm)

We are **not** fine-tuning a model. We run a **non-parametric, data-centric** system:

1. **Programmatic weak supervision** (Snorkel-style): several noisy "teachers" vote on each turn's label; a **label model** combines them by their *measured* accuracy. Agreement → an auto-label. (We already do a 2-teacher version: LLM+embedder agree ≥0.80 → auto-promote.)
2. **Active learning**: a selector spends the scarce human oracle only on the highest-expected-value uncertain/novel clusters.
3. **Open-world / continual learning**: the intent taxonomy and the entity catalog **grow** as new kinds/entities appear — not a fixed schema.
4. **Retrieval, not gradients**: understanding = nearest-neighbour over an embedded corpus (INTENT_VECTORS). Adding knowledge is *monotonic and local* — one row, attributable, reversible. This is *why* safe continual learning is tractable here: there is no catastrophic forgetting to fight, only corpus hygiene.

Why this matters: the "intelligence" is in the **data curation loop**, not a bigger model. Same cheap embedder, ever-better data — exactly the lever that just gave +22 pts.

---

## 2. Invariants (non-negotiable)

- **P7 — embedding-lane only.** Auto-correction may emit *corpus rows, labels, vocab entries, thresholds* — **never regex/engine code.** (Founder rule, [[embedding-lane-fixes-only]].)
- **No self-confirmation.** The student's own confidence is *never* sufficient to auto-label its own training data. An auto-label requires agreement among **independent** teachers (§9.1).
- **Nothing ships unproven.** Every corpus/vocab change is shadow-built and regression-gated on a frozen held-out set before promotion (§8).
- **Held-out is sacred.** Eval rows are never embedded (already enforced in the rebuild). The label model's accuracy is measured *only* on human-gold holdout.
- **Reversible & versioned.** Corpus + index + vocab promote as one atomic "understanding release" with instant rollback.
- **Human effort is bounded, not proportional.** Volume raises signal quality, never queue size.

---

## 3. Architecture at a glance

```
 50k/day buyer turns
        │
   ┌────▼─────────────────────────────────────────────┐
   │ 1. CAPTURE  (per-turn signal record)              │  D1: understanding_turns
   │   canonical vec · teachers' votes · confidence ·  │  (extends intent_review_queue)
   │   unknown-entity spans · language · outcome        │
   └────┬───────────────────────────────┬──────────────┘
        │ intent signals                 │ entity signals
   ┌────▼───────────────┐         ┌──────▼───────────────┐
   │ 2. LABEL MODEL     │         │ 6. ENTITY DISCOVERY  │
   │  weak-supervision  │         │  unknown-span mining │
   │  teachers → vote   │         │  → classify (place/  │
   │  → auto-label |    │         │    project/builder/  │
   │    uncertain |     │         │    TYPE/competitor)  │
   │    novel(new kind) │         │  → catalog reconcile │
   └────┬───────────────┘         └──────┬───────────────┘
        │                                │
   ┌────▼───────────────┐         ┌──────▼───────────────┐
   │ 3. CLUSTER         │         │  candidate registry  │
   │  online centroid   │         │  + vocab refresh     │
   │  → dedupe to cards │         │  (§7.4 dictionary)   │
   └────┬───────────────┘         └──────┬───────────────┘
        │                                │
   ┌────▼────────────────────────────────▼──────────────┐
   │ 4. ACTIVE-LEARNING SELECTOR                         │
   │  rank by uncertainty × volume × business-impact;    │
   │  auto-accept clean clusters; queue only the top-K   │
   │  for the human board (§12)                          │
   └────┬────────────────────────────────────────────────┘
        │ accepted labels (auto + human) + confirmed entities
   ┌────▼────────────────────────────────────────────────┐
   │ 5. RETRAIN → SHADOW EVAL → PROMOTION GATE            │
   │  rebuild shadow index (canonical); frozen held-out   │
   │  + no-regression check; auto-promote clean wins,     │
   │  queue ambiguous; atomic swap + rollback (§8)        │
   └────┬────────────────────────────────────────────────┘
        │ new understanding release
        └──────────────► back to CAPTURE (loop)
```

---

## 4. Capture — the substrate (§ everything depends on this)

Per turn, persist one record (`understanding_turns`, extending today's `intent_review_queue`):

| field | why |
|---|---|
| `turn_id, conversation_id, builder_id, ts` | identity / scope |
| `raw_text`, `canonical` | surface + masked form |
| `canonical_vec_id` | Vectorize handle for clustering/novelty |
| `student_intent`, `student_score`, `student_top3` | embedder result + **margin** (top1−top2) |
| `llm_intent`, `llm_conf` | LLM teacher (only when invoked, §5) |
| `rule_intent` | speech-act/rule teacher |
| `bind_source` ∈ {regex,embedder,chip,llm,slot,none} | how it actually routed |
| `unknown_spans[]` | proper-noun-ish spans NOT in vocab (§6) |
| `language`, `region` | lane routing |
| **`outcome_signal`** | **the free label** (§5.1): repaired / rephrased / escalated / progressed / converted |

`outcome_signal` is computed one turn later from the conversation (repair/repeat/responded_at already exist as measurement primitives). It is the single most valuable column: the buyer grades us for free.

---

## 5. Teachers + label model (the auto-labeling core)

Each turn is labeled by a panel of **independent** teachers (different inductive biases, so their errors are uncorrelated):

| teacher | signal | independent of student? |
|---|---|---|
| **T1 Implicit outcome** | buyer rephrased/repaired → *student was wrong*; progressed/converted → *weak-correct* | ✅ purely behavioural |
| **T2 LLM judge** | a periodic LLM (BAML/deepseek) classifies intent + can output **"new/other"** | ✅ different model family |
| **T3 Rules** | speech-act ladder / high-precision cues | ✅ symbolic |
| **T4 Desk ground truth** | agent takeover, lead tag, the answer that actually satisfied | ✅ human/CRM |
| **T5 Temporal** | the buyer's *later* clarified intent retro-labels the earlier ambiguous turn | ✅ future context |

**Label model.** Combine votes weighted by each teacher's *measured precision* on the human-gold holdout (learned, not guessed — Dawid–Skene / weighted majority). Output per turn: `p(intent)`, plus a **novelty** score.

**Decision policy per turn:**
- **Auto-accept** → label model ≥ τ_accept **and** ≥2 independent teachers agree **and** not novel → becomes a *train* row (quarantined until it survives §8). Generalises today's LLM+embedder≥0.80 auto-mine.
- **Uncertain** → teachers split / low margin → cluster + queue candidate (§4 selector).
- **Novel** → far from every corpus centroid **and** T2 says "new/other" → candidate **new intent kind** (open-world growth, §6-analog for intents).

**Cost control:** T2 (LLM) runs only on the *non-confident* subset (≈15–25% of turns) + a random audit sample — not all 50k. T1/T3/T5 are ~free.

---

## 6. Entity & type discovery — auto-adapt to new places/types

Parallel loop over `unknown_spans[]` (spans that look like proper nouns but aren't in vocab):

1. **Detect** — shape (Capitalised multiword / project-ish) + slot context ("in ___", "near ___" → place; "price of ___", "___ by <builder>" → project) + it's *not* already masked.
2. **Aggregate & cluster** — group span variants ("skyline meadows", "Skyline Medows"), count frequency, attach geo/context.
3. **Classify** (cheap → escalate): gazetteer/geocoder for places; fuzzy-match to Desk catalog for projects (→ **alias of existing** vs **genuinely new**); LLM classify for builder / **property TYPE** (e.g. "farm plot", "managed villa", "co-living") / **competitor** / noise.
4. **Route by confidence:**
   - high-precision place/alias → **auto-add** to the candidate registry (shadow vocab).
   - new project/builder/type/competitor → **human entity card** (one tap: Add / Competitor / Ignore, §12).
5. **New TYPES** specifically:
   - a new *property type* (farmland, plot, managed villa) → proposes a new `property_type`/facet in Desk + a handful of seed patterns.
   - a new *intent kind* (vaastu, feng-shui, pet policy) comes from §5's novelty path, not here — but both surface as "new kind" cards.

### 7.4 The dictionary auto-refresh (your direct question)
The mask vocab is **regenerated on every rebuild** from `Desk catalog (areas + projects + builders) ∪ confirmed candidate registry`, and **stored/versioned with the index** (KV snapshot the query reads). So:
- onboard a project/area/builder in Desk → next rebuild masks it everywhere, no redeploy, no train/serve skew;
- buyers surface names you *don't* have → discovery loop proposes them → one tap → in the dictionary next cycle.
- **Fix builders too:** today builders come only from a static gazetteer seed — the refresh must source them from Desk's `builders` table.

Result: the KNOWN/PARTIAL/RAW degradation ladder you saw self-heals — "raw" and "partial" entities become "full" within one cycle of being seen.

---

## 8. Retrain → shadow eval → promotion (safe self-improvement)

On an accumulation trigger (N accepted labels or nightly):
1. **Assemble** candidate corpus = current ∪ accepted train rows; candidate vocab = refreshed.
2. **Shadow build** a *second* Vectorize namespace (canonical embeds) — live index untouched.
3. **Gate** against:
   - the **frozen held-out** real-ask set (must not drop);
   - a **no-regression** replay of the 192-scenario pack + recent confirmed turns;
   - **per-lane** floors (no state/language regresses).
4. **Promote:** clean win (held-out ↑, nothing regresses) → **auto-promote** (atomic active-namespace swap + `sil_config` version bump); ambiguous/mixed → **queue a "review release" card**. Rollback = swap back the previous namespace.

For a one-person shop, **auto-promote of clean wins is the headline time-saver**: the bot improves overnight; the human only adjudicates the mixed releases.

---

## 9. The hard problems (and how we defuse them)

**9.1 Confirmation-bias / feedback loop** *(the central ML danger).* Self-training on the student's own confident predictions amplifies its confident *mistakes*. Defuse: never auto-label from student confidence alone; require **independent** teacher agreement (T1 behavioural + T2 different-model + T4 CRM); weight teachers by *measured* holdout precision; continuously inject human-audited gold + hard negatives; cap per-cluster contribution so high-volume easy intents can't swamp rare ones.

**9.2 Data poisoning / prompt injection via buyer text.** A buyer could try to teach the bot garbage. Defuse: auto-labels are quarantined until they pass the promotion gate; novelty/new-entity always needs the human or a high-precision non-text signal; per-source rate caps; adversarial spans (instructions, URLs) never enter vocab.

**9.3 Drift.** Monitor top-line + per-lane understanding; teacher-accuracy decay; auto-accept-rate spikes. On anomaly → freeze auto-promotion, escalate, optionally auto-rollback.

**9.4 Cold start / rare intents.** Novelty path + active-learning *diversity* sampling ensures rare-but-real kinds surface instead of being drowned; per-kind minimum representation in the corpus.

**9.5 Cost at 50k/day.** 1 cheap embed/turn (capture+cluster); LLM teacher only on the uncertain slice + audit; online nearest-centroid clustering (O(1)/turn vs capped centroids); human O(1) regardless of volume. Bounded and predictable.

**9.6 Catastrophic forgetting.** Non-issue by construction — retrieval corpus, not weights. Old confirmed patterns persist unless explicitly *superseded*; supersession is logged and reversible.

---

## 10. Cloudflare shape & data model

- **Ingest:** bot writes a turn event → **Queue** → async worker builds the `understanding_turns` row (keeps the hot path fast).
- **Clustering:** streaming nearest-centroid against a capped centroid set in D1/KV; nightly re-centroid job.
- **Teachers:** Workers AI (embedder), periodic LLM (deepseek/BAML) on the uncertain slice, rules in-worker, Desk ground truth via service binding.
- **Shadow index:** second Vectorize namespace; promotion = pointer swap in `sil_config`.
- **Stores (D1):** `understanding_turns`, `intent_clusters`, `intent_candidates`, `entity_candidates`, `label_events`, `teacher_accuracy`, `understanding_releases`.
- **Board:** NayaDesk reads the active-learning queue + release cards; controls write `sil_config`.

---

## 11. The human contract (the board)

The operator only ever does domain judgment, ≤ ~40/day, and the queue **shrinks as the corpus matures** (confirmed patterns stop re-surfacing):

| card | decision (one tap) | becomes |
|---|---|---|
| Shaky-confidence cluster | Confirm / **Correct** (pick plain-language meaning) | train rows for that meaning |
| New kind of question | Teach (pick meaning + answer) | new intent kind + seed rows |
| Unknown name | Add project / Competitor / Ignore | catalog + vocab entry |
| New property type | Add type / Ignore | new facet + seed rows |
| Mixed release | Go live / Not yet | promotion or hold |

Never shown: vectors, thresholds, canonical strings, regex, "modules." Proactive teaching (type a few phrasings → meaning) uses the same path.

---

## 12. Metrics & observability

Top-line understanding % (overall + per state/language/topic, trended) · auto-accept rate & its measured precision · teacher accuracies · human-queue depth & time-to-fix · entities discovered/confirmed · poisoning attempts blocked · release history + rollbacks · **"cost of not fixing"** per open cluster (buyers/week × value).

---

## 13. Rollout (crawl → walk → run)

- **Phase A — See (crawl).** `understanding_turns` capture + `outcome_signal` (T1) + clustering + the board's read-only card feed + the one honest number. *Makes today's console usable; zero risk.*
- **Phase B — Teach (walk).** Human decisions → accepted labels → shadow build → **manual** promote. Entity discovery + **vocab auto-refresh (§7.4)** ships here (smallest self-contained brick, unblocks entity cards).
- **Phase C — Self-drive (run).** Full teacher panel + label model + **auto-accept** of clean clusters + **auto-promote** of clean releases + drift guard. Human drops to adjudicating novelty + mixed releases.

**Already built we reuse:** capture skeleton (`intent_review_queue` with 3 teachers), auto-mine at ≥0.80 (proto label-model), canonical rebuild + held-out split + shadow-safe flag (this week's PR #89), the command-center shell + `sil_config`.

---

## 14. Open decisions for the founder

1. **Auto-promote default:** ON for clean, no-regression releases (recommended — the core time-saver) vs always-ask.
2. **LLM-teacher budget:** what monthly $ ceiling for T2 on the uncertain slice (sets the auto-accept coverage).
3. **Taxonomy growth authority:** may the system *propose* a new intent kind autonomously (human confirms), or only surface clusters under existing kinds?
4. **Entity auto-add threshold:** how precise before a discovered *place* auto-enters vocab without a tap (projects/builders/types always tap).
5. **First brick:** Phase A (See) vs the §7.4 dictionary-refresh (smallest, unblocks entity cards) — recommend building §7.4 first, then Phase A.
