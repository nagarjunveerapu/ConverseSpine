import { describe, it, expect } from 'vitest';
import { formatCostValue, formatPossession, startingPriceDisplayFrom } from '../src/engine/compose.js';

/**
 * W4 — format once, at the adapter. Each case below is a REAL defect from a
 * dev transcript (audit 2026-07-12): "Base land price 499, Stamp Duty 5,
 * Registration Charges 15000", "possession Ready to register", "possession
 * Phase-wise; … ready for possession..", and "from ₹31 L" vs "from 25-50L"
 * disagreeing inside one conversation.
 */
describe('formatCostValue — kind is the authoritative unit (P2.2 fix)', () => {
  // Desk ships {value, kind}; kind IS the unit. Ayana's base land price is
  // kind='per_sqft', value='499' → ₹499/sqft, NOT the ₹499 total the bot used
  // to narrate next to a ₹24.95 L starting price.
  it('per_sqft renders the /sqft rate, never a bare ₹ total', () => {
    expect(formatCostValue('Base land price', '499', 'per_sqft')).toBe('₹499/sqft');
    expect(formatCostValue('Base land price', '650', 'per_sqft')).toBe('₹650/sqft');
  });
  it('percent / flat / info format by kind', () => {
    expect(formatCostValue('Stamp Duty', '5', 'percent')).toBe('5%');
    expect(formatCostValue('Registration Charges', '15000', 'flat')).toBe('₹15,000');
    expect(formatCostValue('Base price', '7100000', 'flat')).toBe('₹71 L');
    expect(formatCostValue('Infrastructure', 'Included', 'info')).toBe('Included');
  });
  it('a value already carrying its unit passes through untouched', () => {
    expect(formatCostValue('Base land price', '₹499/sqft', 'per_sqft')).toBe('₹499/sqft');
  });
});

describe('formatCostValue — no-kind fallback (older payloads, honesty-first)', () => {
  it('guesses conservatively from the label, never inventing /sqft', () => {
    expect(formatCostValue('Base land price', '499')).toBe('₹499'); // no kind → cannot know it is /sqft
    expect(formatCostValue('Stamp Duty', '5')).toBe('5%');
    expect(formatCostValue('Registration Charges', '15000')).toBe('₹15,000');
  });
  it('passes through already-formatted values untouched', () => {
    expect(formatCostValue('Stamp Duty', '5% of land value')).toBe('5% of land value');
    expect(formatCostValue('Infrastructure Development Charges', 'Included')).toBe('Included');
    expect(formatCostValue('Base plot price', 'From ₹39 L for 7,000 sqft')).toBe('From ₹39 L for 7,000 sqft');
  });
  it('large bare numbers become lakh/crore', () => {
    expect(formatCostValue('Base price', '7100000')).toBe('₹71 L');
    expect(formatCostValue('Total', '24100000')).toBe('₹2.41 Cr');
  });
  it('a bare 5 on a non-percent label is money, not percent', () => {
    expect(formatCostValue('Clubhouse levy', '5')).toBe('₹5');
  });
  it('comma-grouped bare numbers still format', () => {
    expect(formatCostValue('Registration', '15,000')).toBe('₹15,000');
  });
});

describe('formatPossession', () => {
  it('strips the double-period run-on and trims long notes to the first clause', () => {
    expect(formatPossession('Phase-wise; Dioro & Beryl: June 2028. Earlier phases ready for possession..'))
      .toBe('Phase-wise; Dioro & Beryl: June 2028'); // first sentence keeps the date
  });
  it('short strings pass through without a trailing period', () => {
    expect(formatPossession('Ready to register')).toBe('Ready to register');
    expect(formatPossession('Dec 2027.')).toBe('Dec 2027');
  });
});

describe('startingPriceDisplayFrom (one price truth)', () => {
  it('uses the min config price — the same number the search rail shows', () => {
    expect(startingPriceDisplayFrom([3_100_000, 5_750_000, 8_900_000], '25-50L')).toBe('₹31 L');
  });
  it('falls back to the configured band only when no config carries a price', () => {
    expect(startingPriceDisplayFrom([0, 0], '25-50L')).toBe('25-50L');
    expect(startingPriceDisplayFrom([], undefined)).toBe('');
  });
});
