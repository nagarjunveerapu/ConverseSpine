import { describe, expect, it } from 'vitest';
import {
  bandFor,
  buildTrigramIndex,
  diceSimilarity,
  fuseByReciprocalRank,
  normaliseForGrams,
  BANDS,
  rankSpans,
  RRF_K,
  shadowVerdict,
  trigrams,
  type CatalogEntry,
  type Lane,
} from '../src/engine/hybrid-identity.js';

/**
 * The names in these fixtures are the ones the engine has actually been wrong
 * about — the sibling pairs from name-index.ts, the truncation U11 exists to
 * learn, and the near-miss pair U10's reranker is for. A fixture of invented
 * names would agree with anything.
 */
const CATALOG: CatalogEntry[] = [
  { id: 'brigade-eldorado', name: 'Brigade Eldorado' },
  { id: 'brigade-cornerstone', name: 'Brigade Cornerstone' },
  { id: 'brigade-cornerstone-utopia', name: 'Brigade Cornerstone Utopia' },
  { id: 'krishnaja-greens', name: 'Krishnaja Greens' },
  { id: 'viva-greens', name: 'Viva Greens' },
  { id: 'amrutha-heights', name: 'Amrutha Heights' },
  { id: 'amruth-valley', name: 'Amruth Valley' },
  { id: 'century-breeze', name: 'Century Breeze' },
];

const lane = (...ids: string[]): Lane[] =>
  ids.map((id) => ({ id, name: CATALOG.find((c) => c.id === id)?.name ?? id }));

describe('normalisation and grams', () => {
  it('treats case and punctuation as carrying no identity', () => {
    expect(normaliseForGrams('Brigade Cornerstone-Utopia')).toBe('brigade cornerstone utopia');
    expect(trigrams('Brigade  Eldorado!')).toEqual(trigrams('brigade eldorado'));
  });

  it('pads so a suffix match is not mistaken for the whole word', () => {
    // Without boundary padding these two would share every internal gram and
    // score far higher than a buyer means by them.
    const whole = diceSimilarity(trigrams('eldorado'), trigrams('eldorado'));
    const suffix = diceSimilarity(trigrams('dorado'), trigrams('eldorado'));
    expect(whole).toBe(1);
    expect(suffix).toBeLessThan(0.8);
  });

  it('yields nothing for a query too short to make a gram', () => {
    expect(trigrams('').size).toBe(0);
    expect(buildTrigramIndex(CATALOG).rank('')).toEqual([]);
  });

  it('is symmetric', () => {
    const a = trigrams('Amrutha Heights');
    const b = trigrams('Amruth Valley');
    expect(diceSimilarity(a, b)).toBe(diceSimilarity(b, a));
  });
});

describe('the lexical lane recovers what an embedding loses', () => {
  const index = buildTrigramIndex(CATALOG);

  it('ranks a truncated name onto the right project', () => {
    // "eldorad" is the U11 case: a real thing buyers type, and the input an
    // embedding drifts on because the token is not a word.
    const [top] = index.rank('eldorad');
    expect(top?.id).toBe('brigade-eldorado');
  });

  it('finds the name inside a sentence, not diluted by the scaffolding', () => {
    const hits = rankSpans(index, 'hi can you tell me about eldorad please');
    expect(hits[0]?.id).toBe('brigade-eldorado');
  });

  it('cannot tell a name-word from an ordinary adjective — the known hole', () => {
    // "green" is half of "Viva Greens" by trigram overlap, so a phrase about
    // foliage scores 0.5 against a project name. This lane has no way to know
    // better; recording the number here so the day it changes, someone reads
    // why. What keeps it from becoming a wrong answer is the band, below.
    const hits = rankSpans(index, 'i want somewhere with green open spaces');
    expect(hits[0]?.id).toBe('viva-greens');
    expect(hits[0]!.similarity).toBeCloseTo(0.5, 10);
  });

  it('ranks both ambiguous siblings above everything else', () => {
    // Dice is length-biased — a shared word counts for less against a longer
    // name, so these two land 0.16 apart on raw similarity. That bias is
    // precisely why the fusion consumes RANK and discards these numbers.
    const hits = index.rank('greens');
    expect(hits.slice(0, 2).map((h) => h.id).sort()).toEqual([
      'krishnaja-greens',
      'viva-greens',
    ]);
    expect(hits[0]!.similarity - hits[1]!.similarity).toBeGreaterThan(0.1);
  });

  it('collapses a duplicated id rather than weighting it twice', () => {
    const dupe = buildTrigramIndex([...CATALOG, { id: 'viva-greens', name: 'Viva Greens' }]);
    expect(dupe.size).toBe(CATALOG.length);
  });
});

describe('reciprocal rank fusion', () => {
  it('lets agreement beat a single lane confidence', () => {
    // The property that justifies RRF over a weighted score: something both
    // lanes put second should beat something only one lane put first.
    const fused = fuseByReciprocalRank(
      lane('century-breeze', 'brigade-eldorado'),
      lane('krishnaja-greens', 'brigade-eldorado'),
    );
    expect(fused[0]?.id).toBe('brigade-eldorado');
    expect(fused[0]!.score).toBeCloseTo(2 / (RRF_K + 2), 10);
  });

  it('gives no term to a lane that did not return the candidate', () => {
    const fused = fuseByReciprocalRank(lane('brigade-eldorado'), []);
    expect(fused[0]!.score).toBeCloseTo(1 / (RRF_K + 1), 10);
    expect(fused[0]!.ranks).toEqual({ dense: 1, lexical: null });
  });

  it('does not pay a lane twice for repeating an id', () => {
    const once = fuseByReciprocalRank(lane('viva-greens'), []);
    const twice = fuseByReciprocalRank(lane('viva-greens', 'viva-greens'), []);
    expect(twice[0]!.score).toBe(once[0]!.score);
  });

  it('survives one lane being empty', () => {
    expect(fuseByReciprocalRank([], [])).toEqual([]);
    expect(fuseByReciprocalRank([], lane('amruth-valley'))[0]?.id).toBe('amruth-valley');
  });

  it('orders deterministically when scores tie', () => {
    const a = fuseByReciprocalRank(lane('viva-greens'), lane('krishnaja-greens'));
    const b = fuseByReciprocalRank(lane('viva-greens'), lane('krishnaja-greens'));
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });
});

describe('bands say what to do, not how sure we feel', () => {
  it('reports none when nothing was retrieved', () => {
    const v = bandFor([], BANDS);
    expect(v.action).toBe('none');
    expect(v.band).toBe(0);
    expect(v.top).toBeNull();
  });

  it('binds a lone candidate — nothing competes with it', () => {
    const fused = fuseByReciprocalRank(lane('brigade-eldorado'), []);
    const v = bandFor(fused, BANDS);
    expect(v.margin).toBe(1);
    expect(v.action).toBe('bind');
  });

  it('records lane agreement without letting it override the margin', () => {
    // Both lanes putting one name first is recorded — U9 reads it out of the
    // shadow row — but it does not act. An earlier draft let it bind, which
    // bound "green open spaces" to a greens-named project (see the lexical
    // hole above). The cost of removing it is visible right here: a buyer who
    // types a full name that has a near-twin still gets asked. That cost is
    // the measurement U9 needs, not a bug to paper over now.
    const fused = fuseByReciprocalRank(
      lane('amrutha-heights', 'amruth-valley'),
      lane('amrutha-heights', 'amruth-valley'),
    );
    const v = bandFor(fused, BANDS);
    expect(v.bothLanesAgree).toBe(true);
    expect(v.margin).toBeLessThan(BANDS.rrf.adjudicate);
    expect(v.action).toBe('ask');
  });

  it('separates a candidate only one lane found from one both lanes found', () => {
    // This is what the margin actually encodes once scores are discarded: a
    // runner-up that appeared in a single lane is half a first-place hit
    // behind, which is a wide gap — a runner-up both lanes returned is one
    // rank position behind, which is nearly nothing.
    const bothFoundRunnerUp = bandFor(
      fuseByReciprocalRank(
        lane('viva-greens', 'century-breeze'),
        lane('viva-greens', 'century-breeze'),
      ),
      BANDS,
    );
    const oneLaneRunnerUp = bandFor(
      fuseByReciprocalRank(lane('viva-greens', 'century-breeze'), lane('viva-greens')),
      BANDS,
    );
    expect(oneLaneRunnerUp.margin).toBeGreaterThan(bothFoundRunnerUp.margin * 10);
    expect(oneLaneRunnerUp.action).toBe('bind');
    expect(bothFoundRunnerUp.action).toBe('ask');
  });

  it('asks rather than guessing when two lanes disagree about first place', () => {
    const fused = fuseByReciprocalRank(
      lane('krishnaja-greens', 'viva-greens'),
      lane('viva-greens', 'krishnaja-greens'),
    );
    const v = bandFor(fused, BANDS);
    expect(v.bothLanesAgree).toBe(false);
    expect(v.margin).toBeLessThan(BANDS.rrf.adjudicate);
    expect(v.action).toBe('ask');
  });

  it('escalates to adjudicate in the middle band', () => {
    const v = bandFor(
      [
        { id: 'a', name: 'A', score: 0.02, ranks: { dense: 1, lexical: null }, similarities: { dense: null, lexical: null } },
        { id: 'b', name: 'B', score: 0.016, ranks: { dense: null, lexical: 1 }, similarities: { dense: null, lexical: null } },
      ],
      BANDS,
    );
    expect(v.margin).toBeCloseTo(0.2, 10);
    expect(v.action).toBe('adjudicate');
  });

  it('moves with the thresholds it is given, carrying no opinion of its own', () => {
    // U9 sets the real edges. The same evidence must be able to land in a
    // different band purely by changing the argument — otherwise a threshold
    // is hidden somewhere in here.
    const fused = [
      { id: 'a', name: 'A', score: 0.02, ranks: { dense: 1, lexical: null }, similarities: { dense: null, lexical: null } },
      { id: 'b', name: 'B', score: 0.016, ranks: { dense: 2, lexical: null }, similarities: { dense: null, lexical: null } },
    ];
    const at = (bind: number, adjudicate: number) =>
      bandFor(fused, { rrf: { bind, adjudicate }, singleLane: { bind, adjudicate } }).action;
    expect(at(0.1, 0.05)).toBe('bind');
    expect(at(0.9, 0.5)).toBe('ask');
  });
});

describe('the margin measures the lane that actually ran (U9)', () => {
  // U8 computed every margin over fused ranks. With one lane that pins the top
  // two candidates to adjacent ranks, so the margin was the constant 0.01613
  // no matter what the lane actually saw. Measured on 900 real dev utterances,
  // 28 of the 29 strongest candidates collapsed into one band on that constant.
  // These are the cases that constant could not tell apart.

  it('separates an exact catalog hit from a builder brand both lanes would rank first', () => {
    // Both are single-lane, both are "a project name is visible in the text",
    // and under fused ranks both scored 0.01613 — identical. They are not
    // remotely the same claim: one buyer named a project, the other named the
    // developer of nine of them. Dev binds neither today; only one deserves it.
    const named = shadowVerdict({
      text: 'and krishnaja greens?',
      catalog: CATALOG,
      dense: [],
      denseRan: false,
    })!;
    const brand = shadowVerdict({
      text: 'is brigade a reliable builder',
      catalog: CATALOG,
      dense: [],
      denseRan: false,
    })!;

    expect(named.margin).toBeGreaterThan(brand.margin);
    expect(named.action).toBe('bind');
    expect(brand.action).toBe('ask');
    // The old constant, kept literal: if either row ever reads 0.01613 again
    // the rank-basis has silently come back for the single-lane case.
    expect(named.margin).not.toBeCloseTo(0.01613, 4);
    expect(brand.margin).not.toBeCloseTo(0.01613, 4);
  });

  it('will not bind an ordinary adjective that overlaps a name — with 0.012 to spare', () => {
    // The hole from U8, now measured rather than asserted. "green" is half of
    // "Viva Greens" by trigram overlap, so this lands at margin 0.238 against a
    // bind edge of 0.25. It does NOT bind, which is the safety property that
    // matters — but the clearance is 0.012, the thinnest in the whole set, and
    // it is thin because margin is the wrong instrument for this distinction.
    // What actually separates "greens the adjective" from "Greens the name" is
    // whether the token is a name-word at all: name-index.ts computes exactly
    // that, and U11 is what would settle it. Until then nothing binds
    // automatically, so the thin clearance costs nothing.
    const v = shadowVerdict({
      text: 'i want somewhere with green open spaces',
      catalog: CATALOG,
      dense: [],
      denseRan: false,
    })!;
    expect(v.top).toBe('viva-greens');
    expect(v.action).not.toBe('bind');
    expect(v.margin).toBeLessThan(BANDS.singleLane.bind);
  });

  it('still binds the truncation the dense lane drifts on', () => {
    // The case the whole two-lane design exists for must survive calibration.
    const v = shadowVerdict({ text: 'tell me about eldorad', catalog: CATALOG, dense: [], denseRan: false })!;
    expect(v.top).toBe('brigade-eldorado');
    expect(v.action).toBe('bind');
  });

  it('sends a genuine two-way name collision to adjudicate, not to a guess', () => {
    // Brigade Cornerstone vs Brigade Cornerstone Utopia. A buyer saying
    // "cornerstone" has named something real and something ambiguous at once —
    // the one case in the live set where asking back is the correct answer
    // rather than a failure to understand.
    const v = shadowVerdict({
      text: 'cornerstone is smaller though right',
      catalog: CATALOG,
      dense: [],
      denseRan: false,
    })!;
    expect(v.action).toBe('adjudicate');
    expect(v.top).toBe('brigade-cornerstone');
  });

  it('names which comparison it used, because the two are not on one scale', () => {
    const oneLane = shadowVerdict({
      text: 'and krishnaja greens?',
      catalog: CATALOG,
      dense: [],
      denseRan: false,
    })!;
    const twoLanes = shadowVerdict({
      text: 'and krishnaja greens?',
      catalog: CATALOG,
      dense: lane('viva-greens', 'century-breeze'),
      denseRan: true,
    })!;
    expect(oneLane.margin_basis).toBe('lexical_score');
    expect(twoLanes.margin_basis).toBe('rrf');
  });

  it('falls back to the fused margin, and says so, when the sole lane has no scores', () => {
    // The dense lane carries no similarity out of Vectorize today. A lane that
    // cannot supply a score must not have one invented for it — the row says
    // `rrf` so a reader knows this margin is the coarse one.
    const fused = fuseByReciprocalRank(lane('brigade-eldorado', 'brigade-cornerstone'), []);
    const v = bandFor(fused, BANDS);
    expect(v.marginBasis).toBe('rrf');
    expect(v.margin).toBeCloseTo(0.01613, 4);
  });

  it('keeps the fused margin when both lanes genuinely ran', () => {
    // Rank fusion is still right where there are two rankings to disagree —
    // this half of U8 is unchanged, and a top found by both lanes still beats a
    // runner-up found by one.
    const v = bandFor(
      fuseByReciprocalRank(lane('viva-greens', 'century-breeze'), lane('viva-greens')),
      BANDS,
    );
    expect(v.marginBasis).toBe('rrf');
    expect(v.action).toBe('bind');
  });
});

describe('the shadow row is readable on its own', () => {
  const shadow = (over: Partial<Parameters<typeof shadowVerdict>[0]> = {}) =>
    shadowVerdict({
      text: 'tell me about eldorad',
      catalog: CATALOG,
      dense: [],
      denseRan: false,
      ...over,
    });

  it('distinguishes "the gate refused" from "the embedder found nothing"', () => {
    // Both leave `dense` empty. A reader who cannot tell them apart cannot
    // tell a retrieval failure from a routing failure, which is the single
    // most important thing U9 needs out of these rows.
    expect(shadow({ dense: [], denseRan: false })!.dense_ran).toBe(false);
    expect(shadow({ dense: [], denseRan: true })!.dense_ran).toBe(true);
  });

  it('finds the truncated name even on a turn the gate refused', () => {
    // The reason the lexical lane runs outside the gate at all.
    const row = shadow({ dense: [], denseRan: false })!;
    expect(row.top).toBe('brigade-eldorado');
    expect(row.lexical_rank).toBe(1);
    expect(row.dense_rank).toBeNull();
  });

  it('does not claim to know what shipped', () => {
    // `shipped` is filled by ledger-write, after the authority merge and the
    // precision-floor scrub have had their say. Anything captured here would
    // record a proposal while calling itself an outcome — see the seam test in
    // identity-shadow-reaches-ledger.test.ts for the half this one cannot own.
    const row = shadow({
      text: 'compare krishnaja greens and viva greens',
      dense: lane('krishnaja-greens', 'viva-greens'),
      denseRan: true,
    })!;
    expect(row).not.toHaveProperty('shipped');
    expect(row.top).not.toBeNull();
  });

  it('keeps the raw lexical similarity the band throws away', () => {
    const row = shadow({ text: 'i want somewhere with green open spaces' })!;
    expect(row.top).toBe('viva-greens');
    expect(row.lexical_similarity).toBeCloseTo(0.5, 10);
  });

  it('returns nothing rather than a row computed against no catalog', () => {
    expect(shadow({ catalog: [] })).toBeNull();
    expect(shadow({ catalog: [{ id: '', name: '' }] })).toBeNull();
  });
});

describe('the lane contains no domain knowledge', () => {
  it('re-derives for a tenant it has never seen', () => {
    const other = buildTrigramIndex([
      { id: 'p1', name: 'Northgate Pinewood' },
      { id: 'p2', name: 'Harbour Works Quay' },
    ]);
    expect(other.rank('pinewod')[0]?.id).toBe('p1');
    expect(other.rank('quay')[0]?.id).toBe('p2');
  });

  it('has no source-level list of places or builders', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/engine/hybrid-identity.ts', import.meta.url), 'utf8'),
    );
    const body = src.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const banned of ['brigade', 'prestige', 'sobha', 'godrej', 'bangalore', 'whitefield']) {
      expect(body.toLowerCase()).not.toContain(banned);
    }
  });
});
