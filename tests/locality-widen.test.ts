import { describe, expect, it } from 'vitest';
import { searchLocalityWiden } from '../src/engine/locality-widen.js';
import type { Match } from '../src/engine/types.js';

const NB: Match = {
  projectId: 'eldorado',
  name: 'Brigade Eldorado',
  microMarket: 'North Bangalore',
  startingPriceInr: 6_500_000,
  startingPriceDisplay: '₹65 L',
  matchReasons: [],
};

describe('searchLocalityWiden', () => {
  it('searches Desk nearby areas after an empty locality', async () => {
    const calls: string[] = [];
    const hit = await searchLocalityWiden({
      asked: 'Jayanagar',
      builderId: 'lokations',
      filters: { bhks: '2 BHK', locations: 'Jayanagar' },
      rejectedProjectIds: [],
      ports: {
        async geoAreasInRegion(region) {
          calls.push(`geo:${region}`);
          return [
            { name: 'North Bangalore', distanceKm: 12 },
            { name: 'Whitefield', distanceKm: 15 },
          ];
        },
        async resolveGeo() {
          return null;
        },
        async projectCoords() {
          return [];
        },
        async search(_b, filters) {
          calls.push(`search:${filters.locations ?? 'none'}`);
          if (filters.locations?.includes('North Bangalore')) return { matches: [NB] };
          return { matches: [] };
        },
      },
    });
    expect(hit).toMatchObject({
      matches: [{ name: 'Brigade Eldorado' }],
      nearbyAreas: ['North Bangalore', 'Whitefield'],
    });
    expect(calls[0]).toBe('geo:Jayanagar');
    expect(calls[1]).toMatch(/North Bangalore/);
  });

  it('falls back to location-less search ranked by ask distance', async () => {
    const far: Match = {
      projectId: 'ayana',
      name: 'Ayana',
      microMarket: 'Sakleshpur',
      startingPriceInr: 2_495_000,
      startingPriceDisplay: '₹24.95 L',
      matchReasons: [],
    };
    const hit = await searchLocalityWiden({
      asked: 'Jayanagar',
      builderId: 'lokations',
      filters: { locations: 'Jayanagar' },
      rejectedProjectIds: [],
      ports: {
        async geoAreasInRegion() {
          return [];
        },
        async resolveGeo() {
          return { lat: 12.93, lng: 77.58 };
        },
        async projectCoords() {
          return [
            { projectId: 'eldorado', lat: 13.139, lng: 77.658 },
            { projectId: 'ayana', lat: 12.944, lng: 75.784 },
          ];
        },
        async search(_b, filters) {
          expect(filters.locations).toBeUndefined();
          return { matches: [far, NB] };
        },
      },
    });
    expect(hit?.matches[0]?.name).toBe('Brigade Eldorado');
  });
});
