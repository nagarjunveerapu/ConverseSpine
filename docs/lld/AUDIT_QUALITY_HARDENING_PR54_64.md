# Audit — Quality hardening line (PR #54 → #64)

**Audience:** Claude (implementer) + reviewer  
**Scope:** ConverseSpine `origin/main` @ `28a761e` — merges `#54`…`#64` against the approved LLD *ConverseSpine quality hardening (beta line)* (W1–W9).  
**Date:** 2026-07-13  
**Auditor:** Cursor review (human-directed)

---

## 0. How to use this doc

1. Treat every **P0/P1** as a fix-before-next-beta item unless explicitly deferred in writing.
2. Do **not** add a new pipeline stage, second Desk path, or parallel state store.
3. Post a **design note** (files / why this layer / why not other layers / consumers / quality check) before coding each fix.
4. Prefer extractors and adapter truth over compose prompt patches.
5. After decide-order or hold changes: live HOLD soak on real embedder — unit fakes alone have already missed regressions (`#61`/`#63`).

---

## 1. Executive verdict

| Area | Verdict |
|------|---------|
| Layer contract (no new stages) | **Mostly held** — good |
| W5, W2, W3, W1 (core), W6 (partial), W7 (partial), `#64` FAQ ownership | **Ship-worthy with fixes** |
| Claimed “W8” (`#60`) | **Mislabel** — not LLD W8 |
| W4 “one price truth” | **Incomplete** — alternate paths still raw |
| W7 `cost_sheet` | **Missing** |
| W6 Desk audit on rate-limit drop | **Missing** |
| W9 regression gate / SLOs | **Not shipped** |
| Hardcoding | Mostly OK beta knobs; a few **risky heuristics** |

**Bottom line:** The line is directionally correct and stays inside the kernel. It is **not** LLD-complete. Several items were renamed or truncated; one compose “W8” must not be treated as closing project-identity work.

---

## 2. Merge map (what landed)

| PR | Claimed item | Merge tip | Notes |
|----|--------------|-----------|-------|
| [#54](https://github.com/nagarjunveerapu/ConverseSpine/pull/54) | W5 stage truth | `1a04fe4` | Engaged/qualified ladder + `onlyForward` |
| [#55](https://github.com/nagarjunveerapu/ConverseSpine/pull/55) | W6 ingress | `a5fb83b` | Dedupe + RL + channel labels; **no Desk audit store** |
| [#56](https://github.com/nagarjunveerapu/ConverseSpine/pull/56) | W4 format once | `a3acf77` | Formatters + partial adapter apply |
| [#57](https://github.com/nagarjunveerapu/ConverseSpine/pull/57) | W2 + W3 | `4089c53` | Bare-affirm + repeat guard |
| [#58](https://github.com/nagarjunveerapu/ConverseSpine/pull/58) | W7 starved features | `ccb880a` | Holdable/waitlist/phase; **no `cost_sheet`** |
| [#59](https://github.com/nagarjunveerapu/ConverseSpine/pull/59) | W1 repair | `1c8fc5e` | Grounding retry; **no `allowedFacts`** |
| [#60](https://github.com/nagarjunveerapu/ConverseSpine/pull/60) | “W8” | `780fb88` | **Compose prompt only — not LLD W8** |
| [#61](https://github.com/nagarjunveerapu/ConverseSpine/pull/61) | Hold vs visit transition | `db2cf05` | Real-embedder regression fix |
| [#63](https://github.com/nagarjunveerapu/ConverseSpine/pull/63) | Hold vs visit inside `focused.decide` | `90378c2` | Second gate; tests had been infidelitous |
| [#64](https://github.com/nagarjunveerapu/ConverseSpine/pull/64) | Overview card / FAQ owner / placeholder | `28a761e` | Structural FAQ fix good; placeholder regex too wide |

`#54`–`#59` merged in a tight cluster — contrary to LLD “each W-item its own PR with its own metric soak.”

---

## 3. Findings (actionable)

### P0 — must fix

#### P0.1 — “W8” mislabel: project identity still open

- **LLD W8:** closed-set alias index in `extract-authority` / `project_switch` (token containment + edit-distance ≤ 2 on `lastOffered` ∪ `discussedProjects` ∪ `focus`); sticky-focus requires explicit cue.
- **What shipped (`#60`):** one LLM prompt rule in `compose.ts`:

  `Name the project (*${evidence.detail.name}*) once, naturally…`

- **Why wrong:** prompt bandage at compose; does not resolve SW/PIV/HIN identity failures; violates “extractors over prompts” discipline.
- **Action:**
  1. Rename `#60` in docs/commits mentally to **“compose name-anchor hint”** — do **not** mark W8 done.
  2. Implement real W8 in extract + `project_switch` with provenance `'regex'`.
  3. Exit: re-baseline the failing identity scenarios on current `main`; do not assume the old “9 failing” list.

#### P0.2 — W4 incomplete: alternate paths still dump raw band / skip formatters

**Files:** `src/engine/adapters/nayadesk.ts`

- Context/`conversationContext` path correctly uses `startingPriceDisplayFrom(...)`.
- **`getProject` fallback still sets** `startingPriceDisplay: p.entry_price_band` (raw).
- **`pricing()`** still seeds `startingDisplay` from `ctx?.project?.entry_price_band`.
- `#64` added a **second** helper `priceBandDisplayFrom` for overview cards → “one price truth” became two policies (min-from vs low–high band).

**Action:**
1. Route **every** `startingPriceDisplay` / pricing start through one shared policy function (or two *named* policies with an explicit contract: recommend uses min; overview uses band — and document when each appears).
2. If band is shown, LLD required it to appear with the word **“range”** (or equivalent) — currently fallback returns the band string as-is.
3. Unit tests: same project must not emit `from ₹31 L` and bare `25-50L` in one conversation without “range”.

#### P0.3 — W7 incomplete: `cost_sheet` never wired

- LLD: type catch-up + formatted cost-sheet lines on price topic evidence (via W4 formatters).
- `git grep cost_sheet` on `main` → **empty**.
- Holdable / waitlist / `phaseNote` parts of W7 look correct.

**Action:**
1. Extend `NdContextBundle` (if Desk already sends it) + map into price evidence through `formatCostValue`.
2. Do **not** invent a new goal kind.
3. Quality check: “what’s the all-in cost” / stamp-duty style asks ground without inventing numbers.

---

### P1 — should fix before beta cohort

#### P1.1 — W6: rate-limited inbound not stored to Desk

- LLD: over-cap inbound is **stored to Desk (audit trail)** but generates no LLM turn.
- Current webhook: `overRateLimit(...) → continue` (silent drop).

**Action:** on over-cap, append inbound (and optionally a system note) via existing CRM/message port; still return 200 to Meta; no `runEngineTurn`.

#### P1.2 — W1: `allowedFacts` omitted; repair tests soft-assert

- LLD: `repair?: { violations: string[]; allowedFacts: string[] }`.
- Shipped: `repair?: { unbacked: string[] }` only.
- Shared retry budget with W3 is good; template-lock skip is good.
- Tests in `tests/repair-recompose.test.ts` use `if (grounding === 'recomposed') … else expect pass|repaired` — can green without proving the happy path.

**Action:**
1. Pass evidence-line excerpts (or the same strings `renderEvidence` uses) as `allowedFacts`.
2. Make at least one test **require** `grounding === 'recomposed'` with a controlled fake LLM + evidence.

#### P1.3 — `#64` placeholder guard too broad

```ts
/\[[a-z][^\]\n]{2,60}\]/i
```

- `/i` → any `[Phase 2]` / `[RERA …]`-style span can force repair → template.
- Symptom fix for `"[real starting point]"` leaking to buyers.

**Action:** narrow to known template tokens (e.g. `real starting point`, `TODO`, `placeholder`) or require lowercase instructional phrases — not any bracketed span.

#### P1.4 — W9 not shipped

- Existing CI: `typecheck` + `npm test` only (`.github/workflows/ci.yml`).
- Missing: nightly scenario sweep vs dev; fail &lt; 90%; tracking issue; SLOs on template-repair / repeated-line / response-after-repair.

**Action:** schedule W9 as its own PR; do not claim the hardening line “locked.”

---

### P2 — tighten / document

#### P2.1 — W5 engaged trigger broader than review note

`decideStageRung`: engaged if `goal.kind === 'answer'` **or** `focusedTurns >= 2`.

- Review asked: facet answer **or** second focused turn.
- Any `answer` (including first-turn overview) marks engaged.

**Action:** either accept and document, or gate engaged on facet topics ∪ `focusedTurns >= 2`.

#### P2.2 — Risky format heuristics (hardcoding)

| Heuristic | Location | Risk |
|-----------|----------|------|
| bare `n ≤ 30` + duty/tax-ish label → `%` | `formatCostValue` | OK for stamp duty “5”; wrong if Desk sends other small money amounts on those labels |
| bare `n ≥ 100_000` → `formatInr` | same | OK if values are INR not paise |
| bare other → `₹{n}` (e.g. `499` → `₹499`) | same | Matches known transcript; wrong if value is paise or /sqft without label |
| `PERCENT_LABEL` arm `charge[s]? \(%` | same | Looks malformed; verify intended matches |
| possession first-sentence cut at length &gt; 60 | `formatPossession` | Can drop useful second clause |
| hold re-offer window `≤ 6` | `focused.ts` | Documented beta knob — OK |
| rate limit `20` / `5 min` | `ingress-guard.ts` | OK; fails open without KV — OK |

**Action:** add unit cases for paise-looking magnitudes and non-duty labels; fix or delete the broken `PERCENT_LABEL` arm.

#### P2.3 — `bareAffirm` does not explicitly exclude `holdAsk`

Safe today only because `#63` moved `holdAsk` **above** bare-affirm. A future reorder can regress.

**Action:** add `!ex.holdAsk` to the `bareAffirm` predicate (defense in depth).

#### P2.4 — Process: fake NLU hid hold∩visit bug

`#61`/`#63`: real embedder tags `"hold a 2 bhk"` as `want_visit`; fakes did not. Unit tests passed against broken code until a direct `focused.decide` test was added.

**Action (standing rule):** any hold/visit precedence change needs (a) injected `holdAsk + want_visit` unit test **and** (b) live HOLD-01/04/05 soak.

---

## 4. What looks correct (do not rip out)

Keep these unless a measured regression appears:

| Item | Why it’s good |
|------|----------------|
| No new pipeline stage / no DO rate limiter | Matches LLD |
| W5 write-once + `onlyForward` | Desk-safe; monotonic |
| W2 hold downgrade (not delete) + re-propose; never book on stale yes | HOLD-05 law |
| W3 template-lock exemption + shared `retryUsed` with W1 | No repair forest |
| W1 template floor unchanged on second fail | Floor never moves |
| W6 channel truth (`whatsapp` / `advisor_web` / `api`) + bot-secret RL exemption | Fixes advisor mislabel |
| W7 holdable `=== 0` → waitlist propose; `queue:true` on same hold machinery | No new goal kinds |
| `#63` holdAsk above `want_visit` in `focused.decide` + transition gate | Correct layer |
| `#64` `detail.faqs` = matched FAQ hits only (adapter no longer dumps catalog) | Structural, not symptom |

---

## 5. LLD completion scorecard

| W | LLD intent | Status on `main` |
|---|------------|------------------|
| W1 | Grounding → 1 recompose w/ violations + allowedFacts → else template | **Partial** — retry yes; `allowedFacts` no; soft tests |
| W2 | Bare-affirm: re-propose ≤6 / else `advance` | **Done** (add `!holdAsk` belt) |
| W3 | Anti-repeat; template-lock exempt; CTA rotate fallback | **Mostly done** — verify CTA-rotate path vs LLD “rotate trailing CTA” (may have been simplified to template fallthrough) |
| W4 | Format once at adapter; one starting-price truth; band with “range” | **Partial** — formatters exist; alternate paths raw; two price helpers |
| W5 | engaged / qualified ladder | **Done** (engaged trigger slightly broad) |
| W6 | Dedupe + RL + channel + Desk audit on RL drop | **Partial** — audit missing |
| W7 | cost_sheet + phase + holdable + waitlist | **Partial** — cost_sheet missing |
| W8 | Project-identity alias index (extract) | **Not done** — `#60` is a prompt patch |
| W9 | CI + nightly scenario gate + SLOs | **Not done** |

---

## 6. Recommended cleanup PR sequence (for Claude)

Do **not** big-bang. One PR per bullet, with design note + tests + soak where noted.

1. **`fix/w4-price-truth-all-paths`** — P0.2 (adapter completeness + one policy).  
2. **`fix/w7-cost-sheet-evidence`** — P0.3.  
3. **`fix/placeholder-guard-narrow`** — P1.3.  
4. **`fix/w1-allowed-facts-tests`** — P1.2.  
5. **`fix/w6-ratelimit-audit`** — P1.1 (+ Desk only if a field/endpoint already exists; else appendMessage).  
6. **`fix/w8-project-alias-index`** — real W8 (P0.1); after 1–2 so baselines are cleaner.  
7. **`feat/w9-regression-gate`** — P1.4.

Optional drive-by in any focused PR: `!ex.holdAsk` on `bareAffirm` (P2.3).

---

## 7. Explicit non-goals for cleanup

- Do **not** introduce a Durable Object rate limiter (LLD rejected; upgrade path remains behind `ingress-guard.ts`).
- Do **not** add compose regexes / banned-phrase growth as the primary fix for identity or pricing.
- Do **not** replace rich LLM facet answers with thinner templates outside existing template-locked goals.
- Do **not** mark W8 or W9 complete based on `#60` or existing unit CI.

---

## 8. Quality / regression checklist (every cleanup PR)

- [ ] Design note posted before code (layer / why / why-not / consumers / scenario).
- [ ] Unit tests assert the **happy path**, not only “doesn’t crash.”
- [ ] For hold/visit/affirm: direct `focused.decide` extract-shape test **and** live HOLD soak if decide order touched.
- [ ] Turn-by-turn reply quality vs a known-good report for touched scenarios (pass count ≠ done).
- [ ] No new kernel stage; ports/adapters/compose/verify/persist/ingress only.

---

## 9. One-paragraph share blurb (Slack / PR)

> Audit of ConverseSpine `#54`–`#64` vs the approved W1–W9 LLD: layer contract mostly held; W5/W2/W3/W1-core and hold∩visit fixes are good. Gaps: (1) `#60` is **not** LLD W8 — only a compose “name the project” prompt; real extract alias index still open; (2) W4 one-price-truth incomplete on `getProject`/pricing paths and split by `#64`’s second band helper; (3) W7 never wired `cost_sheet`; (4) W6 drops rate-limited inbound with no Desk audit; (5) W1 missing `allowedFacts` + soft tests; (6) `#64` placeholder `/[…]/i` too broad; (7) W9 not shipped. Cleanup order: W4 all-paths → cost_sheet → narrow placeholder → W1 facts/tests → RL audit → real W8 → W9 gate.

---

*End of audit.*
