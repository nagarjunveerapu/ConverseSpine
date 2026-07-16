import { describe, it, expect } from 'vitest';
import { canonicalize, vocabSizes } from '../src/nlu/canonicalize.js';

describe('canonicalize', () => {
  it('masks project, builder, place to tokens and lowercases', () => {
    expect(canonicalize('Price of Brigade Oasis in Whitefield')).toBe(
      'price of <project> in <place>',
    );
  });

  it('keeps numbers — BHK/budget are intent signal', () => {
    expect(canonicalize('2BHK under 80 lakh')).toBe('2bhk under 80 lakh');
  });

  it('handles Hinglish surface phrasing', () => {
    expect(canonicalize('1BHK chahiye Sarjapur ke paas')).toBe(
      '1bhk chahiye <place> ke paas',
    );
  });

  it('prefers the longest place phrase (sarjapur road > sarjapur)', () => {
    expect(canonicalize('near Sarjapur Road')).toBe('near <place>');
  });

  it('collapses whitespace and trims', () => {
    expect(canonicalize('  what   is   the   price  ')).toBe('what is the price');
  });

  it('is idempotent on already-masked text', () => {
    const once = canonicalize('rate in Whitefield');
    expect(canonicalize(once)).toBe(once);
  });

  it('is total on empty/degenerate input', () => {
    expect(canonicalize('')).toBe('');
    expect(canonicalize('   ')).toBe('');
  });

  it('bundles a non-trivial vocab', () => {
    expect(vocabSizes.projects).toBeGreaterThan(20);
    expect(vocabSizes.places).toBeGreaterThan(50);
    expect(vocabSizes.builders).toBeGreaterThan(10);
  });
});
