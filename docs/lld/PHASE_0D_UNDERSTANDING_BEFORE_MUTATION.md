# Phase 0d — Understanding before mutation

**Status:** DESIGN ONLY — no implementation until founder approves this note.  
**Parent:** [`DIALOGUE_STATE_ARCHITECTURE_LLD.md`](./DIALOGUE_STATE_ARCHITECTURE_LLD.md) §3b–§3c  
**Evidence:** §3b measurement (possession phrasing cliff); §3c / [`phase-0e-verdict-precision.md`](../reports/phase-0e-verdict-precision.md) (precision **0.712** → verdict = **tiebreaker only**)  
**Dig posture today:** `ROUTING_IN_GOAL=false` (#160). Wire code may stay; do not revive equal-weight veto.

---

## 1. Scenario (why this phase exists)

Buyer is **focused on Brigade Eldorado**.

| Turn | Buyer says | Today (common failure) | After 0d |
|------|------------|------------------------|----------|
| A | `when is possession` | Regex `isFocusedSearchPivot` → **true** → `releaseToDiscover` **before** routing → shortlist / “apartments in…” — Eldorado gone | `uₜ` complete first → answer-intent + no new budget/area → **keep focus** → Eldorado possession fact |
| B | `what is the possession date` | Often keeps focus (regex false) → correct answer | Same correct answer — A and B must match |
| C | `actually my budget is only 50L` | Must **not** pin Eldorado pricing that ignores 50L | Extract sees new budget → **pivot / re-search** (Cornerstone ~₹45L may qualify) |

**Grading rule:** assert the **fact in the reply / catalog truth**, never “stayed on Eldorado.”

Same intent, opposite outcomes on A vs B today — 100% correlated with a regex that runs hundreds of lines before the embedder verdict. That ordering is the bug. #159’s “verdict vetoes regex” papered A but broke C-class pivots when graded only on focus-stay.

---

## 2. Design note (implementation contract)

### 2.1 Files / layers to touch

| Module | Role |
|--------|------|
| `src/engine/turn.ts` | **Primary.** Reorder: assemble `uₜ` (routing + extract join) **before** any `releaseToDiscover` / focus commit / durable constraint write that depends on “is this a pivot?” |
| `src/engine/turn-intent/focused-intent.ts` | Demote `isFocusedSearchPivot` from sole authority to **one signal** in a post-join pivot arbiter (keep export for Advisor / tests). |
| `src/engine/turn-intent/*` (`applyTurnIntentResult`, `shouldRunTurnIntent`, focus-hold helpers) | Turn-intent classifier becomes an **input to `f`**, not a direct writer of focus release when 0d flag is on. |
| `src/engine/turn-routing/classify.ts` (+ `buildTurnRoutingInput`) | Run once (or early+reuse) on raw text; result available before mutation. No new semantic stage. |
| `src/engine/phases/focused.ts` / `decideGoal` / `decideGoalAsync` | Gain access to complete `uₜ` (routing + extract) in signature / call site — today `decideGoal(s, ex, visitCtx, text)` cannot see routing. |
| `src/env.ts`, `src/runtime/deps.ts`, `wrangler.toml` `[env.dev]` | New dig-first flag (proposed name below). Keep `ROUTING_IN_GOAL=false` until gate passes; do not flip it as the 0d ship vehicle. |
| `tests/` + dig probe script | Unit: pivot arbiter. Behavioural: pinned dig probes + truth grader for veto-class texts. |
| `docs/reports/` (post-gate) | Pin run IDs + short pass/fail table before any flag-on recommendation. |

**Out of scope for this PR:** entity store (Phase 1), multi-label producer (Phase 3 / multi-intent E), compose truth gates, Desk catalog, Advisor SPA.

### 2.2 Why this layer

Root cause is **ordering**, not a missing regex or a missing teach row:

```
today:  regex pivot? → mutate focus → … → classifyTurnRouting / extract pieces
0d:     extract ∥ routing → join uₜ → arbitrate pivot vs answer → then mutate bₜ
```

Parent formula: `bₜ = f(bₜ₋₁, uₜ)`, not mutate-then-understand.

### 2.3 Why NOT other layers

| Rejected fix | Why not |
|--------------|---------|
| Broaden / narrow `isFocusedSearchPivot` regex | Chases an open set of phrasings; A/B cliff returns under new wording. |
| Revive `ROUTING_IN_GOAL` as equal veto (#159) | 0e precision 0.712; live probes showed genuine pivots answered on-focus when graded only on focus-stay. LLD: **tiebreaker only**. |
| Compose / banned-phrase patch | Symptom after subject already wrong. |
| Multi-intent Phase E (embedder multi-label) | Consumer of a trustworthy `uₜ` before mutation; cannot measure until 0d. |
| Phase 1 entity store | Orthogonal; does not fix “release before understand.” |

### 2.4 Consumers traced (who reads the changed value)

| Value | Writers after 0d | Readers |
|-------|------------------|---------|
| `state.phase` / `state.focus` | Only **after** pivot arbiter | focused/discover decide, compose, Advisor board, CRM `releaseProject` |
| `ex` (constraints, askTopics) | Extract (+ authority fill) **before** arbiter | geography persist, `decideGoal`, evidence fetch |
| `routing` / `answer_topics` | `classifyTurnRouting` in `uₜ` join | intent authority, multi-intent union, `decideGoal`, ledger `routing_bind` |
| `focusPivotTurn` / `releasedFocus` | Arbiter outcome, not bare regex | recovery paths, dig telemetry, Advisor `isFocusedSearchPivot` mirror (Advisor may stay regex until Spine is proven) |

### 2.5 Quality check (gate — must pass before flag-on)

**Grade catalog truth in the reply, not focus-stay.**

**Answer class** (Eldorado focused first; pinned dig run):

| Utterance | Reply must carry |
|-----------|------------------|
| `when is possession` | Eldorado possession / delivery fact |
| `what is the possession date` | Same |
| `has this area appreciated` | Investment/return (or honest miss) on focused project / area — not a replacement shortlist |

**Pivot class:**

| Utterance | Reply must |
|-----------|------------|
| `actually my budget is only 50L` | Budget-fit inventory path (Cornerstone from ₹45L can qualify); not Eldorado-only pricing that ignores the cap |
| `2 BHK in Jayanagar` | No invented Jayanagar stock; not Eldorado 2BHK as if that were the ask |
| `show me other projects in Whitefield` | Leave Eldorado focus; Whitefield options |

Also:

- Same pinned run: both possession phrasings 6/6 (or documented N) with **truth** grader.
- Full suite: no new failures — necessary, not sufficient.
- Re-score the **~64 veto-class** texts from the §3b audit live with truth grading before recommending any routing-in-goal / 0d flag on dig.
- Tooling: `scripts/pinned-run.sh` (or successor) for every live claim.

---

## 3. Proposed control surface

| Flag | Meaning |
|------|---------|
| `UNDERSTANDING_BEFORE_MUTATION` (proposed) | Dig-first. When `true`: extract ∥ routing join before focus release; pivot via arbiter. When `false`: today’s order (rollback). |
| `ROUTING_IN_GOAL` | Stays **`false` on dig** for this phase. Not the ship vehicle. After 0d gate, any use is **tiebreaker** per 0e — separate, smaller follow-up PR. |

Rollback: flip `UNDERSTANDING_BEFORE_MUTATION=false` and redeploy dig — old order returns.

---

## 4. Pivot arbiter (post-join) — sketch

Inputs available only **after** `uₜ` join:

1. **Extract constraints delta** — new/changed budget, BHK, locality, property type → lean **pivot** (offline ~31 class).
2. **`isFocusedSearchPivot(text)`** — demoted to a **signal**, not a writer.
3. **Routing bind** (tiebreaker) — if answer-intent ≥ `tau_high` **and** no constraint delta → lean **hold focus**; if bind is wrong/ambiguous, do **not** override a clear extract pivot; if regex says pivot and bind is weak/wrong, prefer extract + prior focus (do not #159-veto).

Output: `{ action: 'hold_focus' \| 'release_to_discover', reason }` recorded on the turn debug / ledger for hand-read.

Exact thresholds land with failing unit tests first (LLD §0 rule 3).

---

## 5. Implementation slices (after approval)

| Slice | Deliverable | Merge when |
|-------|-------------|------------|
| **0d-0** | This note approved; failing probes / unit stubs committed that fail on current main | Probes fail for the right reason |
| **0d-1** | Flag + reorder in `turn.ts`: join before mutation; old path when flag off | Unit + dig smoke; flag **off** on dig default until 0d-2 |
| **0d-2** | Pivot arbiter + `decideGoal` sees routing | Answer + pivot gate table green on dig with flag **on** |
| **0d-3** | 64-text truth re-score report; decision on dig default | Founder sign-off; then consider dig default `true` |
| **Later** | Tiebreaker use of routing-in-goal (if still needed) | Separate PR; never equal-weight veto |

One concern per PR. No bundling with entity store or multi-label.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Reorder breaks every turn | Flag + keep old path; dig-only first |
| Focus-stay grader false confidence | Truth / catalog anchors only (§2.5) |
| Wrong high-confidence binds (`70L` → brochure) | Tiebreaker only; extract constraint delta wins for pivots |
| Double `classifyTurnRouting` cost | Compute once, reuse `precomputedRouting` |
| Advisor still uses local `isFocusedSearchPivot` | Accept lag; Spine is source of truth for chat turns |

---

## 7. Acceptance (founder bar → testable)

1. Scenario A and B both return Eldorado possession facts in one pinned dig run.  
2. Scenario C resurfaces budget-fit search behaviour (catalog-true).  
3. Flag off restores prior behaviour.  
4. No new suite failures; 64-text veto-class re-score filed before dig default-on.  
5. Verdict never sole authority to keep focus when extract shows a new search constraint.

---

## 8. Decision requested

Approve **0d-0 → 0d-1** as above (flag name + arbiter sketch + gate table), or amend:

- Flag name / dig default timing  
- Whether Advisor must mirror the arbiter in the same PR (recommend: **no**)  
- Any additional pivot / answer probe before dig default-on  

**No `turn.ts` reorder until this note is approved.**
