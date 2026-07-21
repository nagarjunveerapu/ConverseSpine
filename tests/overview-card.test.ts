import { describe, it, expect } from 'vitest';
import { fallbackReply, overviewCard, priceBandDisplayFrom, buildComposeRequest, summaryBlurb } from '../src/engine/compose.js';
import type { EvidenceSet } from '../src/engine/types.js';

/**
 * Over-answer structural fix (founder spec): "tell me about X" = a compact
 * card — name + location, config types, ONE price band (low–high FROM
 * CONFIGS), possession — then exactly one probing question. Never the FAQ
 * catalog. detail.faqs now means "answers matched to THIS question" and
 * fetchAnswer is its only writer.
 */
const DETAIL: NonNullable<EvidenceSet['detail']> = {
  projectId: 'brigade-eldorado',
  name: 'Brigade Eldorado',
  microMarket: 'Aerospace Park / Devanahalli Corridor',
  possession: 'Phase-wise; Dioro & Beryl: June 2028',
  startingPriceDisplay: '25-50L', // the stale band that used to contradict
  configurations: [
    { unitType: '1 BHK', priceDisplay: '₹31 L', priceMinInr: 3_100_000, priceMaxInr: 5_000_000 },
    { unitType: '2 BHK', priceDisplay: '₹57.5 L', priceMinInr: 5_750_000, priceMaxInr: 10_500_000 },
    { unitType: '3 BHK', priceDisplay: '₹89 L', priceMinInr: 8_900_000, priceMaxInr: 16_600_000 },
  ],
};

describe('priceBandDisplayFrom (one band truth)', () => {
  it('derives low–high from configs — never the stale entry band', () => {
    expect(priceBandDisplayFrom(DETAIL.configurations!, '25-50L')).toBe('₹31 L – ₹1.66 Cr');
  });
  it('min-only configs → "from ₹X"; no configs → fallback band', () => {
    expect(priceBandDisplayFrom([{ priceMinInr: 3_100_000 }], '25-50L')).toBe('from ₹31 L');
    expect(priceBandDisplayFrom([], '25-50L')).toBe('25-50L');
  });
});

describe('overviewCard', () => {
  const card = overviewCard(DETAIL);

  it('has exactly the founder-spec facts: name, location, types, band, possession', () => {
    expect(card).toContain('*Brigade Eldorado*');
    expect(card).toContain('Aerospace Park / Devanahalli Corridor');
    expect(card).toContain('1 BHK, 2 BHK & 3 BHK');
    expect(card).toContain('₹31 L – ₹1.66 Cr');
    expect(card).toContain('possession Phase-wise; Dioro & Beryl: June 2028');
  });

  it('ends with the single probing question and stays compact', () => {
    expect(card).toMatch(/Want pricing details, unit configurations, or the legal & RERA picture\?$/);
    expect(card.length).toBeLessThan(320); // a card, not an essay
    expect(card).not.toContain('25-50L'); // the contradicting band never renders when configs price
    expect(card).not.toMatch(/\.\./); // no double periods
  });

  it('the overview template path returns the card, never FAQ text', () => {
    const req = buildComposeRequest(
      { kind: 'answer', topic: 'overview', projectId: 'brigade-eldorado' },
      { tools: [], detail: DETAIL } as EvidenceSet,
      { constraints: {} },
    );
    const reply = fallbackReply(req);
    expect(reply).toBe(overviewCard(DETAIL));
    expect(reply).not.toMatch(/airport|Kempegowda|clubhouse/i);
  });

  it('a facet ask with a matched FAQ hit still answers that FAQ (single-owner invariant)', () => {
    const req = buildComposeRequest(
      { kind: 'answer', topic: 'legal', projectId: 'brigade-eldorado' },
      {
        tools: [],
        detail: {
          ...DETAIL,
          faqs: [{ questionKey: 'loan_eligibility', question: 'Loans?', answer: 'Pre-approved by HDFC, ICICI, SBI.' }],
        },
      } as EvidenceSet,
      { constraints: {} },
    );
    const reply = fallbackReply(req);
    expect(reply).toContain('Pre-approved by HDFC, ICICI, SBI.');
    expect(reply).not.toContain('₹31 L – ₹1.66 Cr'); // no card bleed into facet answers
  });
});

describe('overviewCard — catalog summary enrichment (catalog-first)', () => {
  const SUMMARY =
    'Luxury villa community on 18 acres in Devanahalli — 109 exclusive 3/4 BHK villas with private gardens, operated with resort-grade amenities.';

  it('appends the catalog summary line before the probing question', () => {
    const card = overviewCard({ ...DETAIL, summary: SUMMARY });
    expect(card).toContain('Luxury villa community on 18 acres');
    expect(card).toMatch(/Want pricing details, unit configurations, or the legal & RERA picture\?$/);
    // Facts stay intact — the blurb enriches, never replaces.
    expect(card).toContain('₹31 L – ₹1.66 Cr');
  });

  it('no summary → the card is unchanged (byte-identical to today)', () => {
    expect(overviewCard({ ...DETAIL })).toBe(overviewCard(DETAIL));
    expect(overviewCard(DETAIL)).not.toContain('  '); // no stray double space
  });

  it('summaryBlurb caps long text at a sentence boundary and skips junk', () => {
    const long =
      'First sentence about the township masterplan and its phased delivery. ' +
      'Second sentence with a very long tail that would blow the card size well past the two-hundred-and-twenty character cap if it were appended in full without any sentence-boundary trimming at all whatsoever.';
    const blurb = summaryBlurb(long);
    expect(blurb).toBe(' First sentence about the township masterplan and its phased delivery.');
    expect(summaryBlurb('')).toBe('');
    expect(summaryBlurb('apartment')).toBe(''); // a stray token is not a narrative
    expect(summaryBlurb('   ')).toBe('');
  });
});
