import { describe, it, expect } from 'vitest';
import { mapLocationIntel } from '../src/engine/adapters/nayadesk.js';
import { locationCategoriesAsked, locationEchoesProjectName } from '../src/engine/facts.js';
import { resolveFaqQuestionKeys } from '../src/engine/faq-keys.js';
import { locationSnapshotLine } from '../src/engine/compose.js';

/**
 * S1 — LI evidence unlock. Desk's location_intelligence row (42/42 dev
 * projects have schools populated) previously never reached the bot: the
 * mapper read four field names Desk never serves. These tests pin the real
 * row shape: JSON arrays of {name, distance_km, rating, drive_minutes}.
 */

const ELDORADO_LI = {
  schools:
    '[{"name":"Aditi Kids","distance_km":0.7,"rating":5,"drive_minutes":6},{"name":"Dibber International Preschool Bagalur","distance_km":0.8,"rating":5,"drive_minutes":5}]',
  hospitals: '[{"name":"ABHAY HOSPITAL","distance_km":4.8,"rating":4.1,"drive_minutes":11}]',
  metro_stations: '[{"name":"Benniganahalli","distance_km":16.7,"drive_minutes":62}]',
  airports: '[{"name":"Hindustan Aeronautics Limited Airport","distance_km":21.6,"drive_minutes":87}]',
  it_parks: '[]',
  malls: '[]',
  upcoming_infra: '[]',
};

describe('mapLocationIntel — real Desk row shape', () => {
  it('parses POI categories with distance and drive time', () => {
    const m = mapLocationIntel(ELDORADO_LI);
    expect(m?.schools).toEqual([
      { name: 'Aditi Kids', distanceKm: 0.7, driveMinutes: 6 },
      { name: 'Dibber International Preschool Bagalur', distanceKm: 0.8, driveMinutes: 5 },
    ]);
    expect(m?.metroStations?.[0]?.name).toBe('Benniganahalli');
    expect(m?.airports?.[0]?.driveMinutes).toBe(87);
  });

  it('omits empty categories and returns undefined for empty/null rows', () => {
    const m = mapLocationIntel(ELDORADO_LI);
    expect(m && 'itParks' in m).toBe(false);
    expect(mapLocationIntel(null)).toBeUndefined();
    expect(mapLocationIntel({ schools: '[]', hospitals: '[]' })).toBeUndefined();
    expect(mapLocationIntel({ schools: 'not json' })).toBeUndefined();
  });

  it('derives legacy display strings for the advisor detail panel', () => {
    const m = mapLocationIntel(ELDORADO_LI);
    expect(m?.nearbyPois?.[0]).toBe('Aditi Kids (0.7 km, ~6 min drive)');
    expect(m?.driveTimes?.some((d) => d.includes('Benniganahalli'))).toBe(true);
  });

  it('accepts plain-string entries (upcoming_infra style)', () => {
    const m = mapLocationIntel({ schools: '[]', upcoming_infra: '["Peripheral Ring Road"]' });
    expect(m?.upcomingInfra).toEqual(['Peripheral Ring Road']);
  });
});

describe('locationCategoriesAsked — buyer phrasing → LI category', () => {
  it('detects the common category asks', () => {
    expect(locationCategoriesAsked('schools near Brigade Eldorado')).toEqual(['schools']);
    expect(locationCategoriesAsked('any good hospitals nearby?')).toEqual(['hospitals']);
    expect(locationCategoriesAsked('how far is the metro')).toEqual(['metroStations']);
    expect(locationCategoriesAsked('airport distance?')).toEqual(['airports']);
    expect(locationCategoriesAsked('IT parks around?')).toEqual(['itParks']);
  });

  it('IT parks never counts as green parks', () => {
    expect(locationCategoriesAsked('tech parks near the project')).toEqual(['itParks']);
    expect(locationCategoriesAsked('any parks for kids to play?')).toContain('parks');
  });

  it('returns empty for non-location text', () => {
    expect(locationCategoriesAsked('what is the price of a 2 BHK')).toEqual([]);
  });
});

describe('faq-keys — "schools near X" phrasing routes (S1 regex fix)', () => {
  it('binds nearby_schools/nearby_hospitals without the word "nearby"', () => {
    expect(resolveFaqQuestionKeys('schools near Brigade Eldorado')).toContain('nearby_schools');
    expect(resolveFaqQuestionKeys('schools around the project?')).toContain('nearby_schools');
    expect(resolveFaqQuestionKeys('hospitals close by?')).toContain('nearby_hospitals');
    // original phrasings keep working
    expect(resolveFaqQuestionKeys('nearby schools?')).toContain('nearby_schools');
  });
});

describe('locationEchoesProjectName — "near <project>" is a reference, not a move', () => {
  it('matches the focused project name in either direction', () => {
    expect(locationEchoesProjectName('Brigade Eldorado', ['Brigade Eldorado'])).toBe(true);
    expect(locationEchoesProjectName('eldorado', ['Brigade Eldorado'])).toBe(true);
    expect(locationEchoesProjectName('Brigade Eldorado Phase 2', ['Brigade Eldorado'])).toBe(true);
  });

  it('does not swallow real localities', () => {
    expect(locationEchoesProjectName('Whitefield', ['Brigade Eldorado'])).toBe(false);
    expect(locationEchoesProjectName('Sakleshpur', ['Ayana'])).toBe(false);
    expect(locationEchoesProjectName('Devanahalli', ['Brigade Eldorado', 'Brigade Orchards'])).toBe(false);
  });
});

describe('locationSnapshotLine — asked category leads with named POIs', () => {
  const evidence = {
    projectName: 'Brigade Eldorado',
    microMarket: 'Bagalur',
    schools: [
      { name: 'Aditi Kids', distanceKm: 0.7, driveMinutes: 6 },
      { name: 'Dibber International', distanceKm: 0.8, driveMinutes: 5 },
    ],
    metroStations: [{ name: 'Benniganahalli', distanceKm: 16.7, driveMinutes: 62 }],
  };

  it('renders the asked category with distances, not a generic recap', () => {
    const line = locationSnapshotLine({ ...evidence, askedCategories: ['schools'] });
    expect(line).toContain('Schools nearby');
    expect(line).toContain('Aditi Kids, 0.7 km, ~6 min drive');
    expect(line).not.toContain('Benniganahalli'); // unasked category stays out
  });

  it('falls back to the generic snapshot when nothing specific was asked', () => {
    const line = locationSnapshotLine({
      projectName: 'Brigade Eldorado',
      microMarket: 'Bagalur',
      microMarketOverview: 'North Bengaluru growth corridor',
    });
    expect(line).toContain('North Bengaluru growth corridor');
  });
});
