# Visit / multi-visit — embeddings-first remediation

**Status:** V0–V4 + V1 hold cleanup complete (2026-08-02) — same-day exit phrase hold removed · chooser closed deixis (dono/sab/ye sab) · teach + VIS-ADV-01…08  
**Thumb rule:** embeddings/teach first; regex only for smalltalk/noise validation or static closed values (hours, clock, affirm, chooser deixis).  
**Honesty gate:** dig VIS-MV + VIS-ADV green under `VISIT_EMBED_ACTS_ONLY`; open acts require teach bind (see `tests/visit-mv-teach-gate.test.ts`).

Related: [DIALOGUE_STATE_ARCHITECTURE_LLD](./DIALOGUE_STATE_ARCHITECTURE_LLD.md) hard rule §5 (“misses → teach, never new regex”), [USE_CASES](../../corpus/pending/visit-mv-teach/USE_CASES.md).

---

## 0. Audit verdict (last ~week)

### What Phase 1 / Phase 2 actually were

| Phase | Intended | Landed (separate track) | Visit-MV relation |
|-------|----------|-------------------------|-------------------|
| **1** | One entity store, salience, deixis (J7 / NAME-06) | Yes — #173 / Phase 1b consumers | Orthogonal. Visit-MV did not extend the store. |
| **2** | State tokens in embed (`<visit_pending>`…); gate = `ask_next_step` across states | Yes — #174 / 2a–2c | Visit-MV *named* `<visit_pending>` in comments and added **new kinds** without corpus upsert. Not the Phase 2 gate. |

Phase 1/2 are real architecture. The multi-visit soak work mostly **did not ride that rail**.

### Classification of last-week visit work

| Change | Class | Why |
|--------|-------|-----|
| Hours fit, 2h on-site, `packSameDay`, which-projects chooser, consume-before-ask | **Solution (act)** | Deterministic scheduling math — correct layer |
| Soft-exit keeps visit draft (`exitVisitPhase`) | **Solution (state)** | Correct dialogue continuity |
| `visit_ask_team` / `visit_force_same_day` map + consumer | **Scaffold, not solution** | Embed-first *shape*; dig never taught; regex is live owner |
| Placeability gate | **Solution (slot validation)** | Right layer; lexicon OK for smash — not intent classification |
| Chooser hold vs compare stamp | **Patch** | Symptom of bad bind on “both” |
| Same-day / different-day exit + RTI holds | **Patch** | Phrase gates papering over false compare / focus steal |
| Skip `unknown_request` over short chooser | **Patch** | Authority bypass |
| VIS-MV assert soften (`placing` / `works`) | **Proof hygiene** | Not product understanding |
| Contextual “couldn’t make sense” copy | **Unshipped design** | HTML only |
| Teach `upsert-items.jsonl` | **Not executed** | 11 local rows; no `upsert-result.json` |

**Impressed?** Moderately by act-layer scheduling + Phase 1/2 on the other track. **Not** impressed by the visit understanding path: it violates the LLD hard rule in practice (grew regex + holds) while telling an embeddings story dig never received. Soak green under that regime is a false comfort for real paraphrases.

---

## 1. Pattern inventory (what we should have named first)

Before more code: every failure class is one of:

| Pattern ID | Buyer shape | Failure mode seen | Correct owner |
|------------|-------------|-------------------|---------------|
| **P-open-act** | Open visit speech act | “ask the team…”, “force all same day…” | Teach kinds under `<visit_pending>` |
| **P-false-bind** | Short deixis / itinerary anaphora | “both” → compare; “same day for X” → commit | Teach + state-token query; **not** exit holds as primary |
| **P-slot-noise** | Smash / smalltalk while slot open | Origin stamped / flat re-ask | Placeability + contextual clarify copy |
| **P-hours-policy** | Clock outside site hours | Firm-book vs team | Deterministic hours + team act (after P-open-act bind) |
| **P-pack-math** | Multi-stop same day | Silent overbook / split offer | `packSameDay` only |
| **P-digression-resume** | Facet digression mid-itinerary | Draft lost / focus steal | State: keep draft; resume via taught itinerary acts + salience |
| **P-clarify-sticky** | Noise while job outstanding | Generic “rephrase” | Outstanding-ask clarify (discover/legal/visit) — copy, not teach smash |

Patches we shipped map almost 1:1 onto **P-false-bind** and **P-digression-resume** treated as if they were act bugs.

---

## 2. Target architecture (embeddings as far as possible)

```
buyer text
  → state token (<visit_pending> | <focused> | …)          [Phase 2a — keep]
  → INTENT_VECTORS nearest kind                            [teach owns open phrasing]
  → embedder-map → routing                                 [bind only]
  → visit.decide / discover / answer                       [act: hours, pack, propose, clarify]
  → placeability / hours / pack                            [validators — closed sets]
  → compose / templates                                    [copy]
```

**Hard rules for this remediation**

1. No new understanding regex unless it is a **documented abstain fallback** for a closed cue set, with a teach row that should win first.
2. Every dig-green VIS-MV open-act turn must pass a **teach-ablation**: temporarily disable fallback regex → still bind via embed (or fail loud).
3. Exit/RTI phrase holds are **temporary safety net**; delete only after false-bind teach + reprobe prove they are unused.
4. Keyboard smash is never a teach kind.

---

## 3. Phased remediation plan

### Phase V0 — Stop lying to ourselves (1 day)

1. Upsert Batch A (`visit_ask_team`, `visit_force_same_day`) to dig `/internal/intent-vector`; save `upsert-result.json`.
2. Expand Batch B paraphrases (Hinglish, “sales”, “host later”, “squeeze Monday”) — same two kinds only.
3. **Ablation soak:** VIS-MV-04 / MV-06 with fallback regex **off** (feature flag or test hook). Pass = teach works; fail = corpus gap, not more visit.ts regex.
4. Commit teach artifacts + flag the golden rule in PR body: “dig bind source = embed for these turns.”

**Exit:** `bind_source` / debug shows embed kind on ask-team & force turns on dig.

### Phase V1 — Kill false-bind patches with teach + state ✅

| Patch | Resolution |
|-------|------------|
| Same-day / different-day exit phrase hold | **Removed** — stay only via teach bind (`visit_same_day` / `visit_other_day`). Phrase still abstain-fallback in `wantsSameDay` when `embedActsOnly` is off. |
| Chooser short-deixis | **Kept as closed-format validator** (`isAllDeixis`: both/dono/sab/ye sab/saare/ordinals) while `which_projects` — not open-act regex. Teach rows + VIS-ADV-04/07/08. |
| Soft-exit compare on “both” | Closed deixis hold + teach `visit_choose_stops`; negatives `dono farq` / `compare dono`. |

**Exit:** Same-day phrase short-circuit gone; chooser closed set expanded; VIS-MV-09 + VIS-ADV dual-channel green under `VISIT_EMBED_ACTS_ONLY`.

### Phase V2 — Contextual misunderstand (copy + outstanding ask) (1–2 days)

Not embeddings for smash.

1. Shared helper: `clarifyOutstandingJob(state, lastTopic)` → visit origin / day / discover slots / focused facet.
2. Wire origin noise path (replace flat re-ask); discover gibberish; focused facet noise.
3. VIS-MV-08 asserts require “couldn’t make sense” (or agreed synonym) + job re-anchor; exclude generic-only rephrase as sole pass.

**Exit:** Prototype copy is live; MV-08 + one discover + one legal smoke.

### Phase V3 — Pattern → kind registry (ongoing flywheel) ✅

Maintain `corpus/pending/visit-mv-teach/USE_CASES.md` + `PATTERNS.md` as the **pattern ledger**:

- New live fail → classify P-* → teach row or validator — never silent regex in `visit.ts` / `turn.ts`.
- **Gate test:** `tests/visit-mv-teach-gate.test.ts` — every open visit kind has upsert rows; ablation proves acts fire only with teach bind under `embedActsOnly`.
- Weekly: top false binds from dig telemetry → promote/delete.

**Exit:** New visit speech act cannot land without teach batch + ablation test. *(enforced in unit gate)*

### Phase V4 — Real-world proof (not scoreboard) ✅

1. Adversarial scenarios `VIS-ADV-01`…`06` — Hinglish ask-team, cram-force, usi-din resume, dono chooser, discover smash, origin smalltalk (wording **not** copied from VIS-MV scripts).
2. Dual channel via `scripts/run-vis-mv-matrix.ts` (loads VIS-MV-* + VIS-ADV-*).
3. Dig under `VISIT_EMBED_ACTS_ONLY=true`; open-act turns need embed bind.
4. Regex fallback width frozen — closed clock/day/affirm / chooser deixis only.

---

## 4. What stays deterministic (do not “embed” these)

- Site visit hours window, on-site duration, drive stagger, `packSameDay`
- Placeability / plausible place label
- Bare affirm / ISO slot parse / day words (closed formats)
- Propose / book / pending-team CRM side effects

Embeddings choose **which act**; policy chooses **whether the slot is legal**.

---

## 5. Sequencing vs Dialogue-State Phase 3+

- Do **not** block on Phase 3 multi-topic router for V0–V2.
- Do **use** Phase 2 state tokens for all new visit kinds (prefix `<visit_pending>` in rebuild/query).
- Entity store (Phase 1): resume after digression should resolve “Krishnaja” via salience, not only string match — follow-up once V1 kinds exist.

---

## 6. Definition of done (founder-facing)

| Gate | Status |
|------|--------|
| Dig teach upserted (87 rows) + ablation green for ask-team + force | ✅ `VISIT_EMBED_ACTS_ONLY` + `visit-mv-teach-gate.test.ts` |
| Chooser / same-day: teach + closed deixis (not growing open regex) | ✅ teach kinds + `isAllDeixis` closed set (`dono`/Devanagari) |
| Contextual misunderstand copy (visit/discover/facet) | ✅ sticky clarify live |
| Fresh paraphrase set VIS-ADV-01…06 dual-channel dig | ✅ after ADV-04 `dono` closed-deixis fix |

VIS-MV remains **regression smoke**; VIS-ADV is the paraphrase confidence set.
