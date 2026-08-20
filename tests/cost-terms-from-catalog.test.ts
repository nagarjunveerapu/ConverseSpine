import { describe, expect, it } from 'vitest';
import { costTermsFromCostSheet, matchesCostTerm } from '../src/engine/cost-terms.js';
import { isCostComponentAsk } from '../src/engine/facts.js';

/**
 * Desk has served `cost_sheet[].match_terms` since #212, with a comment saying
 * it exists so the bot can detect a cost-component ask "with no hardcoded
 * vocabulary". This side read a twenty-phrase regex instead and dropped the
 * field at the type boundary — both halves of the contract built, never joined.
 *
 * The regex is not deleted. It is the floor for turns before any project is
 * focused, and for the asks every builder shares.
 */

const SHEET = [
  { label: 'Floor rise charges', kind: 'other', match_terms: ['floor rise', 'floor-rise'] },
  { label: 'BESCOM charges', kind: 'statutory', match_terms: ['bescom', 'bescom charges'] },
  { label: 'Corner premium', kind: 'plc', match_terms: ['corner premium', 'corner'] },
  { label: 'Plantation management', kind: 'other', match_terms: ['plantation', 'plantation management'] },
];

describe('the builder names its own cost heads', () => {
  it('takes the terms straight off the sheet', () => {
    const terms = costTermsFromCostSheet(SHEET);
    expect(terms).toContain('floor rise');
    expect(terms).toContain('bescom');
    expect(terms).toContain('corner premium');
  });

  it('drops a bare token that means something else in this catalog', () => {
    // "plantation" is a PROPERTY TYPE here. A lone occurrence must not turn
    // "show me plantation land" into a price ask — but the phrase survives.
    const terms = costTermsFromCostSheet(SHEET);
    expect(terms).not.toContain('plantation');
    expect(terms).toContain('plantation management');
  });

  it('survives a project with no sheet, and a row with no terms', () => {
    expect(costTermsFromCostSheet(undefined)).toEqual([]);
    expect(costTermsFromCostSheet([{ label: 'x' }])).toEqual([]);
  });
});

describe('matching buyer text against them', () => {
  const terms = costTermsFromCostSheet(SHEET);

  it('recognises a head this codebase never hardcoded', () => {
    expect(matchesCostTerm('what are the BESCOM charges?', terms)).toBe(true);
    expect(matchesCostTerm('is there a corner premium', terms)).toBe(true);
  });

  it('matches a single token whole-word, so corpus does not fire on corporate', () => {
    const t = costTermsFromCostSheet([{ match_terms: ['corpus'] }]);
    expect(matchesCostTerm('what is the corpus fund', t)).toBe(true);
    expect(matchesCostTerm('is this a corporate lease', t)).toBe(false);
  });

  it('says no when the project has no terms cached', () => {
    expect(matchesCostTerm('bescom charges', undefined)).toBe(false);
    expect(matchesCostTerm('bescom charges', [])).toBe(false);
  });
});

describe('isCostComponentAsk keeps its floor and gains the tail', () => {
  const terms = costTermsFromCostSheet(SHEET);

  it('still answers the universal asks with no terms at all', () => {
    // Turns before any project is focused must behave exactly as before.
    expect(isCostComponentAsk('what is the stamp duty')).toBe(true);
    expect(isCostComponentAsk('registration charges?')).toBe(true);
    expect(isCostComponentAsk('is it near the metro')).toBe(false);
  });

  it('only recognises the per-project tail once the terms are cached', () => {
    expect(isCostComponentAsk('what are the bescom charges')).toBe(false);
    expect(isCostComponentAsk('what are the bescom charges', terms)).toBe(true);
  });
});
