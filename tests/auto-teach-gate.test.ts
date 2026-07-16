import { describe, it, expect } from 'vitest';
import { cosine, gateCandidates, type GateProbe, type GateMember } from '../src/understanding/auto-teach.js';

// Hand-built unit vectors so every cosine is exact by construction.
const E = (i: number, dim = 4): number[] => {
  const v = new Array(dim).fill(0);
  v[i] = 1;
  return v;
};
/** Vector at a chosen cosine to E(axis): cos = c against that axis. */
const at = (axis: number, c: number, other = 3, dim = 4): number[] => {
  const v = new Array(dim).fill(0);
  v[axis] = c;
  v[other] = Math.sqrt(1 - c * c);
  return v;
};

const TAU = 0.78;

describe('cosine', () => {
  it('orthogonal = 0, identical = 1, constructed angle exact', () => {
    expect(cosine(E(0), E(1))).toBe(0);
    expect(cosine(E(0), E(0))).toBe(1);
    expect(cosine(at(0, 0.9), E(0))).toBeCloseTo(0.9, 10);
  });
});

describe('gateCandidates — the exact no-regression gate', () => {
  const probe = (gold: string, liveScore: number, axis = 0): GateProbe => ({
    gold_kind: gold,
    live_score: liveScore,
    vec: E(axis),
  });
  const member = (cluster: string, kind: string, cos: number, axis = 0): GateMember => ({
    cluster_key: cluster,
    intent_kind: kind,
    vec: at(axis, cos),
  });

  it('SAFE: candidate never beats the live top score → cannot change any prediction', () => {
    const [v] = gateCandidates([probe('get_price', 0.95)], [member('c1', 'book_visit', 0.9)], TAU);
    expect(v).toMatchObject({ safe: true, regressions: 0 });
  });

  it('REGRESSION: wrong-kind candidate takes nn1 above τ → flagged', () => {
    const [v] = gateCandidates([probe('get_price', 0.85)], [member('c1', 'book_visit', 0.9)], TAU);
    expect(v).toMatchObject({ safe: false, regressions: 1 });
  });

  it('SAFE: wrong-kind candidate takes nn1 but BELOW τ → would not bind, no behaviour change', () => {
    const [v] = gateCandidates([probe('get_price', 0.5)], [member('c1', 'book_visit', 0.7)], TAU);
    expect(v).toMatchObject({ safe: true, regressions: 0 });
  });

  it('IMPROVEMENT: right-kind candidate takes nn1 above τ where the index abstained', () => {
    const [v] = gateCandidates([probe('get_price', 0.5)], [member('c1', 'get_price', 0.9)], TAU);
    expect(v).toMatchObject({ safe: true, regressions: 0, improvements: 1 });
  });

  it('one bad member poisons the whole cluster (all-or-nothing per lesson)', () => {
    const verdicts = gateCandidates(
      [probe('get_price', 0.85)],
      [
        member('c1', 'book_visit', 0.5),   // harmless member
        member('c1', 'book_visit', 0.95),  // regressing member
        member('c2', 'get_price', 0.95),   // separate cluster, improvement
      ],
      TAU,
    );
    const c1 = verdicts.find((v) => v.cluster_key === 'c1')!;
    const c2 = verdicts.find((v) => v.cluster_key === 'c2')!;
    expect(c1.safe).toBe(false);
    expect(c1.regressions).toBe(1);
    expect(c2).toMatchObject({ safe: true, improvements: 1 });
  });

  it('empty index (live_score = -1): candidate binds wherever it clears τ — gold decides', () => {
    const wrong = gateCandidates([probe('get_price', -1)], [member('c1', 'book_visit', 0.8)], TAU);
    expect(wrong[0]).toMatchObject({ safe: false, regressions: 1 });
    const right = gateCandidates([probe('get_price', -1)], [member('c1', 'get_price', 0.8)], TAU);
    expect(right[0]).toMatchObject({ safe: true, improvements: 1 });
  });

  it('a probe orthogonal to the candidate is untouched', () => {
    const [v] = gateCandidates(
      [probe('get_price', 0.3, 1)],              // lives on axis 1
      [member('c1', 'book_visit', 0.99, 0)],     // lives on axis 0
      TAU,
    );
    expect(v).toMatchObject({ safe: true, regressions: 0, improvements: 0 });
  });
});
