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
  it('widens via LI ∩ catalog (Jayanagar → North Bangalore markets)', async () => {
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
          ];
        },
        async resolveGeo() {
          return null;
        },
        async projectCoords() {
          return [];
        },
        async search(_b, filters) {
          expect(filters.locations).toMatch(/North Bangalore/);
          return { matches: [NB] };
        },
      },
    });
    expect(hit?.nearbyAreas).toEqual(['North Bangalore', 'Whitefield']);
    expect(hit?.matches[0]?.name).toBe('Brigade Eldorado');
  });

  it('widens via ask-distance when LI misses but ask is near inventory', async () => {
    const hit = await searchLocalityWiden({
      asked: 'Jayanagar',
      builderId: 'lokations',
      filters: { locations: 'Jayanagar' },
      rejectedProjectIds: [],
      catalogMarkets: CATALOG,
      ports: {
        async geoAreasInRegion() {
          return [];
        },
        async resolveGeo() {
          return { lat: 12.9308, lng: 77.5838 }; // Jayanagar
        },
        async projectCoords() {
          return [
            { projectId: 'eldorado', lat: 13.139, lng: 77.658, microMarket: 'North Bangalore' },
            { projectId: 'cornerstone', lat: 13.18, lng: 77.68, microMarket: 'Devanahalli' },
            { projectId: 'ayana', lat: 12.944, lng: 75.784, microMarket: 'Sakleshpur' },
          ];
        },
        async search(_b, filters) {
          expect(filters.locations).toMatch(/North Bangalore|Devanahalli/);
          expect(filters.locations).not.toMatch(/Sakleshpur/);
          return { matches: [NB] };
        },
      },
    });
    expect(hit?.nearbyAreas[0]).toBe('North Bangalore');
    expect(hit?.nearbyAreas).not.toContain('Sakleshpur');
  });

  it('returns null for Delhi — far from inventory, no catalog dump', async () => {
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
        async resolveGeo() {
          return { lat: 28.61, lng: 77.21 }; // Delhi
        },
        async projectCoords() {
          return [
            { projectId: 'eldorado', lat: 13.139, lng: 77.658, microMarket: 'North Bangalore' },
          ];
        },
        async search() {
          throw new Error('must not search for far outside-served asks');
        },
      },
    });
    expect(hit).toBeNull();
  });
});
