# Failure as a value — LLD

**Status** Phase 0 shipped · Phase 1 implementation in progress
**Author** derived from the six-family persona programme (30 personas, ~550 turns, 2026-07-23)
**Scope** ConverseSpine engine. One NayaDesk read-model addition. No SPA change required for Phase 1–3.

---

## 1. The problem

Six independent persona families reported defects across six cause families.
Current-code archaeology shows this design directly owns four: input contracts,
search relaxation, unsupported routing, and answer delivery. Visit mode-lock,
the Advisor chip-contract gap, emotion handling, and ranking evidence that is
never fetched remain separate work.

> **No stage of the turn can fail. Every component is written to always return
> a value, so nothing can ever be checked.**

A check is only meaningful if failing it can stop something. Since nothing stops,
no check exists — which is why grounding passes while the answer is wrong.
Grounding validates the claims that were made; nothing validates whether any
should have been.

| stage | what it should be able to say | what it does today |
|---|---|---|
| locality extract | "that is not a place" | writes `"Buy"` into `constraints.location` |
| search | "nothing matches your brief" | drops constraints until something matches |
| turn routing | "I do not know this kind of ask" | returns the sales script |
| EMI tool | "you gave me no principal" | amortises the anchored project's price |
| compose | "I do not hold that fact" | emits stamp duty for a price question |
| opt-out classify | "I am not sure you meant that" | offers to delete everything |

### 1.1 Corrected archaeology

`turn.ts:977` — the junk-locality purge:

```ts
if (recFlags.droppedLocation && state.constraints.location) {
  // Junk-locality purge (see fetchRecommend): persisting an unrecognized
  // capture is what made "No exact match for one week. ELEVEN" echo on
  // every later turn.
  const { location: _junkLoc, ...cleanConstraints } = state.constraints;
  state = { ...state, constraints: cleanConstraints };
}
```

The purge is not unconditional. `fetchRecommend` sets `droppedLocation` only
after a zero-result strict search where Desk explicitly returns
`recognized_locations: []`. That correctly protects against junk such as
`"one week. ELEVEN"`.

Two distinct contracts still need measurement:

1. Desk's current `recognized_locations` means serviceable for this builder,
   not merely "valid geography". An unserved real city and dialogue noise can
   therefore both return `[]`.
2. When Whitefield *is* recognized, the current ladder can still show Sarjapur
   after releasing size/budget/area, while compose labels only one dimension.
   In a live probe Whitefield survived in state; the reply was wrong because
   of search relaxation and disclosure, not the purge.

Phase 3 must therefore be designed from Phase 0 traces, not from the stale
claim that Whitefield always dies in the purge. The trace must record the
strict filters, Desk recognition result, each released dimension, evidence
label, and any persistent state mutation.

`"Buy"` is also path-specific. Plain chat does not write it as a location;
the Advisor brief-extract path does. Hardening `extractLocation` alone cannot
close that seam. Geography must be validated at **every write** to
`constraints.location`.

### 1.2 What this is not

This is not a replacement for NLU, safety, catalogue quality, visit routing,
emotion handling, or ranking evidence. It starts after a stage has attempted
its own contract and needs to report whether it delivered.

---

## 2. Design principle

> A stage that cannot do its job returns a **Failure**, not a substitute.
> One owner turns a Failure into words. Failures are recorded.

Three properties fall out, and each maps to a family of defects:

1. **Substitution becomes impossible.** A tool with no principal cannot quietly
   use a different number; it must return `missing_input`.
2. **Silent relaxation becomes impossible.** Dropping a constraint is a Failure
   with a named dimension, and the speaker is obliged to say so.
3. **The sink acquires a floor.** An unrecognised ask is `unsupported`, which
   has words, instead of inheriting the next sales sentence.

---

## 3. The primitive

New file `src/engine/outcome.ts`.

```ts
/** A stage may deliver with disclosed notices, or fail terminally. */
export type Outcome<T> =
  | { ok: true; value: T; notices?: Failure[] }
  | { ok: false; failure: Failure };

export type FailureKind =
  /** The subject is not the kind of thing it was taken for. "Buy" is not a place. */
  | 'unresolvable'
  /** Real and understood, but we hold nothing for it. Carpet area. */
  | 'no_data'
  /** Real, understood, held — but not within the buyer's constraints. */
  | 'no_match'
  /** A constraint had to be released for any result to exist. */
  | 'relaxed'
  /** A recognised ask this product does not do. CAGR, discounts, caste filters. */
  | 'unsupported'
  /** Required input absent. EMI with no principal. */
  | 'missing_input'
  /** Understood two ways and the branches differ in consequence. */
  | 'ambiguous';

export interface Failure {
  kind: FailureKind;
  /** Which owner could not fully deliver: extract, route, search, tool, compose, gate. */
  stage: FailureStage;
  /** Machine subject: 'locality', 'carpet_area', 'emi.principal', 'rera_complaints'. */
  subject: string;
  /** Constraint dimensions released or blocking, for `relaxed` / `no_match`. */
  dimensions?: RelaxedDimension[];
  /** The nearest real thing, when one exists. Drives the recovery half of the sentence. */
  nearest?: { projectId: string; name: string; display: string };
  /** Free-form, never buyer-facing and never durable. */
  detail?: Record<string, unknown>;
}

export const ok = <T>(value: T, notices: Failure[] = []): Outcome<T> =>
  ({ ok: true, value, ...(notices.length ? { notices } : {}) });
export const fail = (f: Failure): Outcome<never> => ({ ok: false, failure: f });
```

`RelaxedDimension` already exists in `types.ts` and is reused verbatim.
Durable summaries contain only `{kind, stage, subject, dimensions}`. `nearest`
may drive the reply in memory but is not written to the ledger; `detail` is
always internal.

**Why a new type rather than `undefined`.** `undefined` is what the code uses
today and it is exactly the ambiguity that caused the purge bug: absent and
unresolvable and unserviceable are three different states sharing one
representation.

---

## 4. Seam by seam

### 4.1 Locality — validate every write

**Today** location can enter state through regex extraction, semantic
backfill, BAML/brief extraction, Advisor preferences, and recovery patches.
The `"Buy"` defect is confirmed on the brief-extract path, not ordinary chat.

**Change**

- Keep each extractor responsible for proposing a candidate.
- Add one geography resolution boundary before any candidate is written to
  `constraints.location`.
- A resolved candidate is accepted with its provenance.
- An unresolved candidate returns
  `fail({kind:'unresolvable', stage:'extract', subject:'locality'})` and never
  reaches state.
- No candidate remains ordinary absence, distinct from an invalid candidate.

The resolver consumes Desk-owned geography: catalogue micro-markets, aliases,
and the area registry. No place names or open-ended stopword list live in
Spine. Every writer — regex, embedder, BAML, brief extract, Advisor ingress,
and recovery patch — must pass the same boundary.

### 4.2 Search and relaxation — `turn.ts:1446 fetchRecommend`, `turn.ts:963`

**Today** the ladder relaxes in code order — location first (`turn.ts:1484`),
then bhk (`1549`), then budget (`1634`). `EvidenceSet.relaxed` is present but
does not capture the ordered search trace. Only the zero-recognition locality
path persistently mutates state; budget and BHK relaxation are per-turn today.
The pensioner loop is repeated relaxation/disclosure, not a deleted ₹70 L
constraint.

**Change**

1. **Relaxation never mutates state.** It is a property of one search, not of
   the buyer's brief. Replace the purge only after Phase 0 distinguishes invalid
   geography from real-but-unserviceable geography. Do not delete its safety
   function before every location writer is validated by 4.1.
2. **Order by hardness, not by code order:**

   - inferred property type may release first
   - size may release before area
   - area may release before budget
   - budget is last and never silent
   - a **declared** property type is a hard filter and is never released

   This preserves AB-2 exactly: its invariant says declared type is hard. The
   pensioner's `"small house"` type was inferred, so releasing it does not
   weaken AB-2.
3. **Persist authority with the constraint.** Turn-scoped
   `ExtractProvenance.fields` is not enough for later searches. Each durable
   constraint must retain declared/inferred authority so the ladder can apply
   the rule after the originating turn.
4. **Budget is never released without saying so**, and `no_match` on budget with
   a `nearest` is preferred to a relaxed result.

**Returns** partial success when broader results are useful:
`ok(evidence, [{kind:'relaxed', stage:'search', dimensions:[...]}])`.
It returns terminal `no_match` only when no honest partial answer satisfies the
contract. Existing `relaxed`, `relaxedLead`, and `no_fit` behavior is absorbed
into this path; it does not run beside it.

### 4.3 Turn routing — `turn-routing/classify.ts`

**Today** an unrecognised ask produces `greet` / `commit` / `recommend` and
inherits the sales script. Verified: injection, a caste filter, a flood-zone
allegation, `"what is BHK"`, CAGR and `"what is ready to move"` all land there.

**Change** add a terminal outcome the classifier may return:

```ts
| { routing: 'unsupported'; subject: string; policy: PolicyClass }
```

`PolicyClass` is a small closed set with fixed consequences:

| class | examples | speaker output |
|---|---|---|
| `prohibited` | caste/religion filter | fixed refusal, never composed |
| `out_of_scope` | CAGR, IRR, discounts, legal artifacts we lack | "I can't do X — here's who can" |
| `definition` | "what is BHK" | plain-language answer from a small glossary |
| `about_us` | "are you a bot", "what data do you collect" | fixed disclosure |
| `unknown` | genuinely unclassified | ask one clarifying question, do not sell |

Note `unknown` is still a Failure with words. Today it is a sales sentence.

### 4.4 Tools — EMI and friends

**Today** the EMI helper computes from the anchored project's price. Verified:
`"emi at 85L 20yr 8.5%"` → EMI on ₹52,00,000, presented as the answer. True
figure on ₹85 L is ~₹73,800/month; it understated by about half.

**Change**

```ts
interface ToolCall<I, O> {
  required: (keyof I)[];
  run(input: I): Promise<Outcome<O>>;
}
```

- A required input absent → `fail({kind:'missing_input', subject:'emi.principal'})`.
- **A number is only a candidate for a slot if its unit fits the slot.**
  `"5-year"` and `"12%"` must not reach the price extractor — verified as
  `budget=₹5 L` and a ₹24 L filter respectively. One guard, two defects.
- Every tool output states the inputs it used. The reply says
  *"on ₹85 L over 20 years at 8.5%"* — a number the buyer can check.
- A buyer-stated EMI amount is a **loan principal** and wins over any focused
  project. A focused-project EMI with no stated principal remains valid, but
  is labelled as an 80% LTV calculation with project price, principal, rate,
  and tenure. With neither source, the tool returns `missing_input`.

### 4.5 Compose — the answer contract

**Today** compose emits whatever the routed bucket holds. Verified: carpet area
does not exist anywhere in the catalogue (0 columns, 0 cost-sheet rows) and the
question returns a stamp-duty block.

**Change** the goal declares what it must deliver:

```ts
interface TurnGoal { /* … */ requires?: FactKey[] }
```

Compose is given `allowedFacts` (already the W1 vocabulary) and **may not emit an
answer that does not contain every `requires` key.** Missing → `fail({kind:'no_data', subject: key})`.

This is the generalisation of the existing honest-miss templates, which today
fire only when a bucket is *empty*. A bucket that is full and wrong never
reaches them.

### 4.6 Destructive intents

**Today** `"I don't want any calls, only chat"` → `goal=handoff` →
*"should I remove your details and stop messaging you? Reply yes and I'll delete
everything."* Reproduced 2/2. The confirm gate does not help when the question
itself is misaligned: a buyer answering the question they think they asked says
yes, and their data is deleted.

**Change** any intent whose effect is destructive (`opt_out`, `delete_memory`)
must clear a confidence bar **and** an unambiguity bar. Below either →
`fail({kind:'ambiguous', subject:'opt_out'})` → the speaker asks a
*disambiguating* question that names both readings:

> "Just so I get this right — do you want me to stop calling and keep chatting,
> or stop contacting you altogether?"

No yes/no question may ever be the gate in front of an irreversible action when
the intent behind it is uncertain.

---

## 5. The single speaker

New file `src/engine/speak-failure.ts`. **One** function turns a `Failure` into
buyer-facing words. Nothing else may phrase a failure.

```ts
export function speakFailure(f: Failure, ctx: SpeakContext): string
```

### 5.1 The sentence grammar

The template already exists in the product and every family independently
pointed at it as the model:

> *"Nothing in Whitefield starts within ₹60 L — closest on your brief is …"*

Two clauses, always in this order:

1. **Name what failed, in the buyer's terms.** The dimension, not the internal
   reason. "Nothing in Whitefield within ₹60 L", not "no_match".
2. **Offer the nearest real thing, or say there isn't one.** Never a pivot to an
   unrelated project.

Worked examples, all from real transcripts:

| situation | today | with this design |
|---|---|---|
| Whitefield @ ₹80 L | "I couldn't match that size" + Sarjapur | "The only Whitefield apartment I have starts at ₹1.05 Cr — above your ₹80 L. Want me to widen the area, or show you what ₹80 L buys nearby?" |
| carpet area | stamp-duty block | "I don't have carpet area on file for this project. I do have built-up sizes and the full cost sheet." |
| caste filter | "No problem." | "I can't filter homes by caste or religion." |
| CAGR | starting-price list | "I don't do market analytics — I can give you current prices and possession dates." |
| flood zone | "Great choice — let's look at Brigade Meadows!" | "I have no flood-zone record for Brigade Meadows either way. Here's the RERA and title status I do have." |
| ready to move | welcome message | "Nothing here is ready to move in three weeks. Closest is Brigade Cornerstone, possession from Dec 2024." |

### 5.2 Why one owner

Verified during the red team: the same exfiltration ask produced a clean
refusal in one run and a project list in another. Refusal wording is currently
LLM-composed, therefore non-deterministic, therefore not a control. `prohibited`
strings are constants and never pass through the composer.

---

## 6. Observability

Failures are the metric. `Failure` is appended to a per-turn array and written
additively inside `action_plan`:

```ts
action_plan.failures = [{ kind, stage, subject, dimensions }]
// never `detail`, raw buyer text, or nearest-project internals
```

This answers questions nothing can answer today:

- how often is a stated budget released, and for whom
- which `subject`s hit `no_data` most (→ the content backlog, already the
  `content_gaps` contract)
- which asks hit `unsupported: unknown` most (→ the teach lane's queue)
- did any turn emit an answer with an unmet `requires` (→ must be zero)

The `unsupported: unknown` stream is the same signal the Understanding board
already consumes. This design feeds it rather than inventing a parallel path.

---

## 7. Rollout

Each phase ships behind a flag, dev first, with the persona set as the gate.

| phase | content | flag | gate |
|---|---|---|---|
| **0** | `outcome.ts`, inert `speak-failure.ts`, safe shadow projection from structured evidence, ledger/local logging, persona fixtures. Nothing changes behaviour. | `FAILURE_LOG` | flag-off payloads unchanged; dev ledger shows evidence-backed failures; direct chat, bot-shaped chat, and Advisor replies match baseline |
| **1** | Tools (4.4) + destructive gate (4.6). The two P0s. | `FAILURE_TOOLS` | EMI states its principal; "only chat" asks a disambiguating question |
| **2** | Routing `unsupported` + policy classes (4.3), speaker live for those classes. | `FAILURE_ROUTING` | caste filter, CAGR, "what is BHK", "are you a bot" all get their fixed sentence |
| **3** | Every-write locality validation (4.1) + authority-aware relaxation and no persistent relaxation (4.2). | `FAILURE_SEARCH` | Whitefield trace identifies the actual released dimension; `"Buy"` never reaches state through any ingress; the pensioner keeps ₹70 L; declared type remains hard |
| **4** | Answer contract (4.5). Highest blast radius, goes last. | `FAILURE_ANSWER` | carpet area declines honestly; zero unmet `requires` in the ledger |

Phase 0 is deliberately inert. It logs only failures already proven by
structured evidence (`relaxed`, structured gaps, FAQ misses). It does not infer
failure from buyer text or low confidence. Ambiguous opt-out, EMI principal
authority, and unsupported routing are instrumented by their owning phases once
their contracts exist.

**Production.** All `FAILURE_*` prod flags stay unset until MVP. Prod has no
users pre-MVP; enabling behaviour there spends risk for no benefit. At MVP,
enable in order — `FAILURE_LOG` first (observability, zero behaviour change),
then `TOOLS` → `ROUTING` → `SEARCH` → `ANSWER`. `FAILURE_ANSWER` is never the
first prod flag: its `no_data` path is invisible without `FAILURE_LOG`. Until
then, soak Phase 4 on **dev only** (where all five flags may be on) and watch
unmet `requires` / over-answer in the ledger.

**Runtime force-off (dev/prod once enabled).** Wrangler vars turn flags on.
`TURN_CACHE` key `runtime:failure_flags` may force individual flags **off**
(JSON `{ "FAILURE_ANSWER": false, ... }` — `false` only; never force-on).
Applied per turn via `engineForTurn()`. Use this to kill a bad soak without a
code change; clearing the key (or setting values other than `false`) restores
wrangler defaults after the next turn.

---

## 8. Test plan

**Unit** — one per seam, table-driven on the real transcripts. The six families
become fixtures: each reported defect gets a case asserting the new sentence.

**Scenario** — `scripts/run-buyer-scenarios.ts` drives
`scenarios/buyer/*.json` with per-turn assertions and writes Markdown/JSON
transcripts under `scenarios/runs/`. Advisor-tagged cases run through
`scripts/run-quality-catalog-AH.ts` or direct `/api/advisor/turn` because the
buyer runner currently posts only to `/chat`. Add `FV-P*-*.json` cases as each
behavior phase becomes live.

**Regression** — the E2 budget-flip-flop persona is the canary: it is the one
conversation that currently works well, and it works *because* it hits the
honest-scarcity path. If any phase degrades E2, that phase is wrong.

**Non-regression on latency** — every phase must leave `debug.timing.total`
unchanged within noise. `speakFailure` is a lookup; nothing here adds a round
trip.

---

## 9. Non-goals

- Analytics (CAGR, IRR, yield). Out of scope by design; Phase 2 makes the
  refusal honest, which is the whole fix.
- NRI and investor content. A content project, not an engine one.
- Empathy or tone. Phase 2 makes "I'm panicking" a recognised ask; what it then
  says is a copy decision, not this document.
- Latency. Separate work — four sequential Desk writes after the reply is
  composed, plus a compounding multi-fact path.
- The chip contract gap (an `action_id` arriving without `input_source`).
  Adjacent, small, tracked separately.

---

## 10. Risks

**More declining reads as a worse bot.** Real. Mitigated by clause 2 of the
grammar — every failure carries the nearest real thing. A decline without a
recovery is a regression and should fail review.

**Relaxation order is a product judgement, not a technical one.** Budget above
area is a claim about buyers. It is one constant, and the ledger will show
whether it was right.

**Phase 4 touches every reply.** Hence last, behind its own flag, gated on the
zero-unmet-`requires` count rather than on a subjective read.

**Fixed refusal strings can be wrong in a way copy review catches late.**
Prohibited-class strings should be reviewed by the founder before Phase 2 ships,
because they are the ones that end up in a screenshot.
