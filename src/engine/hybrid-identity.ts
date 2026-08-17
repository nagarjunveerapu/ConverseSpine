/**
 * Two ways of looking at a name, fused — and an honest margin (U8).
 *
 * The dense lane (PROJECT_VECTORS) and this lexical lane fail in opposite
 * directions, which is the whole reason to run both:
 *
 *   "eldorad"          the embedding of a truncated word drifts; the trigram
 *                      overlap with "Brigade Eldorado" barely moves.
 *   "the green one"    no trigram of that phrase is in any name; the embedding
 *                      still lands near Krishnaja Greens / Viva Greens.
 *
 * Neither lane is a fallback for the other. Running one and consulting the
 * second only on failure would inherit the first one's blind spot, so both
 * always run and the fusion decides.
 *
 * ## Why rank, not score
 *
 * The two lanes emit numbers that mean different things, and one of them is not
 * even what it claims. Vectorize returns LOSSY similarity: query an index for a
 * vector it already contains and it comes back at 0.87-0.90, never the 1.0 that
 * self-cosine is by definition. A weighted sum of a quantised cosine and a Dice
 * coefficient is a number with no unit. Reciprocal rank fusion only ever asks
 * each lane "where did you put this, first or fourth" — a question both lanes
 * can answer honestly, and one that survives the day Vectorize changes its
 * quantisation.
 *
 * ## Why margin, not a threshold
 *
 * Every absolute threshold in this system's history has been wrong. One tau
 * calibrated offline against exact cosine bound 15% of holdout when it reached
 * the deployed worker; re-calibrated live against the same rows it bound 82%.
 * The number that survives that is the DISTANCE between the first candidate and
 * the second, because it is a comparison inside one ranking rather than against
 * a constant someone chose. "Corog Hills scored 0.717" says nothing. "Corog
 * Hills beat the runner-up by one rank position out of sixty" says the thing
 * the caller needs.
 *
 * ## What this module deliberately does not know
 *
 * No place names, no builder list, no length rule doing semantic work, and no
 * catalog baked in — callers hand it the names a decision is judged against.
 * It regenerates from whatever tenant it is given. See name-index.ts, which
 * makes the same promise for token distinctiveness and is the natural companion
 * here: this module finds candidates, that one says whether a single word could
 * legitimately have picked one out.
 *
 * ## Status
 *
 * Nothing branches on this yet, by design. U8 landed the arithmetic and the
 * shadow row; U9 read 900 distinct real utterances through it, checked each
 * candidate against the deployed dev bot, and set the single-lane band edges
 * from what came back. That reading also found a defect in U8's own margin —
 * over fused ranks it is pinned to one constant whenever a single lane ran, so
 * an exact catalog hit scored identically to a builder's brand name. `bandFor`
 * now picks its comparison and records which one fired. See `BANDS`.
 */

/** Below this a token is glue rather than a name — matches name-index.ts. */
const MIN_TOKEN = 3;

/** Trigrams, so a one- or two-character query yields nothing rather than noise. */
const GRAM = 3;

export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
}

export interface LexicalHit {
  readonly id: string;
  readonly name: string;
  /** Dice coefficient over trigram sets — 1.0 iff the normalised strings match. */
  readonly similarity: number;
}

export interface LexicalIndex {
  /** Best `limit` catalog entries for `query`, most similar first. */
  rank(query: string, limit?: number): LexicalHit[];
  /** How many distinct entries the index was built over. */
  readonly size: number;
}

/**
 * Normalise for comparison: case and punctuation carry no identity here.
 * "Brigade Cornerstone-Utopia" and "brigade cornerstone utopia" are one string.
 */
export function normaliseForGrams(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Character trigrams over the space-padded string.
 *
 * The padding is load-bearing: it makes the first and last characters of every
 * word produce grams that only a word STARTING or ENDING the same way can
 * match. Without it "eldorado" and "dorado" look far more alike than a buyer
 * means them to.
 */
export function trigrams(s: string): Set<string> {
  const norm = normaliseForGrams(s);
  if (!norm) return new Set();
  const padded = ` ${norm} `;
  const out = new Set<string>();
  for (let i = 0; i + GRAM <= padded.length; i++) {
    out.add(padded.slice(i, i + GRAM));
  }
  return out;
}

/** Sørensen–Dice over two trigram sets. Symmetric, and 0 when either is empty. */
export function diceSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const g of small) if (large.has(g)) shared++;
  return (2 * shared) / (a.size + b.size);
}

/**
 * Build the lexical lane over a tenant's catalog.
 *
 * Cost is the reason this lane is allowed to exist at all: 69 project names is
 * roughly 4KB of trigrams held in the isolate, and scoring a query against all
 * of them is a set intersection per name — measured against the ~266ms an
 * embedding call costs, it is free. There is no database, no index to keep in
 * step, and nothing to reconcile: hand it the current catalog and it IS current.
 *
 * Duplicate ids collapse to the first occurrence, so a caller may pass the same
 * project twice (a shortlist concatenated with a catalog, say) without skewing
 * the ranking toward it.
 */
export function buildTrigramIndex(entries: readonly CatalogEntry[]): LexicalIndex {
  const rows: Array<{ id: string; name: string; grams: Set<string> }> = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const id = e.id?.trim();
    const name = e.name?.trim();
    if (!id || !name || seen.has(id)) continue;
    const grams = trigrams(name);
    if (grams.size === 0) continue;
    seen.add(id);
    rows.push({ id, name, grams });
  }

  return {
    size: rows.length,
    rank(query: string, limit = 8): LexicalHit[] {
      const q = trigrams(query);
      // A query too short to make one trigram cannot rank anything. Returning
      // an empty lane is the honest answer — it lets the fusion fall to the
      // dense lane alone instead of inventing an order from nothing.
      if (q.size === 0) return [];
      const scored: LexicalHit[] = [];
      for (const r of rows) {
        const similarity = diceSimilarity(q, r.grams);
        if (similarity > 0) scored.push({ id: r.id, name: r.name, similarity });
      }
      scored.sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id));
      return scored.slice(0, Math.max(0, limit));
    },
  };
}

/**
 * A whole buyer utterance is mostly not a name. Rank each plausible span, so
 * "tell me about eldorad please" is judged on "eldorad" rather than diluted by
 * six words of scaffolding that match nothing.
 *
 * Spans are contiguous runs of 1..3 tokens — enough for "Brigade Cornerstone
 * Utopia", short enough that the count stays linear in the utterance. Each
 * catalog entry keeps its BEST span, because a name matching one span well is
 * stronger evidence than the same name matching a long span weakly.
 */
export function rankSpans(index: LexicalIndex, text: string, limit = 8): LexicalHit[] {
  const tokens = normaliseForGrams(text)
    .split(' ')
    .filter((t) => t.length >= MIN_TOKEN);
  if (tokens.length === 0) return [];

  const best = new Map<string, LexicalHit>();
  for (let i = 0; i < tokens.length; i++) {
    for (let n = 1; n <= 3 && i + n <= tokens.length; n++) {
      const span = tokens.slice(i, i + n).join(' ');
      for (const hit of index.rank(span, limit)) {
        const prev = best.get(hit.id);
        if (!prev || hit.similarity > prev.similarity) best.set(hit.id, hit);
      }
    }
  }
  return [...best.values()]
    .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, limit));
}

/**
 * Reciprocal rank fusion.
 *
 * score(d) = Σ over lanes of 1 / (k + rank), rank 1-based, absent = no term.
 *
 * `k` damps the top of each lane: at k=60 the gap between rank 1 and rank 2 is
 * small enough that a document both lanes rank second beats one that a single
 * lane ranks first. That is the behaviour we want — agreement across two
 * different ways of looking is stronger evidence than one lane's confidence,
 * and it is exactly the case a weighted-score fusion gets wrong.
 *
 * 60 is the value the original RRF work settled on and it is not tuned here;
 * U9 may move it, from read disagreements rather than from taste.
 */
export const RRF_K = 60;

export interface FusedCandidate {
  readonly id: string;
  readonly name: string;
  readonly score: number;
  /** 1-based position in each lane, or null where the lane did not return it. */
  readonly ranks: { readonly dense: number | null; readonly lexical: number | null };
  /**
   * Each lane's own raw score, carried through untouched. Fusion does not use
   * these — it ranks — but `bandFor` needs them for the single-lane case, where
   * ranks alone cannot express confidence. See the margin note there.
   */
  readonly similarities: { readonly dense: number | null; readonly lexical: number | null };
}

export interface Lane {
  readonly id: string;
  readonly name: string;
  /**
   * The lane's own score for this entry, if it has one. Optional because the
   * dense lane does not currently carry scores out of Vectorize; a lane without
   * them simply cannot supply a score-basis margin, which `bandFor` records
   * rather than papering over.
   */
  readonly similarity?: number;
}

export function fuseByReciprocalRank(
  dense: readonly Lane[],
  lexical: readonly Lane[],
  k: number = RRF_K,
): FusedCandidate[] {
  interface Acc {
    name: string;
    score: number;
    dense: number | null;
    lexical: number | null;
    denseSim: number | null;
    lexicalSim: number | null;
  }
  const acc = new Map<string, Acc>();

  const absorb = (lane: readonly Lane[], which: 'dense' | 'lexical') => {
    const simKey = which === 'dense' ? 'denseSim' : 'lexicalSim';
    lane.forEach((entry, i) => {
      const rank = i + 1;
      const prev: Acc = acc.get(entry.id) ?? {
        name: entry.name,
        score: 0,
        dense: null,
        lexical: null,
        denseSim: null,
        lexicalSim: null,
      };
      // A lane listing the same id twice must not pay twice — keep its best.
      if (prev[which] !== null) return;
      prev[which] = rank;
      prev[simKey] = typeof entry.similarity === 'number' ? entry.similarity : null;
      prev.score += 1 / (k + rank);
      // Prefer a non-empty name if the other lane carried one.
      if (!prev.name && entry.name) prev.name = entry.name;
      acc.set(entry.id, prev);
    });
  };

  absorb(dense, 'dense');
  absorb(lexical, 'lexical');

  return [...acc.entries()]
    .map(([id, v]) => ({
      id,
      name: v.name,
      score: v.score,
      ranks: { dense: v.dense, lexical: v.lexical },
      similarities: { dense: v.denseSim, lexical: v.lexicalSim },
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/**
 * What the caller should DO, not how sure the arithmetic feels.
 *
 * Named as actions on purpose: a band called "medium confidence" invites a
 * reader to invent a policy for it at the call site, which is how thresholds
 * end up duplicated across five files. These four are the whole vocabulary.
 */
export type BandAction = 'none' | 'bind' | 'adjudicate' | 'ask';

export interface BandVerdict {
  /** 0 none · 1 bind · 2 adjudicate · 3 ask — U10 implements 2 and 3. */
  readonly band: 0 | 1 | 2 | 3;
  readonly action: BandAction;
  readonly top: FusedCandidate | null;
  readonly runnerUp: FusedCandidate | null;
  /**
   * Top score minus runner-up, as a fraction of the top score. Unitless and
   * comparable across turns; 1.0 when nothing else was retrieved at all.
   */
  readonly margin: number;
  /** Which comparison produced `margin` — the two are on different scales. */
  readonly marginBasis: MarginBasis;
  /**
   * True when both lanes independently put `top` first. Recorded for the shadow
   * log, and deliberately NOT consulted by the action — see `bandFor`.
   */
  readonly bothLanesAgree: boolean;
}

export interface BandThresholds {
  /** At or above this margin, one candidate has genuinely won. */
  readonly bind: number;
  /** Below `bind` but at or above this, it is worth paying to disambiguate. */
  readonly adjudicate: number;
}

/**
 * Which comparison produced the margin. The two bases are on different scales
 * and are NOT interchangeable, so every shadow row records the one that fired —
 * a column mixing them silently would be unreadable, the same way `dense_ran`
 * exists to stop "found nothing" being logged as "never ran".
 */
export type MarginBasis = 'rrf' | 'dense_score' | 'lexical_score';

export interface BandCalibration {
  /** Both lanes returned candidates — margin is over fused ranks. */
  readonly rrf: BandThresholds;
  /** One lane returned candidates — margin is over that lane's own scores. */
  readonly singleLane: BandThresholds;
}

/**
 * `rrf` — NOT read from real rows, and cannot be yet: no shadow row has ever
 * had both lanes populated (the dense lane only runs when the gate allows it).
 * What these numbers do carry is the discrete lattice RRF actually produces at
 * k=60. With two lanes the reachable margins are ~0 (each lane leads with a
 * different name), ~0.016 (both lanes rank the same pair in the same order),
 * ~0.508 (top found by both, runner-up by one), and 1.0 (nothing else at all).
 * A 0.3/0.1 pair therefore encodes exactly one rule: *bind only when the top
 * was found by strictly more lanes than the runner-up.* That is a defensible
 * rule, not a tuned threshold, and it is why the pair survives U9 unchanged.
 *
 * `singleLane` — read from 900 distinct real utterances against the 21-project
 * naya-advisor catalog, cross-checked against what the deployed dev bot did
 * with each of them. The ordering the score gap produces:
 *
 *     0.091  "is brigade a reliable builder"   → ask  (builder brand, 9 projects share it)
 *     0.104  "Cornerstone Utopia"              → adjudicate (vs Brigade Cornerstone)
 *     0.189  "cornerstone is smaller though right" → adjudicate
 *     0.294  "and krishnaja greens?"           → bind
 *     0.300  bare "Brigade Eldorado" (928×)    → bind
 *     0.750  "...we want to see eldorado. saturday" → bind
 *
 * 0.25/0.12 is the pair that separates that list correctly. The evidence for it
 * is docs — see the U9 note in BOOK.html — not a number chosen for roundness.
 */
export const BANDS: BandCalibration = {
  rrf: { bind: 0.3, adjudicate: 0.1 },
  singleLane: { bind: 0.25, adjudicate: 0.12 },
};

/** @deprecated Kept so a caller passing one pair still compiles; prefer `BANDS`. */
export const PROVISIONAL_BANDS: BandThresholds = BANDS.rrf;

export function bandFor(
  fused: readonly FusedCandidate[],
  calibration: BandCalibration,
): BandVerdict {
  const top = fused[0] ?? null;
  const runnerUp = fused[1] ?? null;

  if (!top) {
    return {
      band: 0,
      action: 'none',
      top: null,
      runnerUp: null,
      margin: 0,
      marginBasis: 'rrf',
      bothLanesAgree: false,
    };
  }

  // WHICH COMPARISON, AND WHY IT IS NOT ALWAYS THE FUSED ONE.
  //
  // Fusing by rank is right for ORDERING: Vectorize scores are lossy, so their
  // magnitudes cannot be trusted across turns. But a margin over ranks measures
  // confidence only when there are two rankings to disagree. With one lane the
  // top two candidates are always on ADJACENT ranks, so the fused margin is
  // pinned at (1/61 − 1/62)/(1/61) = 0.01613 — the same number whether the
  // match was exact or coincidental. Measured on 900 real utterances, 28 of the
  // 29 strongest candidates landed in one band on that constant, including an
  // exact catalog hit ("and krishnaja greens?", Dice 1.000) sitting beside a
  // builder's brand name ("is brigade a reliable builder", Dice 0.700).
  //
  // The information was never missing — rank fusion discards it. So when only
  // one lane ran, read the margin off that lane's own scores. That is still a
  // comparison INSIDE one ranking, not against a constant someone chose, which
  // is the property that makes a margin survive deployment where a tau does not.
  const denseUsed = fused.some((c) => c.ranks.dense !== null);
  const lexicalUsed = fused.some((c) => c.ranks.lexical !== null);
  const soleLane: 'dense' | 'lexical' | null =
    denseUsed && lexicalUsed ? null : denseUsed ? 'dense' : lexicalUsed ? 'lexical' : null;

  const rrfMargin = runnerUp && top.score > 0 ? (top.score - runnerUp.score) / top.score : 1;
  const topSim = soleLane ? top.similarities[soleLane] : null;

  let margin = rrfMargin;
  let marginBasis: MarginBasis = 'rrf';
  // A lane with no scores to offer (the dense lane today) falls back to the
  // fused margin and SAYS so, rather than inventing a number.
  if (soleLane && typeof topSim === 'number' && topSim > 0) {
    const runnerSim = runnerUp ? (runnerUp.similarities[soleLane] ?? 0) : 0;
    margin = (topSim - runnerSim) / topSim;
    marginBasis = soleLane === 'dense' ? 'dense_score' : 'lexical_score';
  }

  const thresholds = marginBasis === 'rrf' ? calibration.rrf : calibration.singleLane;
  const bothLanesAgree = top.ranks.dense === 1 && top.ranks.lexical === 1;

  // `bothLanesAgree` is REPORTED, not acted on. An earlier draft let agreement
  // bind regardless of margin, on the reasoning that two lanes failing in
  // opposite directions and still choosing the same name is the strongest
  // evidence available. A test killed it:
  //
  //   "I want green open spaces", against a tenant with one greens-named
  //   project. The lexical lane scores that project 0.5 — "green" is literally
  //   half of "Viva Greens" by trigram overlap — and the dense lane has nothing
  //   greener to offer either. Both lanes rank it first, agree, and bind. The
  //   buyer was describing foliage.
  //
  // The lexical lane cannot tell a name-word from an ordinary adjective, so
  // agreement between the lanes is not independent of the query being nameless.
  // Whether agreement deserves to override a margin — and above what lexical
  // support — is a question about the distribution of margins on real buyer
  // text, which is exactly what the shadow row is being built to measure. U9
  // answers it from that reading; this module does not guess at it now.
  if (margin >= thresholds.bind) {
    return { band: 1, action: 'bind', top, runnerUp, margin, marginBasis, bothLanesAgree };
  }
  if (margin >= thresholds.adjudicate) {
    return { band: 2, action: 'adjudicate', top, runnerUp, margin, marginBasis, bothLanesAgree };
  }
  return { band: 3, action: 'ask', top, runnerUp, margin, marginBasis, bothLanesAgree };
}

/**
 * One row per turn, for the ledger. Small on purpose — every field here is a
 * question U9 has to answer, and nothing is stored "in case".
 */
export interface IdentityShadow {
  readonly band: 0 | 1 | 2 | 3;
  readonly action: BandAction;
  readonly margin: number;
  /**
   * Which comparison `margin` came from. A reader aggregating margins across
   * rows MUST group by this: `rrf` margins live on a four-value lattice, score
   * margins are continuous, and averaging them together is meaningless.
   */
  readonly margin_basis: MarginBasis;
  readonly both_lanes_agree: boolean;
  readonly top: string | null;
  readonly runner_up: string | null;
  /** Where each lane put `top`, so a lane that carried the turn is identifiable. */
  readonly dense_rank: number | null;
  readonly lexical_rank: number | null;
  /** Raw Dice of the best lexical hit — the one number bandFor deliberately drops. */
  readonly lexical_similarity: number | null;
  /**
   * False when `shouldQueryProjectVectors` refused this turn, so the dense lane
   * is empty because it never ran — NOT because it found nothing. The two are
   * opposite findings and a log that conflates them is worthless.
   */
  readonly dense_ran: boolean;
  /**
   * What actually bound, so U9 diffs against reality rather than intent.
   *
   * Filled by ledger-write, NOT here, and that placement is the point: between
   * this module and the ledger sit the authority merge and the precision-floor
   * scrub, either of which can drop a project the embedder proposed. A value
   * captured at retrieval time would record what was proposed while claiming to
   * record what shipped. The ledger reads it off the same `ex` it writes
   * `named_projects` from, so the two cannot disagree.
   */
  readonly shipped: readonly string[];
}

/** What retrieval can honestly know — everything except the final binding. */
export type IdentityShadowCore = Omit<IdentityShadow, 'shipped'>;

/**
 * Assemble the shadow row.
 *
 * Runs whether or not the dense lane was allowed to. That is the whole reason
 * this is worth logging: the gate in front of PROJECT_VECTORS is the measured
 * bottleneck — the embedder is 96.9% accurate when it is consulted at all — so
 * a shadow computed only on turns the gate approved would sample away exactly
 * the failures U9 is looking for. The lexical lane is a few set intersections
 * over ~50 names and costs nothing, so it runs on every turn regardless, and
 * `dense_ran: false` marks the turns where the gate, not the retrieval, decided.
 *
 * Returns null when there is no catalog to judge against — an absent row is
 * honest; a row computed against nothing is not.
 */
export function shadowVerdict(input: {
  readonly text: string;
  readonly catalog: readonly CatalogEntry[];
  readonly dense: readonly Lane[];
  readonly denseRan: boolean;
  readonly calibration?: BandCalibration;
}): IdentityShadowCore | null {
  const catalog = input.catalog.filter((c) => c?.id && c?.name);
  if (catalog.length === 0) return null;

  const lexicalHits = rankSpans(buildTrigramIndex(catalog), input.text);
  const fused = fuseByReciprocalRank(input.dense, lexicalHits);
  const v = bandFor(fused, input.calibration ?? BANDS);

  return {
    band: v.band,
    action: v.action,
    margin: v.margin,
    margin_basis: v.marginBasis,
    both_lanes_agree: v.bothLanesAgree,
    top: v.top?.id ?? null,
    runner_up: v.runnerUp?.id ?? null,
    dense_rank: v.top?.ranks.dense ?? null,
    lexical_rank: v.top?.ranks.lexical ?? null,
    lexical_similarity: lexicalHits.find((h) => h.id === v.top?.id)?.similarity ?? null,
    dense_ran: input.denseRan,
  };
}
