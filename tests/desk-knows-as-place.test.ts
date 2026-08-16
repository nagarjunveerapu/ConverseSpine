/**
 * A place the buyer never named.
 *
 * Ayana · "can i move in next month?"
 *   → "I don't have homes in *next* — I currently cover Whitefield, Sarjapur
 *      Road, Devanahalli, Budigere Cross."
 * Brigade Calista · "can i move in right away?"
 *   → "I don't have homes in *right* …"
 *
 * The verb particle was read as a preposition of place, and the reply then
 * asserted the leftover word was a town. 6 of 11 probes on deployed dev,
 * 16 Aug 2026.
 *
 * Desk is the authority. But `POST /api/engine/geo/resolve` answers
 * `resolved: true` to ANY string — measured, same day: "self use", "floor is
 * available" and "immediately" all resolve, every one of them to
 * 20.593684, 78.96288 with a 2457 km radius, which is the centroid of India.
 * So `resolved` is not a test of placeness. The authority inside that response
 * is narrower: the area REGISTRY, and failing that, the scale of the answer.
 *
 * Every fixture below is a real response measured against Desk dev.
 */
import { describe, expect, it } from 'vitest';
import { deskKnowsAsPlace } from '../src/engine/coverage-areas.js';

/** The geocoder's shrug: the whole country, returned for anything. */
const INDIA = { lat: 20.593684, lng: 78.96288, source: 'cache' as const, radiusKm: 2457 };

describe('the Desk area registry is the authority', () => {
  it('accepts anything the registry holds, at any scale', () => {
    // Budigere Cross is a SERVED micro-market with a 0.2 km radius — the same
    // radius as the phantom "next". Scale alone would throw a real area away;
    // the registry has to be consulted first.
    for (const [name, geo] of [
      ['Budigere Cross', { lat: 13.05, lng: 77.75, source: 'area_registry' as const, areaId: 'budigere-cross-bengaluru', radiusKm: 0.2 }],
      ['Devanahalli', { lat: 13.24, lng: 77.71, source: 'area_registry' as const, areaId: 'devanahalli-bengaluru', radiusKm: 2 }],
      ['Whitefield', { lat: 12.96, lng: 77.74, source: 'area_registry' as const, areaId: 'whitefield-bengaluru', radiusKm: 3.2 }],
      ['Bengaluru', { lat: 12.97, lng: 77.59, source: 'area_registry' as const, areaId: 'bengaluru-urban-bangalore-division', radiusKm: 35.5 }],
    ] as const) {
      expect.soft(deskKnowsAsPlace(geo), name).toBe(true);
    }
  });

  it('keeps a real place we do not serve — the reply for Pune must survive', () => {
    // Not in the registry (we do not serve it), but a real city at city scale.
    // "I don't have homes in *Pune*" is the honest answer and must not be lost.
    for (const [name, geo] of [
      ['Pune', { lat: 18.52, lng: 73.87, source: 'cache' as const, radiusKm: 18.3 }],
      ['Delhi', { lat: 28.61, lng: 77.2, source: 'cache' as const, radiusKm: 31.1 }],
      ['Hyderabad', { lat: 17.38, lng: 78.48, source: 'geocoder' as const, radiusKm: 37.5 }],
      ['Mumbai', { lat: 19.07, lng: 72.87, source: 'cache' as const, radiusKm: 38 }],
    ] as const) {
      expect.soft(deskKnowsAsPlace(geo), name).toBe(true);
    }
  });

  it('refuses the geocoder shrug — an area the size of India is not an area', () => {
    // Every one of these is a fragment of the buyer's own sentence, and every
    // one resolved to the same country centroid.
    for (const label of ['right', 'next month', 'immediately', 'floor is available', 'self use']) {
      expect.soft(deskKnowsAsPlace(INDIA), label).toBe(false);
    }
  });

  it('refuses a point of interest — "next" resolved to a building in Chennai', () => {
    expect(
      deskKnowsAsPlace({ lat: 13.0353732, lng: 80.2453744, source: 'cache', radiusKm: 0.2 }),
    ).toBe(false);
  });

  it('refuses what Desk could not resolve, and what it resolved without a scale', () => {
    expect.soft(deskKnowsAsPlace(null)).toBe(false);
    // No radius from the geocoder path means no way to judge it. The registry
    // is the only thing that may pass without one.
    expect.soft(deskKnowsAsPlace({ lat: 1, lng: 2, source: 'cache' })).toBe(false);
    expect.soft(deskKnowsAsPlace({ lat: 1, lng: 2 })).toBe(false);
  });
});
