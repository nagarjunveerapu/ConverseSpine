import { describe, expect, it } from 'vitest';
import { buildPropertyTypeNoFitEvidence } from '../src/engine/phases/discover.js';
import type { Constraints, Match } from '../src/engine/types.js';

describe('buildPropertyTypeNoFitEvidence', () => {
  it('surfaces closest non-villa when villa filter fails at budget', () => {
    const c: Constraints = { propertyType: 'Villa', budgetMaxInr: 5_000_000 };
    const matches: Match[] = [
      {
        projectId: 'p1',
        name: 'Green Acres',
        microMarket: 'Whitefield',
        startingPriceInr: 4_500_000,
        startingPriceDisplay: '₹45 L',
        matchReasons: [],
        projectType: 'apartment',
      },
    ];
    const ev = buildPropertyTypeNoFitEvidence(c, matches, []);
    expect(ev?.propertyTypeGap?.closestName).toBe('Green Acres');
    expect(ev?.noMatch?.reasoning).toMatch(/No \*Villa\*.*Green Acres/i);
  });

  it('returns null when no alternate type fits budget', () => {
    const c: Constraints = { propertyType: 'Villa', budgetMaxInr: 3_000_000 };
    const matches: Match[] = [
      {
        projectId: 'p1',
        name: 'Lux Villa',
        microMarket: 'Sarjapur',
        startingPriceInr: 8_000_000,
        startingPriceDisplay: '₹80 L',
        matchReasons: [],
        projectType: 'villa',
      },
    ];
    expect(buildPropertyTypeNoFitEvidence(c, matches, [])).toBeNull();
  });
});
