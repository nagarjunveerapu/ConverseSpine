import { describe, expect, it } from 'vitest';
import {
  collapseCoverageMarkets,
  coverageCoverBit,
  matchServedMarket,
} from '../src/engine/coverage-areas.js';

describe('collapseCoverageMarkets', () => {
  it('strips slash aliases and dedupes overlapping Devanahalli forms', () => {
    expect(
      collapseCoverageMarkets([
        'Aerospace Park / Devanahalli Corridor',
        'Devanahalli',
        'Devanahalli / Airport Corridor',
        'Budigere Cross / Old Madras Road',
        'Sarjapur Road',
      ]),
    ).toEqual(['Aerospace Park', 'Devanahalli', 'Budigere Cross', 'Sarjapur Road']);
  });

  it('caps at four short labels', () => {
    expect(
      collapseCoverageMarkets(
        ['Whitefield', 'Sarjapur', 'Yelahanka', 'Hebbal', 'Electronic City'],
        4,
      ),
    ).toEqual(['Whitefield', 'Sarjapur', 'Yelahanka', 'Hebbal']);
  });

  it('formats the cover bit without a raw slash wall', () => {
    const bit = coverageCoverBit([
      'Aerospace Park / Devanahalli Corridor',
      'Devanahalli',
      'Devanahalli / Airport Corridor',
    ]);
    expect(bit).toBe('I currently cover Aerospace Park, Devanahalli');
    expect(bit).not.toMatch(/\//);
  });

  it('matches buyer text only against live served markets', () => {
    expect(
      matchServedMarket('Whitefield', ['Whitefield', 'Sarjapur Road']),
    ).toMatchObject({ name: 'Whitefield', score: 3, authority: 'declared' });
    expect(matchServedMarket('Gurgaon', ['Whitefield', 'Sarjapur Road'])).toBeUndefined();
  });

  it('keeps weak token/typo adopts releasable (inferred), not declared', () => {
    const hit = matchServedMarket('sarhpur', ['Sarjapur Road', 'Whitefield']);
    expect(hit).toMatchObject({ name: 'Sarjapur Road', authority: 'inferred', score: 1 });
  });

  it('does not let a short market name over-match inside a longer ask', () => {
    // "hsr" must not claim every candidate that merely contains those letters
    // via needle.includes(key) — key length gate (≥5) blocks it.
    expect(matchServedMarket('somewhere in the hills', ['HSR'])).toBeUndefined();
  });

  it('documents residual typo gap: distant misspellings stay outside-served', () => {
    // Intentionally far from "Sarjapur" — not recovered by ≤2 edit distance.
    expect(
      matchServedMarket('sxrjxpxr', ['Sarjapur Road', 'Whitefield']),
    ).toBeUndefined();
  });
});
