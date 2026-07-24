import { describe, expect, it } from 'vitest';
import {
  collapseCoverageMarkets,
  coverageCoverBit,
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
});
