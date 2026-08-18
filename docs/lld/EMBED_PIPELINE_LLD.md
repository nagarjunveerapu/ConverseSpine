# Embedding Pipeline LLD — fill, verify, calibrate, try

**Status:** implemented (this PR). Orchestrator: `scripts/embed-pipeline.mjs` ·
battery: `scripts/embed-pipeline/golden.json` · nightly: `.github/workflows/embed-verify.yml`.

## Why vectors cannot ride the migration pipeline

A D1 migration is a diff in the repo: apply it and the database *is* the new
state, provably, byte for byte. Embeddings break every one of those properties:

| Migrations have… | Embeddings have… |
|---|---|
| The change lives in the repo | The vectors live in Vectorize, outside git |
| Deterministic — same SQL, same result | Model inference — same text, same *space*, but nothing you can diff |
| Read-after-write | Eventual consistency — `vectorCount` lags mutations by minutes |
| Correct = applied | Correct = **statistical** — a graded battery, not a checksum |
| One database | Four indexes, two repos, deploy ORDER matters (1024-dim query vs 768-dim index is a hard error) |
| Rollback = down-migration | Rollback = config revert to the previous index generation (never delete the old index early) |

So the pipeline doesn't imitate migrations; it gives vectors their own four
verbs with the same operational feel:

```
fill       the workers embed & write via their own rebuild routes (never bypass them)
status     what is actually in each index right now (counts, dims, processed-at)
verify     graded golden battery on the DEPLOYED worker — answers, not topics
calibrate  live tau curve per env — because Vectorize scores are lossy per index
try        one phrase through the engine's own routing — the teach loop's "did it take?"
```

## The one rule that makes environments self-healing

Every sync job diffs **content hash / manifest keyed by (text + model + index
name)** — never text alone. This is what turns "prod is empty" into a state
that fixes itself: point a fresh env at a fresh index and the next cron run
sees every row as missing and refills it. The two places this rule lives:

- Desk `projectContentHash` — folds `EMBEDDING_MODEL` into the ledger hash
  (first m3 reconcile synced 0/50 before this; 50/50 after).
- Spine education/intent manifests — keyed per model + index
  (`edu:manifest:v1:${model}`, `intentManifestKey(SIL_INTENT_INDEX)`).

If a future lane adds sync bookkeeping, it must key on the same triple.
`teach-lane-is-dark` is what the other design costs.

## Quality parity dev → prod

Same model, same projection, same corpus — but **not** presumed same behavior:

1. **Counts first** (`status`): ids owed vs ids present, per index. Count ids,
   never counters.
2. **Scores are lossy per index** (`calibrate`): a self-query returns ~0.87–0.90,
   not 1.0, and the loss profile is per-index. The offline taus (0.920/0.822)
   collapsed live coverage to 17% — measured, then re-calibrated live to
   0.8984/0.8557. A tau is only proven on the index it was measured against;
   prod gets its own curve after every space change.
3. **Answers last** (`verify`): the golden battery grades *the answer contains
   the fact* — name bind, Hinglish intent, honest refusal on a nonexistent
   project, education retrieval, off-domain traps that must NOT bind. Nightly,
   on both envs, red on breach.

The probe door that makes 2–3 possible on prod: `/api/sil/probe` and
`/api/sil/embed` now open to `x-bot-secret` when `SIL_EVAL_ENABLED` is unset
(`silEvalAllowed`, tests in `tests/sil-eval-gate.test.ts`). Read-only
measurement; wrong secret stays a 404.

## The teach → try loop (the founder's use cases 1–4)

1. Teach in the web app (understanding board / education entries in Desk).
2. Desk promotes → Spine's `/internal/intent-vector` (single writer) or the
   rebuild routes embed and upsert. Nothing writes vectors except the workers.
3. `try --env dev "the phrase"` — the same `embedderRouting` the engine runs,
   with the verdict at shipped taus spelled out. (The board's Try button and
   this command hit the same probe route.)
4. If it binds: done, no code. If it doesn't: it's a corpus/label/tau gap
   first (embedding-lane rule P7) — add phrasings, re-run `try`. Code only
   when the miss is structural (a new intent kind, a routing seam).

## Model / schema change = new space, never in place

The procedure that was executed for bge-m3, now the standing runbook:

1. New space id (`SIL_INTENT_PROJECTION` hashes the matrix; model in every
   sync hash). Versioned index names carry it: `naya-intent-<space>-…`,
   `naya-project-names-m3`, …
2. Create the new indexes alongside the old — old generation untouched.
3. Backfill: flip the config knob (`SIL_EMBED_MODEL` + index names) on dev;
   the hash rule makes every reconcile/rebuild see stale rows and refill.
   `fill` forces it now instead of waiting for crons.
4. `calibrate` on the new dev index → re-emit taus (`scripts/sil-emit-projection.py
   --tau … --tau-low …` — PROJECTION_ID stays stable, taus don't feed the hash).
5. `verify` green on dev → merge → deploy **Desk before Spine** (the query
   must never be wider than the index).
6. Prod: same knobs point at the prod-generation names; crons self-fill;
   `calibrate` + `verify` on prod before trusting binds there.
7. Soak, then delete the old generation's indexes. Rollback at any point =
   revert the config commit.

A metadata-schema change is the same procedure with a smaller blast radius:
bump the index generation (new name), refill, verify; never mutate metadata
shape inside a live index.

## The measurement key (`SIL_EVAL_SECRET`)

The nightly gate needs to read the engine's verdicts on prod. The obvious way —
give CI `BOT_SHARED_SECRET` — is wrong, and the reason is not abstract:

- Desk's `requireAuth` accepts the bot on an exact match of it, on **every buyer
  turn**;
- Desk's `lib/media_sign.ts` **HMACs signed media URLs with it**, TTL 24 h. Rotate
  it and every brochure link already sent to a buyer on WhatsApp dies instantly,
  with no way to re-sign what has been delivered.

So a nightly read-only job would be holding the key that signs buyer downloads,
and "just rotate it so CI has a copy" costs a Desk↔Spine outage plus a day of
dead links. A measurement job gets a measurement key instead.

`SIL_EVAL_SECRET` opens `/api/sil/probe` and `/api/sil/embed` and nothing else —
not `/internal/agent-send`, not the rebuild routes, not the intent-vector writer,
all of which keep their own `BOT_SHARED_SECRET` check. Both keys are accepted
(constant-time), so dev keeps working on the bot secret it already has, and
`silEvalAllowed` still 404s — never 401 — on a wrong key.

`tests/sil-eval-scope.test.ts` scans `src/index.ts` and fails if the eval gate
ever appears on a route outside `/api/sil/`, or if an `/internal/` route loses
its own check. The narrow key stays narrow by test, not by memory.

**To set it up (founder, once per env):**

```
# generate a value you keep — this is a fresh key, not a copy of anything
openssl rand -hex 32

# ConverseSpine repo
npx wrangler secret put SIL_EVAL_SECRET --env prod     # and --env dev if you want it there too
```

Then add `SIL_EVAL_SECRET` to the matching GitHub **environment** (`production` /
`dev`) — not repo secrets, which this repo does not use. Nothing else changes:
`BOT_SHARED_SECRET` is never read, never rotated, no media link breaks.

## Gates & battery discipline

- `golden.json` rows must pass on the **currently shipped** system — it's a
  regression gate, not a wishlist. Accepted misses live in `known_gaps`
  (reported, never graded); a row is promoted out in the same PR that fixes it.
- Gates: intent top-1 ≥ 70%, precision@tau ≥ 95%, wrong-binds on traps = 0,
  every names/locations/education row passes. Battery rows are chosen to be
  tau-robust (graded traps sit ≥ 0.05 below the bind tau).
- The 26-row battery is a **tripwire, not a benchmark** — real calibration
  uses `--set` with the 600-row holdout (`sil-live-ab` lineage).

## What the first graded run found (18 Aug)

The intent lane came back 23/23, 100% precision, 0 wrong binds. The three
index lanes had never actually run before — no local Cloudflare token — and all
three broke on first contact. Two were the battery's fault, one was not:

| Lane | Result | Verdict |
|---|---|---|
| names | 1/3 | **Battery wrong.** Dev holds both the lokations catalog and the naya-advisor clone tenant; the rows expected `brigade-orchards-naya-advisor` while the index correctly returned `brigade-orchards` at 1.0 and 0.7376 (gate 0.65). Expectation corrected. |
| locations | 0/3 | **Battery measured a lane that does not ship.** Right area on all three, at 0.5984–0.6445, graded against 0.78 — but `LOCATION_THRESHOLD` is applied in `semantic-nlu.ts` to an *in-memory* cosine between the location hint and up to 24 micro-market **name strings**. Spine never queries the locations index at all. Now graded on retrieval, and the report says so. |
| education | 2/3 | **Real defect.** "what does 2bhk actually mean" retrieves `edu:bhk:india` at 0.6901 and `EDUCATION_TAU` is 0.72, so `education.ts:65` drops it — the most common term in Indian real estate returns no education answer. The tau was set in PR #126 against bge-base and never recalibrated for m3. Row moved to `known_gaps`; promote it out in the PR that calibrates this index live. |

The pattern worth keeping: **a lane's tau is only meaningful against the index
it was measured on.** The intent lane learned this the expensive way (offline
0.920 → live 0.8984). Education inherited a pre-m3 number through the cutover
untouched, and locations has a number that belongs to a different comparison
entirely. A threshold of `null` in `golden.json` now means "this index has no
shipped bind gate" — graded on retrieval, labelled as such in every report, and
a `must_not_bind` trap in such a lane is a hard config error.

`tests/golden-battery-shape.test.ts` gates the battery's structure, because
every one of the above was a data mistake that no runtime test could catch.

## Operational notes

- **CI secrets are GitHub ENVIRONMENT secrets, not repo secrets.** This repo
  has zero repo-level secrets; `deploy-dev.yml` declares `environment: dev` and
  `deploy-prod.yml` declares `environment: production` (note the spelling — the
  wrangler env is `prod`, the GitHub environment is `production`; they are not
  interchangeable). A job that omits `environment:` gets every secret as an
  empty string and fails at the first secret check — which is exactly how the
  first dispatch of embed-verify failed. Each environment already holds
  `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`; add `BOT_SHARED_SECRET`
  (one name, per environment, matching that env's deployed worker secret).
  The token also needs **Vectorize Read** for the names/locations/education
  lanes — without it those lanes report as *not measured*, never as failed.
- A lane that could not be measured is reported separately from a lane that
  failed. Green-with-skips prints `NOT MEASURED` and says which lanes; only a
  real quality regression exits non-zero.
- `fill` never embeds locally; offline loads (tsx + the repo's own exported
  phrase functions) are the bootstrap exception, and the crons overwrite the
  same ids afterwards, so drift self-heals.
- Location index is Desk-owned; its name is the one cross-repo constant in the
  orchestrator and fails loudly in `status` if it drifts.
