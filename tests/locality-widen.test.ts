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

const CATALOG = ['North Bangalore', 'Whitefield', 'Devanahalli', 'Sakleshpur'];

describe('searchLocalityWiden', () => {
  it('widens only into catalog-intersecting LI areas (Jayanagar → Devanahalli)', async () => {
    const hit = await searchLocalityWiden({
      asked: 'Jayanagar',
      builderId: 'lokations',
      filters: { bhks: '2 BHK', locations: 'Jayanagar' },
      rejectedProjectIds: [],
      catalogMarkets: CATALOG,
      ports: {
        async geoAreasInRegion() {
          return [
            { name: 'North Bangalore', distanceKm: 12 },
            { name: 'Whitefield', distanceKm: 15 },
            { name: 'Some Delhi Suburb', distanceKm: 5 },
          ];
        },
        async search(_b, filters) {
          expect(filters.locations).toMatch(/North Bangalore/);
          expect(filters.locations).not.toMatch(/Delhi/);
          return { matches: [NB] };
        },
      },
    });
    expect(hit).toMatchObject({
      matches: [{ name: 'Brigade Eldorado' }],
      nearbyAreas: ['North Bangalore', 'Whitefield'],
    });
  });

  it('returns null for outside metros (Delhi) — no catalog-wide dump', async () => {
    const hit = await searchLocalityWiden({
      asked: 'Delhi',
      builderId: 'lokations',
      filters: { locations: 'Delhi', projectTypes: 'apartment' },
      rejectedProjectIds: [],
      catalogMarkets: CATALOG,
      ports: {
        async geoAreasInRegion() {
          return [{ name: 'Gurugram', distanceKm: 20 }];
        },
        async search() {
          throw new Error('must not search when LI misses catalog');
        },
      },
    });
    expect(hit).toBeNull();
  });
});
