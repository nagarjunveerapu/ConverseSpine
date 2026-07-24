import { describe, expect, it } from 'vitest';
import {
  collapseCoverageMarkets,
  coverageCityCoverBit,
  coverageCoverBit,
  matchServedMarket,
  orderCoverageMarkets,
  outsideServedReply,
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
    // Intentionally far from "Sarjapur" — beyond ≤3 edit distance on long tokens.
    expect(
      matchServedMarket('zzzzzzzz', ['Sarjapur Road', 'Whitefield']),
    ).toBeUndefined();
  });
});

describe('orderCoverageMarkets', () => {
  const markets = [
    'Sakleshpur',
    'Virajpet',
    'North Bangalore',
    'Coorg',
    'Devanahalli',
  ];
  const anchors = [
    { microMarket: 'Sakleshpur', lat: 12.944, lng: 75.784 },
    { microMarket: 'Virajpet', lat: 12.254, lng: 75.923 },
    { microMarket: 'North Bangalore', lat: 13.139, lng: 77.658 },
    { microMarket: 'Devanahalli', lat: 13.18, lng: 77.68 },
  ];

  it('prefers markets nearest the asked place when ask coords exist', () => {
    // Gurgaon — NCR; Bangalore inventory is closer than Western Ghats.
    const ordered = orderCoverageMarkets(markets, {
      ask: { lat: 28.46, lng: 77.03 },
      anchors,
    });
    const top = ordered.slice(0, 2);
    expect(top).toContain('North Bangalore');
    expect(top).toContain('Devanahalli');
    expect(ordered.indexOf('North Bangalore')).toBeLessThan(ordered.indexOf('Sakleshpur'));
    expect(ordered.indexOf('Devanahalli')).toBeLessThan(ordered.indexOf('Sakleshpur'));
  });

  it('falls back to inventory-hub nearest when ask has no coords', () => {
    const ordered = orderCoverageMarkets(markets, { anchors });
    expect(ordered.indexOf('North Bangalore')).toBeLessThan(ordered.indexOf('Sakleshpur'));
    expect(ordered.indexOf('Devanahalli')).toBeLessThan(ordered.indexOf('Virajpet'));
  });

  it('keeps catalog order when there is nothing to rank with', () => {
    expect(orderCoverageMarkets(markets)).toEqual(markets);
  });

  it('surfaces Bangalore corridors first in the cover bit under inventory hub', () => {
    const bit = coverageCoverBit(markets, { anchors });
    expect(bit).toMatch(/^I currently cover North Bangalore, Devanahalli/);
    expect(bit).not.toMatch(/^I currently cover Sakleshpur/);
  });
});

describe('coverageCityCoverBit / outsideServedReply', () => {
  it('speaks inventory in served cities — not project lists', () => {
    expect(coverageCityCoverBit(['Bengaluru'], 'apartment')).toBe(
      'I have apartments in Bengaluru',
    );
    expect(coverageCityCoverBit(['Bengaluru', 'Kodagu'], 'villa')).toBe(
      'I have villas in Bengaluru and Kodagu',
    );
    expect(coverageCityCoverBit(['Bengaluru', 'Hassan', 'Kodagu'])).toBe(
      'I have homes in Bengaluru, Hassan, and Kodagu',
    );
  });

  it('returns null when no cities — outsideServed falls back to corridors', () => {
    expect(coverageCityCoverBit([])).toBeNull();
    const reply = outsideServedReply('Gurgaon', ['North Bangalore', 'Sakleshpur'], {
      servedCities: [],
    });
    expect(reply).toMatch(/don't have homes in \*Gurgaon\*/i);
    expect(reply).toMatch(/currently cover North Bangalore/);
  });

  it('prefers city inventory copy over corridor list', () => {
    const reply = outsideServedReply('Delhi', ['Sakleshpur', 'North Bangalore'], {
      servedCities: ['Bengaluru'],
      propertyType: 'apartment',
    });
    expect(reply).toBe(
      "I don't have apartments in *Delhi* — I have apartments in Bengaluru. Want to look there?",
    );
    expect(reply).not.toMatch(/Sakleshpur|Eldorado|currently cover|micro-markets/i);
  });
});
