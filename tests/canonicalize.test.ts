import { describe, it, expect } from 'vitest';
import { canonicalize, makeCanonicalizer, mergeVocab, vocabSizes } from '../src/nlu/canonicalize.js';

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

describe('makeCanonicalizer — injectable live vocab (§7.4)', () => {
  it('masks entities from a NEW catalog vocab the bundle never had', () => {
    // a just-onboarded builder/project/place, unknown to the bundled snapshot
    const canon = makeCanonicalizer({
      places: ['lucknow'],
      builders: ['emaar'],
      projects: ['skyline meadows'],
    });
    expect(canon('price of Skyline Meadows by Emaar in Lucknow'))
      .toBe('price of <project> by <builder> in <place>');
  });

  it('an empty vocab leaves text as intent-shape (never throws)', () => {
    const canon = makeCanonicalizer({ places: [], builders: [], projects: [] });
    expect(canon('what is the price')).toBe('what is the price');
  });

  it('mergeVocab unions and de-duplicates (live catalog ∪ gazetteer seed)', () => {
    const merged = mergeVocab(
      { places: ['whitefield', 'lucknow'], builders: ['emaar'], projects: ['skyline meadows'] },
      { places: ['whitefield', 'sarjapur'], builders: ['brigade'], projects: [] },
    );
    expect(merged.places.sort()).toEqual(['lucknow', 'sarjapur', 'whitefield']);
    expect(merged.builders.sort()).toEqual(['brigade', 'emaar']);
    expect(merged.projects).toEqual(['skyline meadows']);
  });
});
