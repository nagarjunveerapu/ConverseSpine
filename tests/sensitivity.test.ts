import { describe, it, expect } from 'vitest';
import { matchFitClauses, sensitivityLine } from '../src/engine/sensitivity.js';
import { parseAskSizeSqft } from '../src/advisor/apply-preferences.js';
import type { Match } from '../src/engine/types.js';

// Four-questions voice — receipts become clauses here and nowhere else.
// Fixtures mirror the farmland transcript trio: trust-worried buyer,
// quarter-acre ask, nobody with a builder record on file.

const m = (over: Partial<Match>): Match => ({
  projectId: 'p1',
  name: 'Vanam',
  microMarket: 'Kanakapura',
  startingPriceInr: 3_000_000,
  startingPriceDisplay: '₹30 L',
  matchReasons: [],
  ...over,
});

describe('matchFitClauses — Q1 + Q2 per match', () => {
  it('renders top gain, top cost, and the absence, in that order', () => {
    const line = matchFitClauses(m({
      dimensionFit: [
        { dimension: 'budget', score: 1, weight: 0.9, evidence: 'your 10,000 sqft ≈ ₹50 L — within budget', good: true },
        { dimension: 'commute', score: 0.2, weight: 0.5, evidence: '131 min to work hubs', good: false },
      ],
      dimensionGap: { dimension: 'builder_trust', weight: 0.9, label: 'no builder record here yet' },
    }));
    expect(line).toBe('✓ your 10,000 sqft ≈ ₹50 L — within budget · ⚠ 131 min to work hubs · ? no builder record here yet');
  });

  it('caps at three clauses — scannable on every channel', () => {
    const line = matchFitClauses(m({
      dimensionFit: [
        { dimension: 'budget', score: 1, weight: 0.9, evidence: 'a', good: true },
        { dimension: 'schools', score: 1, weight: 0.8, evidence: 'b', good: true },
        { dimension: 'commute', score: 0.1, weight: 0.7, evidence: 'c', good: false },
        { dimension: 'value', score: 0.2, weight: 0.6, evidence: 'd', good: false },
      ],
      dimensionGap: { dimension: 'builder_trust', weight: 0.9, label: 'e' },
    }));
    expect(line.split(' · ')).toHaveLength(3);
  });

  it('nothing negative and room left → a second earned gain may speak', () => {
    const line = matchFitClauses(m({
      dimensionFit: [
        { dimension: 'budget', score: 1, weight: 0.9, evidence: 'within budget', good: true },
        { dimension: 'schools', score: 0.9, weight: 0.7, evidence: 'school 6 min away', good: true },
      ],
    }));
    expect(line).toBe('✓ within budget · ✓ school 6 min away');
  });

  it('no receipts → Desk note fallback; no note → empty (never invents)', () => {
    expect(matchFitClauses(m({ tradeoffNote: '✓ within your budget' }))).toBe('✓ within your budget');
    expect(matchFitClauses(m({}))).toBe('');
  });

  it('receipts present → the note never ADDS (one voice)', () => {
    const line = matchFitClauses(m({
      tradeoffNote: 'stale desk sentence',
      dimensionFit: [{ dimension: 'budget', score: 1, weight: 0.9, evidence: 'within budget', good: true }],
    }));
    expect(line).toBe('✓ within budget');
  });
});

describe('sensitivityLine — Q3 for the shortlist', () => {
  const vanam = m({
    name: 'Vanam',
    dimensionFit: [{ dimension: 'budget', score: 1, weight: 0.9, evidence: '≈ ₹50 L — within budget', good: true }],
    dimensionGap: { dimension: 'builder_trust', weight: 0.9, label: 'no builder record here yet' },
  });
  const krishnaja = m({
    projectId: 'p2', name: 'Krishnaja Greens', microMarket: 'Virajpet',
    dimensionFit: [{ dimension: 'budget', score: 1, weight: 0.9, evidence: 'within budget', good: true }],
    dimensionGap: { dimension: 'builder_trust', weight: 0.9, label: 'no builder record here yet' },
  });

  it("the buyer's bar blind across the whole shortlist → says so + names today's leader", () => {
    const line = sensitivityLine([vanam, krishnaja]);
    expect(line).toContain('None of these has the builder record on file yet');
    expect(line).toContain('flagged');
    expect(line).toContain('*Vanam* leads');
  });

  it('one project clears the bar → it is named on the bar, with the fork if another dimension crowns a different one', () => {
    const withRecord = m({
      projectId: 'p3', name: 'Eldorado', microMarket: 'Aerospace Park',
      dimensionFit: [
        { dimension: 'builder_trust', score: 0.9, weight: 0.9, evidence: 'clean K-RERA record', good: true },
        { dimension: 'budget', score: 0.6, weight: 0.9, evidence: '₹5 L over your budget', good: false },
      ],
    });
    const line = sensitivityLine([vanam, withRecord]);
    expect(line).toContain('If the builder record rules, *Eldorado* leads today');
    expect(line).toContain('if price matters more, *Vanam*');
  });

  it('single match or no weighted dimensions → silence, never filler', () => {
    expect(sensitivityLine([vanam])).toBe('');
    expect(sensitivityLine([m({}), m({ projectId: 'p2', name: 'B' })])).toBe('');
  });

  it('an unknown future dimension degrades to its raw key, never dropped', () => {
    const a = m({ dimensionFit: [{ dimension: 'noise_levels', score: 1, weight: 0.9, evidence: 'quiet street', good: true }] });
    const b = m({ projectId: 'p2', name: 'B', dimensionGap: { dimension: 'noise_levels', weight: 0.9, label: 'no noise data yet' } });
    expect(sensitivityLine([a, b])).toContain('noise levels');
  });
});

describe('parseAskSizeSqft — the ask rides inside the buyer’s own config words', () => {
  it('parses Indian-formatted sqft from chip labels', () => {
    expect(parseAskSizeSqft('Managed Farmland Plot, Quarter-Acre Plot (10,000 sqft)')).toBe(10000);
    expect(parseAskSizeSqft('1200 sq ft plot')).toBe(1200);
    expect(parseAskSizeSqft('Entry Plot (7,000 sq. ft)')).toBe(7000);
  });
  it('no size stated → null, never a guess', () => {
    expect(parseAskSizeSqft('2 BHK, 3 BHK')).toBeNull();
    expect(parseAskSizeSqft('')).toBeNull();
  });
});
