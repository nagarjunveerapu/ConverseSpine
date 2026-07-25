# Subject-resolution map — read-before-refactor

Scope: every site that decides **which project a turn is about**, plus the
constraint/facet/filler paths that interact with it. Built by reading the code,
not by inference. Line references are `origin/main` @ `4fe8184`.

Status of the read is tracked at the bottom. The plan is a separate document:
**[SUBJECT_RESOLUTION_PLAN.md](./SUBJECT_RESOLUTION_PLAN.md)**.

---

## ⚠️ How to read this document

**§1–§5 are the first pass, written from reading alone. §6 onward are verified by
executing the code, and they SUPERSEDE §1–§5 wherever the two disagree.**

Three conclusions in §1–§5 were confidently wrong and were only caught by running
the code. Each wrong claim is now struck in place with a pointer, but if you are
skimming: **trust §6+ over §1–§5, and trust the PLAN over both.**

Specifically, and most dangerously — **§4.8 and §5.B told you to delete
`prepareCompareExtracted` branch 4. Do not. It never fires for J7, and it is
load-bearing for the `Compare all N` chip.** See §6.1.

---

## 1. Resolver inventory (19 sites)

| # | site | universe | pinned by | verdict |
|---|---|---|---|---|
| 1 | `facts.ts:426 resolveCatalogNameHit` | **full catalog** | `name-from-scratch:21,27,33` | keep — single-commit contract |
| 2 | `semantic-nlu.ts:135 resolveNamedProjectsFromVectors` | full catalog, τ=0.65 | `compare-intent:137-202` | keep, retune τ |
| 3 | `project_switch.ts:170 filterNamedProjectsByEvidence` | veto only | `name-evidence:57-107` | **keep — the precision floor** |
| 4 | `project_switch.ts:157 nameEvidenceIn` branch B (brand-only) | — | **nothing** | **fix → `'none'`** |
| 5 | `compare-intent.ts:18 prepareCompareExtracted` br.1-3 | named / discussed | `compare-intent:11,34,57` | keep |
| 6 | `compare-intent.ts:42` br.4 (bare compare → shortlist) | lastOffered | **nothing** | **delete** |
| 7 | `compare_resolve.ts:40 resolveCompareProjectIds` | discussed+focus+offered | `compare-intent:110` | narrow |
| 8 | `compare_resolve.ts:77` pool fall-through | lastOffered | nothing | narrow after #1 |
| 9 | `turn.ts:3343 compareIds` (legacy) | discussed, else offered | nothing | **delete** |
| 10 | `facts.ts:469 resolveNamed` | offered+discussed | `extract-authority:179` | fold into #3 |
| 11 | `facts.ts:1304 matchOfferedName` | lastOffered | `extract-authority:161-177` | keep |
| 12 | `facts.ts:1276 detectDetailsPick` | offered+focus | — | fold |
| 13 | `project_switch.ts:286 detectFocusedSwitchIntent` | `poolOf(s)` | `name-evidence:120,127` | keep |
| 14 | `turn-intent/classify.ts:212` | lastOffered, **pre-extraction** | `rti-*` | **bypasses the floor** |
| 15 | `turn-intent/classify.ts:108 resolveProjectId` | lastOffered | — | fold into #14 |
| 16 | `turn.ts:1440 coldNameEligible` | full catalog | `name-from-scratch:43` | keep |
| 17 | `turn.ts:1455 W1 focus bind` | veto to focus | — | keep |
| 18 | `phases/visit.ts:201 deferToProjectAnswer` | named/focus/**offered[0]** | — | narrow |
| 19 | `phases/visit.ts:231 candidatesOf` | 4th pool order | — | fold |

| 20 | `advisor/handle-turn.ts:190` SPA `project_id` | request body | — | door-level; bypasses floor |
| 21 | `advisor/handle-project-detail.ts:46` | request body | — | **read path mutates focus** |

### Two door-level resolvers outside the engine

Both commit focus via `commitTo` **before `runEngineTurn` is ever called**, so
neither passes `filterNamedProjectsByEvidence`. #21 is worse: a GET-shaped
*detail* endpoint writes conversation state and calls `crm.commitProject`.
Opening a card on the board silently changes what the chat is about.

### Four sources of a slug-as-name

| site | fallback |
|---|---|
| `project-cache.ts:31` | `name: projectId` — **fixed in CS #149** |
| `turn.ts:3075` `stubName` | `'this project'` (safe) |
| `handle-turn.ts:204` | `\|\| projectId` |
| `handle-project-detail.ts:44` | `?? project_id` |

### Name-swap bug (new)

`handle-project-detail.ts:41-48`:
```js
const projectName = lastOffered.find(p => p.projectId === project_id)?.name
  ?? state.focus?.projectName      // ← the CURRENTLY focused project's name
  ?? project_id;
state = commitTo(state, project_id, projectName);
```
Focused on A, open B's detail, B not in `lastOffered` → `commitTo(B_id, A_name)`.
Right id, **wrong name**, and `commitTo` → `recordDiscussed` writes that pair into
the pool every later resolver reads.

### Four pool definitions, four precedences

| where | order |
|---|---|
| `compare_resolve.ts:11 projectPool` | discussed → focus → lastOffered |
| `project_switch.ts:274 poolOf` | lastOffered → discussed → focus |
| `facts.ts:469 resolveNamed` | lastOffered + discussed (**no focus**) |
| `visit.ts:231 candidatesOf` | discussed≥2 → focus → discussed[0] → lastOffered |

### Ten brand-strip implementations, three strategies

Positional `tokens.slice(1)`: `project_references.ts:22`, `project_switch.ts:152`
String `replace(/^\S+\s+/)`: `project_switch.ts:249`
**Hardcoded** `/^(brigade|lokations)\s+/i`: `facts.ts` ×8 (433, 457, 483, 953, 957,
1286, 1313, 1332), `semantic-nlu.ts:338`

Desk already derives these correctly from the builder record
(`builderBrandTokens`). CS does not use it.

### Hardcoded catalog list

`semantic-nlu.ts:235` gates on eleven literal project names
(`ayana|krishnaja|brigade|greens|eldorado|cornerstone|utopia|exotica|orchards|neo|vanam`)
— seven lines below the comment *"Never gate on a hardcoded catalog list; vectors
resolve identity."* Tenant-specific to naya-advisor.

---

## 2. Verified mechanisms

| defect | mechanism | evidence |
|---|---|---|
| `{{7*7}}` → ₹7 L | `parseBudgetToInr:577` bare-digit guard is `words > 5`; input is 3 tokens → `toInr(7,'')` → `n<100` → ₹7,00,000 | read |
| `"not in a rush"` → `*rush*` | `extractLocation:1204` `inTail` grabs `"a rush"` → `trimLocalityStops` peels `a` → `"rush"` not in `LOCALITY_STOP` | read |
| `"just do it"` → `*do*` | no `in\|near\|at` → bare branch `:1252` → peels `just`,`it`; `do` not a stopword | read |
| possession → config dump | `semantic-nlu.ts:32` maps `ask_delivery_timeline → 'availability'`, whose evidence is unit configs. No `possession` topic exists in `TOPIC_PATTERNS` | read |
| ₹1.2 Cr → ₹28 L plots | `discover.ts:283` filters on **starting** price with no floor | read |
| J7 wrong compare | ⚠️ **THIS ROW IS WRONG — SUPERSEDED BY §6.1.** It said branch 4 fires. Branch 4 **never runs**: `isCompareAmongOfferedTurn` is `\bcompare\b`, which does not match `"comparing"`. The real path is `resolveCompareProjectIds:68-78` returning the conversation pool. **Do not delete branch 4** — it is load-bearing for the `Compare all N` chip. | corrected |
| goodbye → deletion prompt | `turn.ts:943 applyIntentAuthority` writes `ex.stop` when embedder binds `opt_out` above τ and no other owner claims it. `STOP_RE` is not involved | read |
| compare guard didn't help | `needsStructuredRepair:3448` detects it; remedy at `:1773` is `fallbackReply(req)` — the same template that produced it | read |

### The amplification loop

`applyGoalToState:3374` writes the **compare matrix's** projects into
`discussedProjects`. `resolveCompareProjectIds` and
`discover.ts:427 offeredDetailGoal` both *prefer* `discussedProjects`.
`state.ts` has `recordDiscussed` and **no removal** — it only grows (cap 6).

So one wrong comparison promotes its wrong projects to the highest-priority
source for every later turn.

---

## 3. Structural findings

- **Micro-markets are passed past the extractor.** `turn.ts:426` loads
  `catalogForNlu.microMarkets` every turn and hands it to `extractTurnAuthority`,
  which forwards it to `semantic.enrich` only. `extractFacts` → `extractLocation`
  never receives it. `ExtractLocationContext` has no micro-markets field.
- **Three locality validators, zero allowlists** — `LOCALITY_STOP`/`isLocalityNoise`
  (facts), `locationLooksPolluted` (facts), `isPlausibleLocation` (state.ts:319).
  All blocklists. None consults the served-area registry.
- **The taught lane is subordinate to the regex ladder.** `faq-keys.ts:271`
  `taughtFaqKey` returns `undefined` whenever `resolveFaqQuestionKeys(text)`
  matches — so ~50 hand-written regexes always outrank a human-taught bind.
- **Three producers of "I don't understand" copy** — `discover.decide:142`
  (`clarify_intent`), `shouldSurfaceUnknownIntent` → `speakFailure`,
  `classifyTurnIntent:293` → `defaultProbePrompt`. Three fixes, not one.
- **14 early-return exits** in `runEngineTurn` before goal selection.
- **`ex` rewritten 11 times** between `turn.ts:459` and `:612` by independent
  predicates; order is the specification.
- **Four constraint-deletion sites** — `permissions.ts:53` (location+propertyType
  on answer acts), the junk-locality purge, `applyExtracted` guards,
  `applyTurnIntentResult` clears.
- **Dead code** — `facts.ts:660 detectShownName` always returns `undefined`;
  `negatesShown` is permanently false, `rejectedName` never set.

---

## 4. Corrections to the 2026-07-25 post-mortem (nine)

1. The precision floor **exists and is global** (`scrubEmbedderIdentityNoise:446`) —
   not "no owner".
2. `nameMentioned` does **not** match brand tokens (`project_references.ts:22`
   drops the first token).
3. Identity resolution is **not crude** — typo tolerance, superset specificity,
   pool-beats-global arbitration.
4. `STOP_RE` is **not** the opt-out culprit; the embedder is.
5. "Wire routing into goal selection" is **wrong** — `intent-authority.ts`
   deliberately argues against it and uses `unmapped_kind` as the seam.
6. `clarify_intent` is a **deliberate honesty floor**, not an oversight.
7. There **is** a `possession` FAQ key; the gap is the topic map, not the corpus.
8. ⚠️ **THIS CORRECTION WAS ITSELF WRONG — see §6.1.** It claimed J7's cause is
   `prepareCompareExtracted` br.4 rather than the `resolveCompareProjectIds`
   fall-through. My *original* attribution was right: the fall-through at
   `compare_resolve.ts:68-78` is the cause, verified by execution.
9. The tests are **better** than claimed — `name-evidence`, `location-pivot`,
   `name-from-scratch` are genuine property suites. The accurate statement:
   *the property suites have holes exactly where the defects are.*

---

## 5. Changes defensible today

> **⚠️ This section is SUPERSEDED. Change B below is wrong and must not be
> executed. The live plan is [SUBJECT_RESOLUTION_PLAN.md](./SUBJECT_RESOLUTION_PLAN.md).**

**A. `nameEvidenceIn` brand-token branch → `'none'`** (`project_switch.ts:157`)
Still correct in direction, but **superseded in mechanism** by PLAN PR-1(a):
rather than special-casing the brand token, distinctiveness is computed from the
catalog (a token is distinctive iff it appears in exactly one project name), which
removes the brand token as evidence *and* fixes `greens`, `Viva`, and short
distinguishing words in the same change.

**B. ~~delete `prepareCompareExtracted` branch 4~~ — WRONG, DO NOT DO THIS.**
Two independent reasons, both verified:
1. Branch 4 **never fires for J7** — `isCompareAmongOfferedTurn` is `\bcompare\b`
   and the input is `"comparing"` (§6.1, §6.6).
2. Branch 4 **is load-bearing**: the hand-authored `Compare all N` chip
   (`nba.ts:157`) carries no `action_id` (`nba.ts:319`), so a tap returns as free
   text and branch 4 is what resolves it.

The `engine.test.ts` analysis below was sound about *those* tests, and still
missed both facts — a reminder that "no test covers it" is not the same as
"nothing depends on it."

- `:429` *"resolveCompareProjectIds binds 'both' to last bot listing"* calls the
  resolver **directly**, bypassing `prepareCompareExtracted`, and resolves via the
  anaphora→recentMessages path — not the pool fall-through.
- `:406` Coorg funnel `"compare ayana and krishnaja greens"` contains `and`, so
  branch 4 is already skipped by its own guard.
- `:284` passes `compareProjectIds` explicitly.
- `:453`,`:496` `detectFocusedSwitchIntent` cases both carry the **full**
  distinctive name → branch A.

### The shared flaw in code *and* tests

Every locality/identity guard enumerates **known-bad**; none validates against
**known-good**:

| suite | negatives it enumerates | never tested |
|---|---|---|
| `engine.test.ts:34` | brief chips, day words, decline, project names | arbitrary tokens (`rush`, `do`, `tower`) |
| `name-evidence:40` | three real buyer lines | brand-only |
| `location-pivot:66` | `no`, `nahi chahiye`, `yes please` | arbitrary tokens |
| `compare-intent` | `both`, `dono`, `these` | possessives (`their`) |

The code does the same: `LOCALITY_STOP` (60 words), `isPlausibleLocation`,
`locationLooksPolluted` — three blocklists, zero allowlists — while the
served-area registry travels past the extractor at `turn.ts:426`.

**One root cause, expressed twice.** The blocklists can never close; the allowlist
is already in the call.

**Not yet defensible:** returning multiple hits from `resolveCatalogNameHit`
**breaks `name-from-scratch:38` on purpose** (`'compare Oasis and Eldorado' → null`,
comment: *"two distinct names named at once → ambiguous"*). The correct shape is a
**second** function for the compare path, leaving #1's contract intact.

---

## 6. The catalog, and what it proves

Queried `naya-db-dev`, `builder_id='naya-advisor'` — 21 projects. Running each
name through `project_references.ts` `nameTokens` (split on non-alphanumeric,
**keep tokens ≥5 chars**) and `distinctiveTokens` (`tokens.length > 1 ? slice(1) : tokens`):

| name | tokens | distinctive |
|---|---|---|
| Ayana | `ayana` | `ayana` |
| Brigade Cornerstone | `brigade, cornerstone` | `cornerstone` |
| Brigade Cornerstone Utopia | `brigade, cornerstone, utopia` | `cornerstone, utopia` |
| Brigade Eldorado | `brigade, eldorado` | `eldorado` |
| **Brigade Sanctuary** | `brigade, sanctuary` | `sanctuary` |
| Brigade Northridge Neo | `brigade, northridge` | `northridge` (`neo` dropped, 3 chars) |
| **Krishnaja Greens** | `krishnaja, greens` | **`greens`** |
| **Viva Greens** | `greens` (`viva` dropped, 4 chars) | **`greens`** |
| My-Sooru | `sooru` | `sooru` |
| Vanam | `vanam` | `vanam` |

### 6.1 J7 — I had this wrong twice; here is the actual path

Input: `"comparing Eldorado and Sanctuary"` → compared Ayana / Desire Spaces / Vanam.

**Both named projects are real catalog rows.** Brigade Eldorado and Brigade
Sanctuary exist, and both carry unambiguous distinctive tokens.

- `isCompareAmongOfferedTurn` returns **false** — every regex is `\bcompare\b`,
  which does not match `"comparing"` (no boundary between `e` and `i`).
  So `prepareCompareExtracted` returns `ex` untouched at `compare-intent.ts:23`.
  **Branch 4 never runs.** My earlier attribution to branch 4 was wrong, and
  deleting branch 4 would have broken the `Compare all N` chip (`nba.ts:118`)
  without touching this bug.
- `resolveCompareProjectIds` (`compare_resolve.ts:40`) then runs.
  `GENERIC_COMPARE_RE` also misses `"comparing"`; `ex.askTopic === 'compare'`
  carries the turn (the semantic layer reads it fine).
- `fromRefs = resolveProjectReferences(text, recent, pool)` where
  `pool = discussed → focus → lastOffered` — **the catalog is never in the pool.**
  Eldorado and Sanctuary were not in the conversation pool, so `fromRefs = []`.
- `compare_resolve.ts:68-78`: `pool.length >= 2 && askTopic==='compare' && fromRefs.length === 0`
  → `return uniqueIds(pool)` → **Ayana, Desire Spaces, Vanam**.

**Root cause, stated exactly:** name matching for compare is scoped to the
conversation pool, and the *fallback* is the same pool. `fromRefs.length === 0`
means two different things — "the buyer named nothing" and "the buyer named
projects I could not resolve" — and `resolveProjectReferences` returns `P[]`
(matches only), so it has no channel to distinguish them. The buyer named two
real projects and got three others.

### 6.2a The precision floor endorses the embedder on a preference word

Measured on `filterNamedProjectsByEvidence(text, [Krishnaja Greens, Viva Greens], pool=[])`:

| buyer text | floor verdict |
|---|---|
| `and krishnaja greens?` | `[Krishnaja Greens]` ✓ — the existing test's case |
| `show me the greens` | **`[Krishnaja Greens, Viva Greens]`** |
| **`I want green spaces`** | **`[Krishnaja Greens, Viva Greens]`** |
| `greenery matters to me` | `[]` ✓ |

The floor is a **veto** layer — it can only pass through what the embedder
proposed. So the live path is: buyer says *"I want green spaces"*, the embedder
plausibly proposes Krishnaja Greens, and the floor — whose entire job is to
catch exactly that hallucination — scores it **`full`** and endorses it.

This is the mechanical location of the long-open *green → plantation* bug.
`name-evidence.test.ts` already pins the Viva/Krishnaja pair, but only for
`"and krishnaja greens?"`, where the distinguishing token is present. The
preference phrasing is uncovered.

**Two shipped fixes compose into it.** `discover-implicit-pick.test.ts` encodes
the `name-beats-filters` rule: *"A single high-confidence PROJECT_VECTORS hit
means the buyer NAMED that project — it must commit, not run a search."*
Chain it with 6.2a:

1. buyer: *"I want green spaces"*
2. embedder proposes its top hit — Krishnaja **Greens** (semantically reasonable)
3. `filterNamedProjectsByEvidence` scores it **`full`** and passes it (§6.2a)
4. `namedProjects.length === 1` → **commit**

Each fix is correct in isolation and both have passing property tests. The
composition opens a project the buyer never named. Neither suite can see it,
because neither owns the seam.

### 6.2b Three resolvers, three different answers to a bare brand token

| resolver | `"is Brigade a reliable builder"` |
|---|---|
| `resolveCatalogNameHit` (`facts.ts:426`) | `null` ✓ — refuses ambiguity by design |
| `nameEvidenceIn` (`project_switch.ts:147`) | `partial` for **all ten** Brigade rows |
| `resolveProjectReferences` (`project_references.ts:70`) | depends on the ≥5-char filter |

The strictest is the one that never sees the vector proposals.

### 6.2 `greens` — a live two-project name collision

`Krishnaja Greens` and `Viva Greens` reduce to the **same** distinctive token,
`greens`, because the ≥5-char filter deletes `Viva` (4). Consequences:

- `nameMentioned` is `distinctive.some(t => text.includes(t))` → the bare word
  **"greens" matches both projects**.
- `resolveProjectReferences:70-71` returns `direct` (both) with **no
  disambiguation** — see 6.3.
- Any buyer sentence containing "greens" (or "green spaces", "greenery" —
  `includes`, not word-boundary) resolves to two projects at once.

This is almost certainly the same root as the already-logged open bug
*green → plantation*. Any project whose distinguishing word is ≤4 characters
is unaddressable by its own name.

### 6.3 Superset disambiguation is applied to bot replies but not to buyer text

`disambiguateStrictSupersets` correctly separates `Brigade Cornerstone` from
`Brigade Cornerstone Utopia`. It is called from `projectsInListing` (line 58) —
which scans **bot replies** — and **not** from the `direct` path at line 70,
which scans **buyer text**. So the buyer typing "cornerstone" gets both
projects; the same word in a bot reply resolves to one.

### 6.4 A brand token defeats the precision floor

`project_switch.ts:155-159` `nameEvidenceIn` returns `'partial'` for a lone brand
token, directly under a comment saying a lone brand token *is not* evidence.
Executed:

| text | name | verdict |
|---|---|---|
| `is Brigade a reliable builder` | Brigade Cornerstone | `partial` |
| `is Brigade a reliable builder` | Brigade Eldorado | `partial` |
| `cornerstone` | Brigade Cornerstone Utopia | `partial` ✓ (correct) |
| `pricing for eldorado` | Brigade Eldorado | `full` ✓ |
| **`show me the greens`** | **Krishnaja Greens** | **`full`** |
| **`show me the greens`** | **Viva Greens** | **`full`** |

And the consequence at the floor itself:

```
filterNamedProjectsByEvidence(
  'is Brigade a reliable builder',
  [Brigade Eldorado],            // whatever the embedder proposed
  pool = [Brigade Cornerstone],  // the buyer's actual board
) → ["Brigade Eldorado"]
```

**The precision floor admits an off-board Brigade project on the word
"brigade" alone** — for all ten Brigade rows in the catalog. Its stated job is to
veto vector proposals the buyer did not name; a brand token defeats it.

`detectFocusedSwitchIntent('is Brigade a reliable builder', …)` returns `null`,
so this is not a *switch* — it is the veto failing to fire on whatever identity
the extractor already carried into the turn.

Note the layer split: `filterNamedProjectsByEvidence` *does* handle
Cornerstone vs Cornerstone Utopia correctly (full beats partial), while
`resolveProjectReferences` (§6.3) does not. Two resolvers, two answers, same
input.

### 6.5 All of §6 verified by execution

Not inferred — run against the real functions:

| claim | result |
|---|---|
| J7: pool = Ayana/Desire Spaces/Vanam, text `"comparing Eldorado and Sanctuary"` | `resolveCompareProjectIds → ["ayana","desire-spaces","vanam"]` ✅ |
| `greens` collision | `resolveProjectReferences('show me the greens', …) → ["Krishnaja Greens","Viva Greens"]` ✅ |
| superset not applied to buyer text | `resolveProjectReferences('tell me about cornerstone', …) → ["Brigade Cornerstone","Brigade Cornerstone Utopia"]` ✅ |
| brand token defeats the floor | see 6.4 ✅ |

### 6.6 The whole deterministic compare lane misses `"comparing"`

Measured across every compare predicate at once:

| text | `isCompareAmongOfferedTurn` | budget-gap `no_fit` allowed | `speechAct` | chip |
|---|---|---|---|---|
| `compare Eldorado and Sanctuary` | true | no | `compare` | `chip.compare` |
| **`comparing Eldorado and Sanctuary`** | **false** | **yes** | **`unknown`** | **none** |
| **`comparison of Eldorado and Sanctuary`** | **false** | **yes** | **`unknown`** | **none** |
| `can you compare the projects` | true | no | `compare` | `chip.compare` |
| `Eldorado vs Sanctuary` | **false** | **yes** | `compare` | `chip.compare` |

Every predicate is `\bcompare\b`, which does not match `"comparing"` — there is no
word boundary between `e` and `i`. So the gerund and the noun form fall through
the entire deterministic lane to `speechAct: 'unknown'`, **and** re-enable the
budget-gap `no_fit` that `shouldAllowBudgetGapNoFit` exists to suppress.

`"Eldorado vs Sanctuary"` shows a third state: `isCompareAmongOfferedTurn` says
no while the speech-act resolver says `compare`. Two layers, same input, opposite
answers.

**This is not a regex to add.** Per the standing embedding-lane rule, a
recognition miss like `"comparing"` belongs to the corpus, and `unknown` is
exactly the below-threshold signal `clarify_intent` was built for. What the code
should not do is let `unknown` fall through into a *pool-guessed* compare (§6.1)
or a budget `no_fit`.

---

## 7. Adapter + cache findings (`nayadesk.ts`, `project-cache.ts`)

### 7.1 Two starting prices for one project, depending on which path served it

`nayadesk.ts:318` (context path) computes `startingPriceDisplay` from **config
minimums** — the documented "ONE starting-price truth". `nayadesk.ts:353`
(the `getProject` fallback, used whenever Desk's focus is a different project)
has no configs, so it renders the **coarse band**.

Then `project-cache.ts:47`:

```js
return configurations.length ? { ...detail, configurations } : detail;
```

It grafts real config prices on **without recomputing `startingPriceDisplay`**.
The resulting object carries a band-derived headline price and config-derived
unit prices simultaneously. Compose renders whichever slot it reaches. This is
the mechanical cause of the price contradiction seen in the transcripts.

### 7.2 Two more slug-as-name sources (six total)

`nayadesk.ts:381` (`pricing`) and `:431` (`landedCost`) both end
`name = p?.name?.trim() || projectId`. These feed `pricing.projectName`, which
compose renders directly.

### 7.3 Junk localities are written through to Desk

`nayadesk.ts:820`: `updateFacts` sends `location_pref` to
`applyStateWrites → set_slot location`. The extractor's junk (`rush`, `do`)
does not stay in conversation state — it lands in Desk's slot store.

### 7.4 `prefetchProjects` never upgrades a thin card

`project-cache.ts:79` `if (cache[projectId]) continue;` short-circuits before
`hydrateProjectDetail`, so an `identityOnly` card is only upgraded by the
focused path, never by prefetch.

### 7.5 Telemetry is hardcoded to success

`nayadesk.ts:907`: `postChoiceEvent` always sends `engine_status: 'ok'`.
Desk's choice analytics — and therefore the understanding board — cannot see a
failed turn.

---

## 8. Chip loop (`nba.ts`)

Chips are labelled from `lastOffered` / `focus` names (`:118`, `:134`, `:167`,
`:172`, `:199`). Hand-authored chips carry **no `action_id`** (`:319`), so a tap
sends the **label as free text** back through the extractor.

**Closed loop:** a wrong name in `lastOffered` (from the `handle-project-detail`
name-swap, or any slug source in 7.2) is rendered as a chip, tapped, re-extracted,
and re-resolved — laundering the bad identity back into state as if the buyer
had typed it.

Also: `nba.ts:335` tests `state.phase === 'visit'` first, so every answer turn
during the visit phase shows the visit board regardless of the topic asked.

---

## 9. Telemetry cannot see failure — anywhere

Every Desk adapter method is `try { … } catch { return null }`. That is correct
for the *reply* (honest absence beats a thrown turn). But nothing downstream
records that a fetch failed:

| writer | field | value |
|---|---|---|
| `ledger-write.ts` `tool_runs` | `success` | **`true`, hardcoded**, for every tool |
| `nayadesk.ts:907` `postChoiceEvent` | `engine_status` | **`'ok'`, hardcoded** |
| `journey-signals.ts` | `projects_compared` | `Math.max(discussed, offered, **2**)` — floor of 2 even when the compare failed |

So a Desk 500 during `pricing` is logged as a **successful** `pricing` tool run,
in a turn recorded as `engine_status: 'ok'`. **No store distinguishes "the project
has no price" from "the price fetch failed."** That is the single instrument you
would use to ask *why* an answer was wrong — and it reports both as success.

The log that *does* carry what is needed — `observability/turn-log-snapshot.ts`,
which records `named_projects` as `id:name` pairs, `switch_intent`, and full
`extract_provenance` — is wired to `deps.emitTurnLog`, **wrangler dev only**
(`ports.ts:370`). It does not run on the deployed worker.

This is why the same class of bug keeps being re-found: the evidence needed to
tell these failures apart is discarded at the moment it exists.

### 9.1 Where a junk locality *would* go — superseded by §13.1

`journey-signals.ts` `constraintFactCount` counts `c.location` truthy, so a
locality that reaches durable state propagates to the buyer's prefs tray
(`map-response.ts:131`), Desk's slot store (`nayadesk.ts:820`), and
`goal_known: true` → lead stage.

**Measured: it does not reach durable state.** See §13.1 — the geography
authority drops it first. This section describes the blast radius *if* a junk
value ever gets past that gate, not an observed live chain. Keep it as the
reason the gate matters, not as a defect.

`types.ts:594` states the principle — *"never the buyer's raw values: a location
capture may be dialogue noise, and echoing noise back is its own defect"* — and
§13.2 is the one place that still violates it.

---

## 10. 1,611 lines of src are a second, unwired bot

Reachability from every entrypoint (`src/index.ts`, `src/cli.ts`,
`src/script-demo.ts`, `src/eval/cli.ts`, `src/chat-repl.ts`):

| | lines |
|---|---|
| reachable from the worker | 26,426 |
| demo-only | 479 |
| eval-only | 1,002 |
| repl-only | 119 |
| **unreachable from anything** | **1,611** |

The unreachable set is not scraps — it is a complete parallel bot:

| module | lines | what it is |
|---|---|---|
| `experience/copy.ts` | 316 | a second copy layer |
| `compose/render.ts` + `compose/templates.ts` | 331 | a second composer + grounding verifier |
| `tools/registry.ts` + `tools/search-fallback.ts` | 293 | a second tool layer |
| `nlu/extractors.ts` `pipeline` `classifier` `embedder` `intents` | 344 | a second NLU |
| `turn/decide.ts` | 167 | a second turn decider |
| `graphs/objection.ts` `graphs/visit.ts` | 78 | a second phase graph |
| `llm/composer.ts` | 82 | a second LLM composer |

(`nlu/canonicalize.ts` and `nlu/intent-projection.ts` **are** live — the `nlu/`
directory is mixed, which is why grepping it is misleading.)

It typechecks, so it costs CI, and — the real cost — **it reads as the system.**
Searching for "the composer" or "the NLU" returns two answers and only one runs.

### 10.1 And 208 test lines / 18 passing tests cover it

`tests/spine.test.ts` imports `experience/copy`, `compose/render`, `turn/decide`,
`nlu/extractors`, `graphs/objection` — every one unreachable from the worker.
18 tests pass on every `npm test` and guard nothing that executes.

**Deletion candidate #1: 1,611 src lines + 208 test lines, zero behaviour risk.**

---

## 11. Checked and clear (recorded so it is not re-investigated)

- `buildPendingPrompt` `chip_ids` vs `nba.ts` chip labels for
  `clarify_project_pick` / `shortlist_answer` — **agree**. Both derive from
  `matchesFromLastOffered(s)` (`turn.ts:3324`, `fetchShortlistAnswer:2723`).
- BAML is not a project resolver: no project field in the schema, `shadow` by
  default, `turn.ts:201` requires `promote` to apply.
- `handle-turn.ts:156-186` priority probe early-returns before the engine —
  by design, not a bug (it does bypass the chip ranker).
- `disambiguateStrictSupersets` correctly separates
  `Brigade Cornerstone` / `Brigade Cornerstone Utopia` — the flaw is that
  `resolveProjectReferences:70` never calls it (see 6.3).

---

## 12. Shadow and live rankers read different evidence

**Retracted:** I claimed #149's `faqs` strip silenced the amenities/media chips.
It does not. Measured — `buildAdvisorNba` with `chipRankLive`, focused on one
project, three cache states:

| `state.projectCache.cs` | chips |
|---|---|
| absent | `Unit configurations · Starting prices · Show me more projects · Legal status · Back to my matches · Refine my brief` |
| present, **no** `faqs` | *identical* |
| present, **with** `faqs` | *identical* |

`Amenities` / `Photos & floor plans` are absent in all three: at this state the
transition table's four content slots never reach them, so availability is not
the binding constraint. No regression.

**What is real** is the source divergence:

- `nba.ts:273` (live) builds `ChipEvidence.focused` from **`state.projectCache[focusId]`**
- `chips/shadow.ts:49` (the measurement) builds it from **`evidence.detail`**

`nba.ts:266` claims they are "the same evidence the shadow log used, so the live
ordering matches what shadow mode measured." They are not the same object:
`projectCache` may be absent, `identityOnly`, or (post-#149) faqs-stripped on a
turn where `evidence.detail` is complete. `TurnDebug` carries no evidence
(`types.ts:753`), so `buildAdvisorNba(state, debug, …)` structurally *cannot*
see what shadow mode saw. The 85.4% top-3 figure was measured on an input the
live ranker does not receive.

Latent, not currently biting — but it is the kind of drift that makes a
measurement stop meaning what it says.

`nba.test.ts` never sets `projectCache`, so the suite exercises only the
`focused === undefined` branch and could not detect either version of this.

---

## 13. The locality gate exists, is correct, and is exempted on exactly the turns that need it

**Correction to my own earlier remedy.** I had proposed feeding the served-area
allowlist into `extractLocation`. That is wrong twice: it contradicts the
documented design (`locality-validation.test.ts`: *"the geo registry owns
served-area truth, not a hardcoded map here — the engine extracts the buyer's
word as-is and lets Desk resolve it"*) and it would bake places into the engine.

The right mechanism already exists. `geography-authority.ts:22`
`resolveDurableLocation` — *"The only boundary that may approve a location for
durable search state. Desk owns place truth."* It returns
`{ ok: false, failure: localityFailure() }` when Desk says `unresolved`, and
deliberately fails open on `unavailable` (transport outage ≠ invalid place).

It is called from `turn.ts:682` behind `deps.failureSearch`
(`FAILURE_SEARCH = "true"` in `[env.dev.vars]`, `wrangler.toml:78` — on for dev).

### 13.1 The junk never reaches durable state — I was wrong about that

Measured, not reasoned. Real `runEngineTurn` against `fakeDeps` with
`failureSearch = true`:

| buyer text | `extractLocation` alone | `state.constraints.location` after the turn |
|---|---|---|
| `2 BHK under 80L, not in a rush` | `"rush"` | **undefined** |
| `landlord evicting us in 3 weeks, need 2 BHK under 80L` | `"3 weeks,"` | **undefined** |
| `just do it` | `"do"` | **undefined** |
| `Buy, 70 lakh, 2 BHK` | `"Buy"` | **undefined** |

So §9.1's chain (junk → Desk slot store → `goal_known` → stage) **does not fire
for these inputs.** The `else` branch at `turn.ts:716` runs
`matchServedMarket(candidate, catalog.microMarkets)` — the served-area allowlist
*is* wired, one layer below the extractor — and drops what neither Desk's
resolver nor the catalog recognises. Rows 2–4 above dropped cleanly and the turn
recovered to `recommend`.

### 13.2 The real defect: it isn't stored, but it is *spoken*

Row 1 of the same run:

> goal: `no_fit` — *"I don't have apartments in **\*rush\*** — I have apartments
> in Bengaluru, Hassan, and Kodagu. Want to look there?"*

Desk said `unresolved`. The served-market list said no. **Both authorities said
no and the code spoke it anyway**, because of the third branch at `turn.ts:759`,
gated on `looksLikePlaceFramedAsk`. That predicate is the whole of
`place-frame.ts`:

```js
export function looksLikePlaceFramedAsk(text: string): boolean {
  return /\b(?:in|near|around|at|within|mein)\s+[a-zÀ-ɏ]/i.test(text);
}
```

Any sentence containing the word **"in"** followed by a letter is a
"place-framed ask" — `"not in a rush"`, `"interested in buying"`,
`"I'm in the market"`, `"look at this"`. When that fires, the buyer is told a
fragment of their own sentence is not a place, **and their actual brief
(2 BHK, under 80L) is never searched** — the turn ends as `no_fit`.

**Remedy shape:** the outside-served reply should require a candidate that is
confidently place-*shaped*, not a preposition somewhere in the sentence. The
signal is already fetched in that same branch — `deps.data.resolveGeo(asked)`
(`turn.ts:768`, currently used only for ordering). Geocodes → a real place we
don't serve (Gurgaon) → outside-served is right. Does not geocode → not a place
→ drop and continue, which is exactly what rows 2–4 already do.

**Fixture caveat:** `fakes.ts:396` `resolveGeo` returns `null` for Gurgaon, so
`failure-search.test.ts`'s Gurgaon case would need the fake geocoder to model the
real one. The fake's deliberate omission is of `resolveLocation` (so
outside-served comes from the live catalog, not a hardcoded metro list) —
`resolveGeo` returning null for a real city is the fixture asserting something
untrue about the real dependency.

### 13.3 The pattern this belongs to

| capability | exists at | not reaching |
|---|---|---|
| whole-catalog name index | `EngineData.projectNames` (`ports.ts:108`, built for exactly this by AB-6/W8) | `compare_resolve.projectPool` (`:11`) |
| Desk geocoder verdict | `deps.data.resolveGeo` — **already awaited in the same branch** (`turn.ts:768`) | the decision to speak the candidate as a place |
| project content coverage | Desk `content_gaps` / min-pack | `ChipEvidence` availability (§12) |

**Not missing capability — unthreaded capability.** In each case the right data
is already in the same call frame and does not reach the decision.

---

## 14. Read status

| | read | total |
|---|---|---|
| **src (blast radius)** | **13,730** | **13,730 — 100%** |
| tests | ~5,000 in full; all 110 files inventoried | **13,275** (not 5,601 — that was a surveyed subset) |

**Tests read in full:** `engine` (646), `failure-search` (384), `journey-signals`,
`speech-act-resolve` (244), `turn-intent` (229), `extract-authority` (221),
`compare-intent` (214), `facet-resolve` (200), `multi-intent`, `shortlist-answer`
(178), `name-evidence` (164), `discover-implicit-pick` (160),
`project-identity-never-slug` (149), `project-switch` (134), `extract-funnel`
(110), `clarify-intent` (75), `chip-owns-its-turn` (72), `name-from-scratch` (64),
`ingress-guard` (43), `locality-validation` (39), `facet-name-residue` (39),
`project-bind-integrity` (33), `project-embed` (33), `name-project-rule` (30),
`location-pivot` (92), plus the earlier survey.

**Verdict on the suites so far:** these are genuine property suites, not
patch-encodings. Every defect found this session is in a *seam between* two
correct, well-tested modules — which is exactly what per-module property tests
cannot see.

Beyond the blast radius, the rest of src is accounted for structurally by the
reachability analysis in §10 (1,611 lines dead, 1,002 eval-only, 479 demo-only).

**tests outstanding:** `engine.test.ts` (646, 42 tests) is the highest risk to any
deletion; then the `rti-*` family (~1,180), `nba` (262), `chip-rank` (238),
`turn-intent` (229), `shortlist-answer` (178), `optout-confirm` (169),
`journey-signals` (332), and the remainder.

**Open, not closed:** `"is Brigade a reliable builder"` → commit-to-Cornerstone.
Traced through `resolveNamed`, `matchOfferedName`, `shouldQueryProjectVectors`
and `nameEvidenceIn` — none produces it; `PROJECT_REF_RE` does not match the
sentence, so the vector path should not fire. `provenance.fields.namedProjects`
in the turn logs would settle it.
