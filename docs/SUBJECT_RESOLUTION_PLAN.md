# Subject-resolution — the plan (Lane A)

Diagnosis lives in [SUBJECT_RESOLUTION_MAP.md](./SUBJECT_RESOLUTION_MAP.md). This
is the prescription. Every section cites the map rather than re-arguing it.

## Scope — what this plan does NOT fix

**This is the identity / compare / locality-speak cluster. It is not a
conversation-quality umbrella.** Approved on that basis (founder review,
2026-07-25). Stated plainly so no one reads a green Lane A as "the dump is fixed":

| genuine failure from the dump | lane |
|---|---|
| J7 wrong compare (Eldorado/Sanctuary → Ayana/Desire/Vanam) | **A** — PR-1 → PR-2 |
| false name commit (`"green spaces"` → Greens projects) | **A** — PR-1 |
| `"not in a rush"` → place `rush` | **A** — PR-3 |
| telemetry lying (`success: true`) | **A** — PR-4 (instrument only, not buyer copy) |
| dead second bot / grep confusion | **A** — PR-0 |
| next-step → greet/clarify | **B** |
| soft openers (`"first home"`, `"most home for money"`) → clarify | **B** |
| legal stuck (RERA/OC → khata repeat / clarify) | **B** |
| possession ask → config dump (`semantic-nlu.ts:32`) | **B** — in the map, not this plan |
| raw slugs in orient copy | **B** |
| Singapore / geo bleed on NRI | **B** |
| sticky shortlist when a facet is asked | **B** |

**Lane B — progression + facets** (separate plan, not written yet): next-step in
context, the possession topic map, legal as a `FactKey`, orient-copy naming.

---

## 0. The rule this plan is built on

I stated three conclusions from reading this session that execution then
overturned (`prepareCompareExtracted` branch 4, the #149 chip regression, junk
localities reaching Desk). Reading a 30,000-line codebase produces confident
wrong answers. So:

> **No change enters a PR without two committed probes: one that fails on `main`
> proving the defect exists, and one that passes after the change proving it is
> gone.**

The defect probe is written and run *first*, against unmodified `main`. If it
does not fail, the defect is not real and the change is dropped. This is the
whole discipline — everything below is subordinate to it.

Second rule, from the map's central finding: **every verified defect lives in a
seam between two correct, well-tested modules.** So every probe is an
*integration* probe across the seam, never a unit test of one side.

---

## 1. Ordering — what forces what

```
PR-1  name tokenizer  ──────► PR-2  compare subject      ◄── the pain, ship first
PR-3  spoken non-place ───────────────► independent (BLOCKED on a Desk check)
PR-4  telemetry        ───────────────► independent (do it when you want instruments)
PR-0  dead code        ───────────────► independent, hygiene, ship anytime
```

**The one hard constraint:** PR-1(a) must land before PR-2. Adding the catalog to
the compare matching pool while `greens` still matches two projects would break
`compare-intent.test.ts:104` (`'compare ayana and krishnaja greens'` →
`['ayana','krishnaja']`), because `Viva Greens` would join every `greens` match.
Map §6.2 / §6.2a.

**PR-0 does not gate anything.** It is hygiene with zero buyer impact. Ship it
whenever it is convenient — **do not hold PR-1/PR-2 behind it** if compare is the
live pain.

**PR-4 is optional-but-useful before PR-2**, not a prerequisite. Doing it first
means PR-2's live verification reads real instruments instead of `success: true`.

---

## PR-0 — Delete the second bot

**What:** remove the 1,611 src lines unreachable from every entrypoint, plus the
208-line `tests/spine.test.ts` (18 passing tests) that covers them.
Map §10, §10.1.

| module | lines |
|---|---|
| `experience/copy.ts` | 316 |
| `compose/render.ts` + `compose/templates.ts` | 331 |
| `tools/registry.ts` + `tools/search-fallback.ts` | 293 |
| `nlu/extractors.ts` `pipeline` `classifier` `embedder` `intents` | 344 |
| `turn/decide.ts` | 167 |
| `graphs/objection.ts` `graphs/visit.ts` | 78 |
| `llm/composer.ts` | 82 |

**Keep:** `nlu/canonicalize.ts` and `nlu/intent-projection.ts` are live. The
`nlu/` directory is mixed — this is why grepping it misleads.

**Why it is first:** it is the only change with provably zero behaviour risk, and
it removes the thing that makes every future search of this codebase return two
answers. It also un-blocks reading: a future session grepping "the composer"
finds one.

**Probe:** the reachability script (already written) re-run after deletion must
report 0 unreachable. `npm test` and `tsc --noEmit` green with 18 fewer tests.

**Not in scope:** `eval/` (1,002 lines, reachable from `npm run eval:quality`) and
the demo entrypoints. Those run.

---

## PR-1 — One notion of "the buyer named this project"

**The defect.** Four different tokenizers disagree about what naming a project
means (map §6.2b, §6.4):

| resolver | `"is Brigade a reliable builder"` | `"I want green spaces"` |
|---|---|---|
| `resolveCatalogNameHit` | `null` ✓ | `null` ✓ |
| `nameEvidenceIn` | `partial` × 10 Brigade rows | `full` for two projects |
| `resolveProjectReferences` | depends on the ≥5-char filter | both Greens projects |
| `matchOfferedName` | — | (3-char tokens match, e.g. `Neo`) |

**The root, stated once:** "distinctive token" is computed as *"drop the first
token, keep tokens ≥5 characters"* — a guess about name shape, made without
looking at the catalog. `Viva` is 4 characters, so `Viva Greens` loses its
actual distinguishing word and inherits the generic one.

### (a) Distinctiveness comes from the catalog, not from a character count

A token is distinctive **iff it appears in exactly one project name in this
tenant's catalog.** Computed per builder from `EngineData.projectNames` — which
already exists and is already fetched (`ports.ts:108`). Generic by construction:
no place names, no brand list, no character threshold. Honors the no-hardcoded-
values rule.

Consequences, all of them desirable:
- `greens` is non-distinctive (2 projects) → neither Greens project matches it alone
- `brigade` is non-distinctive (10 projects) → the brand token stops being evidence
- `viva` becomes distinctive (1 project) → `Viva Greens` is addressable by its own name again
- `neo`, `oak` — short distinguishing words work, because length stopped mattering

**Defect probes (must fail on `main`):**
```
filterNamedProjectsByEvidence('I want green spaces', [Krishnaja, Viva], []) → both
nameEvidenceIn('is Brigade a reliable builder', 'Brigade Cornerstone') → 'partial'
resolveProjectReferences('show me the greens', [], CATALOG) → both
```
**Fix probes:** each of the above → `[]` / `'none'` / `[]`, while
`filterNamedProjectsByEvidence('and krishnaja greens?', …) → [Krishnaja]` still
holds (`name-evidence.test.ts` already pins it).

### (b) Superset disambiguation on the buyer-text path

`disambiguateStrictSupersets` is applied in `projectsInListing` (bot replies) and
**not** at `resolveProjectReferences:70` (buyer text). Map §6.3.

**Defect probe:** `resolveProjectReferences('tell me about cornerstone', [], CATALOG)`
→ `[Brigade Cornerstone, Brigade Cornerstone Utopia]`.
**Fix probe:** → `[Brigade Cornerstone]`, matching what
`filterNamedProjectsByEvidence` already does correctly on the same input.

### (c) The composition guard

Map §6.2a: the floor endorsing a preference word plus the `name-beats-filters`
single-hit-commits rule opens a project the buyer never named. (a) removes the
input to that chain. Add the **seam probe** as a permanent test:

> buyer says `"I want green spaces"` on an empty board, embedder proposes
> Krishnaja Greens → the turn must **not** commit focus.

This is the test neither existing suite could own. It belongs in a new
`tests/seams/` directory — the whole point is that it is nobody's module.

**Blast radius to re-run, not re-read:** `name-evidence`, `project-switch`,
`name-from-scratch`, `compare-intent`, `discover-implicit-pick`, `engine`,
`facet-name-residue`, `journey-signals`. Plus full `npm test`.

---

## PR-2 — "I could not resolve what you named" is not "you named nothing"

**The defect (map §6.1, verified):** pool = Ayana/Desire Spaces/Vanam, buyer says
`"comparing Eldorado and Sanctuary"` — both **real catalog projects** —
`resolveCompareProjectIds` returns `["ayana","desire-spaces","vanam"]`.

Two causes, both needed:

**(i) The type has no way to say it.** `Extracted.namedProjects` carries
successes only; `resolveProjectReferences` returns `P[]`. There is no
representation anywhere for *"the buyer used a project-shaped name I could not
bind."* So `fromRefs.length === 0` means two different things and
`compare_resolve.ts:68-78` picks the wrong one.

Add that state. Minimal shape: the resolver reports unbound name candidates
alongside its hits. Nothing downstream is forced to consume it — but the compare
fall-through must.

**(ii) The catalog is never in the matching pool.** `projectPool` is
discussed→focus→lastOffered. `EngineData.projectNames` exists for exactly this
case (`ports.ts:108`, built by AB-6/W8, doc comment: *"so a project NAMED from a
cold start resolves against the whole catalog, not just the session shortlist"*)
and the compare path does not call it.

**The split that matters:** the catalog joins the pool used for **matching**.
The **fallback** pool stays conversation-scoped. Compare-what's-on-screen must
never become compare-anything-in-the-catalog.

### Behaviour after — clarify is the NARROW case, not the headline

A correction to this plan's first draft, which overweighted clarify. After PR-1,
`eldorado` and `sanctuary` are each distinctive (one project apiece), so with the
catalog in the matching pool **J7 resolves and compares the two projects the
buyer actually named.** That is the win. Clarify is the residue.

| input | after PR-1 + PR-2 |
|---|---|
| `"comparing Eldorado and Sanctuary"` | **compare Eldorado + Sanctuary** ← the fix |
| `"compare ayana and krishnaja greens"` | compare Ayana + Krishnaja (unchanged, pinned at `compare-intent.test.ts:104`) |
| `"compare both"` / `"compare all 3"` | conversation pool (unchanged) |
| name-shaped token binding to **nothing** (`"compare Prestige Lakeside and Eldorado"`) | **clarify** — never the pool |

Probes must assert **all four rows**, not only the clarify one. A change that
turns J7 into a clarify prompt has not fixed J7; it has replaced a wrong answer
with a stall.

### The seam probe must be the live sentence, not a clean compare act

Per §6.6, `"comparing"` resolves to `speechAct: 'unknown'` — that is what a real
buyer turn looks like, and it is the state the resolver is reached in. So the
committed seam probe is the **verbatim free-text sentence through
`runEngineTurn`**, with `speechAct` left `unknown`, asserting the reply names
Eldorado and Sanctuary.

A probe that hands the resolver a tidy `askTopic: 'compare'` would pass while
live turns still fail — the resolver would be fixed and the path to it still
broken.

**Explicitly NOT doing:** deleting `prepareCompareExtracted` branch 4. I proposed
that earlier and was wrong twice — it never fires for J7, and it is load-bearing
for the hand-authored `Compare all N` chip (`nba.ts:157`, which carries no
`action_id` and returns as free text). Map §6.1.

**Explicitly NOT doing:** adding `\bcompar(e|ing|ison)\b`. Map §6.6 — the gerund
falling to `speechAct: 'unknown'` is a *recognition* miss and belongs to the
embedding corpus, per the standing rule. What this PR fixes is that `unknown`
must not fall through into a **pool-guessed compare**. The recognition gap is a
separate corpus item, filed not fixed here.

**Defect probe:** the verbatim sentence end-to-end (`speechAct: 'unknown'`), pool
= Ayana/Desire Spaces/Vanam → asserts the reply currently names three projects
the buyer never mentioned.
**Fix probe:** same call → the reply names **Eldorado and Sanctuary**; plus the
other three rows of the table above; plus `compare-intent.test.ts:104` green.

---

## PR-3 — Stop speaking a fragment of the buyer's sentence as a place

**The defect (map §13.2, verified):** `"2 BHK under 80L, not in a rush"` →

> `no_fit` — *"I don't have apartments in **rush** — I have apartments in
> Bengaluru, Hassan, and Kodagu."*

Desk's resolver said `unresolved`. The served-market list said no. The reply
happened anyway, and **the buyer's actual brief was never searched.**

The gate is the entirety of `place-frame.ts`:
```js
return /\b(?:in|near|around|at|within|mein)\s+[a-zÀ-ɏ]/i.test(text);
```
Any sentence containing the word "in".

**Correction to my own earlier remedy:** I first proposed feeding the served-area
list into `extractLocation`. That is wrong — it contradicts the documented design
(`locality-validation.test.ts`: *"the geo registry owns served-area truth, not a
hardcoded map here"*) and bakes places into the engine. The durable state is
already clean (§13.1, measured `undefined` in all four cases). Only the *reply*
is wrong.

**The fix:** the outside-served reply requires a candidate that geocodes.
`deps.data.resolveGeo(asked)` is **already awaited three lines below**
(`turn.ts:768`, currently used only for ordering). Geocodes → a real place we
don't serve (Gurgaon) → outside-served is correct. Does not geocode → not a place
→ drop and continue, which is exactly what the other three cases already do.

**HARD BLOCKER — no ship without this check.** `fakes.ts:396` returns `null` for
Gurgaon, which is false of the real Desk geocoder. Before this PR, confirm against
`nayadesk-dev` that `resolveGeo` resolves real-but-unserved Indian cities
(Gurgaon, Pune, Mumbai, a tier-2 town). If it does not, gating on `resolveGeo`
would **silence the outside-served reply for genuinely unserved real cities** —
trading a bad reply for a missing one. In that case this fix is wrong as designed
and the PR does not ship; the gate would need a different signal.

**Also read first:** the RTI family (~1,500 unread lines) governs
`pendingPrompt` and recovery, and `no_fit` → `location_broaden` runs through it.

**Defect probe:** the four-input end-to-end table from §13.1, asserting on the
reply text, not just durable state.

---

## PR-4 — Make the instrument tell the truth

**The defect (map §9):** every Desk adapter is `catch { return null }` — correct
for the reply. But:

| writer | field | value |
|---|---|---|
| `ledger-write.ts` `tool_runs` | `success` | hardcoded `true` |
| `nayadesk.ts:907` `postChoiceEvent` | `engine_status` | hardcoded `'ok'` |
| `journey-signals.ts` | `projects_compared` | floored at `2` |

**No store distinguishes "this project has no price" from "the price fetch
failed."** A Desk 500 during `pricing` is recorded as a successful `pricing` tool
run in a turn marked `ok`.

**Fix:** thread the real outcome into all three. The adapters already know —
they are the ones swallowing it.

**Why this matters more than its size:** this is the instrument that would have
answered most of this session's questions from production data instead of from a
30,000-line read. The log that *does* carry what is needed
(`turn-log-snapshot.ts` — `named_projects` as `id:name` pairs, `switch_intent`,
full `extract_provenance`) is wired to `emitTurnLog`, **wrangler dev only**
(`ports.ts:370`). Consider promoting a subset of it to the deployed worker in
this PR.

**Probe:** a turn with a forced adapter failure records `success: false`.

---

## Not in this plan, and why

| | |
|---|---|
| chip shadow-vs-live evidence divergence (§12) | real but **latent** — measured identical output today. It makes the 85.4% figure stop meaning what it says, so it is a measurement-integrity item, not a defect. File it. |
| `prefetchProjects` never upgrades a thin card (§7.4) | correct-but-suboptimal; no observed wrong output |
| two `startingPriceDisplay` sources in one object (§7.1) | **needs a probe before it is planned.** I have read the mechanism but not reproduced the contradiction end-to-end. Do not fix what has not been proven. |
| six slug-as-name fallbacks (§7.2) | `ProjectDetail.name` already documents *"NEVER the projectId."* Worth a sweep, but no live sighting since #149 |
| `handle-project-detail.ts` name-swap (§ resolver #21) | read-shaped endpoint mutating conversation state — real, but it is an **advisor-door** defect, not the engine. Separate PR, separate blast radius |
| "comparing" recognition | embedding corpus item — file for the teach lane, never a regex |

---

## Verification, per PR

1. Defect probe committed and **shown failing on `main`** before any source edit.
2. `tsc --noEmit` + full `npm test` (13,275 test lines — run, not read).
3. Dev deploy, live-verify the actual buyer sentence from the transcripts.
4. HTML report with the conversation, per the standing rule.
5. Held for founder merge. Independent PRs, branched from fresh `main` — no stacking.

## What I have not read, and the risk it carries

~8,300 test lines: the RTI family (~1,500), `failure-routing` (347),
`hold-flow`, `emi-contract`, `visit-route`, `buyer-education`, `optout-confirm`,
and the remainder. These cover subsystems no PR above touches — with **one
exception, called out in PR-3**: RTI owns `pendingPrompt` and the `no_fit`
recovery lane, so I read it before that PR, not before this plan.

For everything else the safety question is answered by *running* the suite, not
reading it. Reading tells me intent; running tells me safety.
