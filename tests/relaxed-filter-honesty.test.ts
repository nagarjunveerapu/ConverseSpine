import { describe, expect, it } from 'vitest';
import { buildComposeRequest, fallbackReply } from '../src/engine/compose.js';
import type { Match, RelaxedDimension } from '../src/engine/types.js';

/**
 * A shortlist that only exists because part of the buyer's ask was RELAXED is
 * not a fit and must never be announced as one.
 *
 * Two real defects this guards, both found live on dev:
 *  - area: "apartment in Mumbai" answered "Here's what fits: …Devanahalli".
 *    (Desk #286 redefined `recognized_locations` to mean serviceable, so real
 *    unserved cities started looking like the dialogue noise CS #101 drops.)
 *  - size: "4 BHK under 50 lakhs" answered "Here's what fits" with ₹31 L / ₹41 L
 *    projects, when ZERO 4 BHK units exist under ₹50 L. `broadenInitialShortlist`
 *    searches without `bhks` and `filterSearchMatches` enforces budget+location
 *    but NOT size, so the size silently vanished from the ask.
 *
 * Broadening itself is correct and stays (RTI-D+ "list three projects on first
 * brief" — never dead-end a buyer who just filled in a whole brief). Only the
 * claim was wrong.
 */
const matches: Match[] = [
  {
    projectId: 'brigade-orchards',
    name: 'Brigade Orchards',
    microMarket: 'Devanahalli / Airport Corridor',
    startingPriceInr: 8_200_000,
    startingPriceDisplay: '₹82 L',
    matchReasons: [],
  },
];

function reply(relaxed?: RelaxedDimension[]): string {
  return fallbackReply(
    buildComposeRequest(
      { kind: 'recommend' },
      { tools: ['search'], matches, ...(relaxed ? { relaxed } : {}) },
      { constraints: {}, alreadyShownSameSet: false, builderName: 'Naya' },
    ),
  );
}

describe('relaxed-filter honesty', () => {
  it('claims a fit only when nothing was relaxed', () => {
    const out = reply();
    expect(out).toMatch(/Here's what fits/i);
    expect(out).not.toMatch(/couldn't match/i);
  });

  it.each([
    ['area', /that area/i],
    ['size', /that size/i],
    ['budget', /that budget/i],
  ] as const)('never claims a fit when %s was relaxed', (dim, phrase) => {
    const out = reply([dim as RelaxedDimension]);
    expect(out).not.toMatch(/Here's what fits/i);
    expect(out).toMatch(/couldn't match/i);
    expect(out).toMatch(phrase);
    // still offers the real inventory rather than dead-ending
    expect(out).toMatch(/Brigade Orchards/);
  });

  it('names every relaxed dimension when more than one gave', () => {
    const out = reply(['area', 'size']);
    expect(out).toMatch(/that area/i);
    expect(out).toMatch(/that size/i);
    expect(out).not.toMatch(/Here's what fits/i);
  });

  it('never leaks the buyer raw value — dimensions only', () => {
    // The contract carries dimensions, not captures, so a junk locality
    // ("one week. ELEVEN") can never be read back to the buyer.
    const out = reply(['area', 'size', 'budget']);
    expect(out).not.toMatch(/undefined|null|\[object/i);
  });
});
