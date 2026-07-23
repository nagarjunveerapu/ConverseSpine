import { describe, expect, it } from 'vitest';
import { buildComposeRequest, fallbackReply } from '../src/engine/compose.js';
import type { Match } from '../src/engine/types.js';

/**
 * Regression: a buyer names an area we cannot match ("Mumbai", "Coimbatore"),
 * the Desk recognizes none of it, so the search drops the area and re-runs
 * WITHOUT it. Those fallback matches must never be announced as fitting the
 * area the buyer asked for.
 *
 * Root cause this guards: Desk #286 redefined `recognized_locations` to mean
 * "a project is in range" ("the geocode tier cannot 'recognize' a place the
 * builder cannot serve"). CS #101 already treated "nothing recognized" as
 * dialogue noise and dropped it silently — so real-but-unserved cities started
 * being classified as noise, and a Mumbai buyer was shown Devanahalli under
 * "Here's what fits".
 */
const devanahalliMatches: Match[] = [
  {
    projectId: 'brigade-orchards',
    name: 'Brigade Orchards',
    microMarket: 'Devanahalli / Airport Corridor',
    startingPriceInr: 8_200_000,
    startingPriceDisplay: '₹82 L',
    matchReasons: [],
  },
];

function reply(areaFilterDropped: boolean): string {
  return fallbackReply(
    buildComposeRequest(
      { kind: 'recommend' },
      { tools: ['search'], matches: devanahalliMatches, ...(areaFilterDropped ? { areaFilterDropped: true } : {}) },
      { constraints: {}, alreadyShownSameSet: false, builderName: 'Naya' },
    ),
  );
}

describe('unserved locality honesty', () => {
  it('does NOT claim a fit when the area filter was dropped', () => {
    const out = reply(true);
    expect(out).not.toMatch(/Here's what fits/i);
    expect(out).toMatch(/couldn't match that area/i);
    // still offers the real inventory rather than dead-ending
    expect(out).toMatch(/Brigade Orchards/);
  });

  it('keeps the normal fit claim when the area was honoured', () => {
    const out = reply(false);
    expect(out).toMatch(/Here's what fits/i);
    expect(out).not.toMatch(/couldn't match that area/i);
    expect(out).toMatch(/Brigade Orchards/);
  });

  it('never echoes the dropped area string (it may be dialogue noise)', () => {
    // The flag is a boolean by design — no area text can reach the reply, so a
    // junk capture ("one week. ELEVEN") can never be read back to the buyer.
    const out = reply(true);
    expect(out).not.toMatch(/undefined|null|\[object/i);
  });
});
