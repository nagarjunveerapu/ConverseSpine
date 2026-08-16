/**
 * A category error is not a data gap, and it is not a "Yes" either.
 *
 * Measured on deployed dev, 16 Aug 2026, naya-advisor (21 projects: apartment
 * 10 · plotted 6 · managed_plantation_estate 3 · villa 1 · villa resort 1).
 * Seven asks that named a category the project does not have, seven wrong
 * replies, in three shapes:
 *
 *   told as a data gap
 *     Brigade Eldorado (apartment) · "what plot sizes do you have"
 *       → "I don't have that detail on file for *Brigade Eldorado* yet."
 *   answered "Yes" with the OTHER category's inventory
 *     Brigade Cornerstone (apartment) · "what is the plot area"
 *       → "Yes — 4 sizes on file (1 BHK, 2 BHK, 3 BHK, Studio)."
 *     Ayana (plantation) · "what apartments are available"
 *       → "Yes — 3 sizes on file (5,000 sqft Plot, …)."
 *   taken as a preference and the project abandoned
 *     Brigade Oasis (plotted) · "what apartments do you have"
 *       → "Got it — apartment. We've got homes on the books, from ₹24.95 L."
 *
 * The third shape is a different seam (the ask never reaches this composer) and
 * is NOT fixed here — see the PR.
 */
import { describe, expect, it } from 'vitest';
import {
  askedInventoryCategory,
  categoryMismatchLine,
  summarizeUnitConfigs,
} from '../src/engine/compose.js';

const BHK_UNITS = [
  { unitType: '1 BHK', priceDisplay: '₹31 L', sizeDisplay: '521-600 sqft' },
  { unitType: '2 BHK', priceDisplay: '₹52 L', sizeDisplay: '740-1043 sqft' },
  { unitType: 'Studio', priceDisplay: '₹28 L', sizeDisplay: '533-573 sqft' },
];
const PLOT_UNITS = [
  { unitType: '30x40 Plot (1200 sqft)', priceDisplay: '₹45 L', sizeDisplay: '1200 sqft' },
  { unitType: '30x50 Plot (1500 sqft)', priceDisplay: '₹56 L', sizeDisplay: '1500 sqft' },
];
const PLANTATION_UNITS = [
  { unitType: '5,000 sqft Plot', priceDisplay: '₹40 L', sizeDisplay: '5000 sqft' },
  { unitType: 'Quarter-Acre Plot (10,000 sqft)', priceDisplay: '₹78 L', sizeDisplay: '10000 sqft' },
];

describe('the category the buyer named', () => {
  it('reads one category from the turn, using the existing authority', () => {
    expect.soft(askedInventoryCategory('what plot sizes do you have')).toBe('plot');
    expect.soft(askedInventoryCategory('what is the plot area')).toBe('plot');
    expect.soft(askedInventoryCategory('what apartments are available')).toBe('apartment');
    expect.soft(askedInventoryCategory('show me the flats here')).toBe('apartment');
    expect.soft(askedInventoryCategory('tell me about the villas')).toBe('villa');
  });

  it('claims nothing when no category is named, or when two are', () => {
    // Two categories in one breath is a question about the range, not a claim
    // about either — answering "there are no villas there" would be a non-sequitur.
    expect.soft(askedInventoryCategory('apartments or villas?')).toBeUndefined();
    expect.soft(askedInventoryCategory('what configurations do you have')).toBeUndefined();
    expect.soft(askedInventoryCategory('is 3 BHK available?')).toBeUndefined();
    expect.soft(askedInventoryCategory('')).toBeUndefined();
  });
});

describe('a category error is named, not reported as a missing field', () => {
  it('plots asked of an apartment project', () => {
    const line = categoryMismatchLine(
      { projectType: 'apartment', category: 'plot' },
      BHK_UNITS,
      'Brigade Eldorado',
    );
    expect(line).toContain('*Brigade Eldorado*');
    // "a apartment project" shipped in the first live run — the article has to
    // agree with the type word, which is catalog data, not a constant.
    expect(line).toContain('an *apartment project*');
    expect(line).toContain('no plots');
  });

  it('apartments asked of a plotted development', () => {
    const line = categoryMismatchLine(
      { projectType: 'plotted', category: 'apartment' },
      PLOT_UNITS,
      'Brigade Oasis',
    );
    expect(line).toContain('a *plotted development*');
    expect(line).toContain('no apartments');
  });

  it('apartments asked of a plantation estate — the units settle it, not the type string', () => {
    const line = categoryMismatchLine(
      { projectType: 'managed_plantation_estate', category: 'apartment' },
      PLANTATION_UNITS,
      'Ayana',
    );
    expect(line).toContain('a *managed plantation estate*');
    expect(line).toContain('no apartments');
  });

  it('says nothing when the category DOES apply', () => {
    // Plots asked of a plotted development; plots asked of a plantation estate
    // whose book lists plots. Both are ordinary questions with ordinary answers.
    expect
      .soft(categoryMismatchLine({ projectType: 'plotted', category: 'plot' }, PLOT_UNITS, 'Brigade Oasis'))
      .toBeUndefined();
    expect
      .soft(
        categoryMismatchLine(
          { projectType: 'managed_plantation_estate', category: 'plot' },
          PLANTATION_UNITS,
          'Ayana',
        ),
      )
      .toBeUndefined();
  });

  it('says nothing when it knows too little to claim one', () => {
    // No category named, or nothing known about what the project holds. A no
    // may only be said about a book we can actually see.
    expect.soft(categoryMismatchLine(undefined, BHK_UNITS, 'X')).toBeUndefined();
    expect.soft(categoryMismatchLine({ category: 'plot' }, [], 'X')).toBeUndefined();
  });
});

describe('the config summary answers the category before it answers anything', () => {
  it('does not say "Yes" and list BHK to a plot question', () => {
    const out = summarizeUnitConfigs(BHK_UNITS, 'Brigade Cornerstone', {
      projectType: 'apartment',
      category: 'plot',
      inBhkTerms: false,
    });
    expect(out).not.toMatch(/\byes\b/i);
    expect(out).toContain('no plots');
    // It still hands back what IS on file — a correction, not a dead end.
    expect(out).toContain('1 BHK');
  });

  it('does not say "Yes" and list plots to an apartment question', () => {
    const out = summarizeUnitConfigs(PLANTATION_UNITS, 'Ayana', {
      projectType: 'managed_plantation_estate',
      category: 'apartment',
      inBhkTerms: false,
    });
    expect(out).not.toMatch(/\byes\b/i);
    expect(out).toContain('no apartments');
  });

  it('leaves a matching category ask exactly as it was', () => {
    const out = summarizeUnitConfigs(PLOT_UNITS, 'Brigade Oasis', {
      projectType: 'plotted',
      category: 'plot',
      inBhkTerms: false,
    });
    expect(out).toContain('Yes');
    expect(out).not.toContain('no plots');
  });

  it('leaves a caller that named no category exactly as it was', () => {
    const out = summarizeUnitConfigs(BHK_UNITS, 'Brigade Eldorado', {
      projectType: 'apartment',
      inBhkTerms: false,
    });
    expect(out).toContain('Yes');
  });
});
