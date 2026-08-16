/**
 * A reply may only claim a fit it can point at.
 *
 * Ayana is a managed plantation estate. Asked "is 5 BHK available there?" the
 * bot answered "Yes — 3 sizes on file" and listed plots. Every token was a real
 * catalog fact, so grounding passed and no fact-checker fired: a false
 * AFFIRMATIVE, not a hallucination. Measured 16 Aug 2026 against deployed dev,
 * 7 of 8 archetypes asked for a config they cannot have failed the same way —
 * three said "Yes" outright, four answered with plot or villa inventory and
 * never named the mismatch.
 *
 * These cases pin the three answers the summary owes a config ask: yes, "no —
 * and here is what there is", and "that is not how this project is sold".
 */
import { describe, it, expect } from 'vitest';
import { askedConfigFamily, summarizeUnitConfigs } from '../src/engine/compose.js';

const PLANTATION = [
  { unitType: '1 Acre Plot', priceDisplay: '₹1.2 Cr', sizeDisplay: '43,560 sqft' },
  { unitType: '2 Acre Plot', priceDisplay: '₹2.3 Cr', sizeDisplay: '87,120 sqft' },
  { unitType: 'Half Acre Plot', priceDisplay: '₹65 L', sizeDisplay: '21,780 sqft' },
];
const PLOTTED = [
  { unitType: 'Odd Plot', priceDisplay: '₹42 L', sizeDisplay: '1200 sqft' },
  { unitType: 'Corner Plot', priceDisplay: '₹58 L', sizeDisplay: '1500 sqft' },
];
const SINGLE_PLOT = [{ unitType: 'MUDA Plot', priceDisplay: '₹30.0 L', sizeDisplay: '1200 sqft' }];
const VILLAS = [{ unitType: 'Luxury Villa', priceDisplay: '₹4.5 Cr', sizeDisplay: '5000 sqft' }];
const APARTMENT = [
  { unitType: '2 BHK', priceDisplay: '₹65 L', sizeDisplay: '740-1043 sqft' },
  { unitType: '3 BHK', priceDisplay: '₹95 L', sizeDisplay: '1200-1400 sqft' },
];

/** The word that made every one of these replies untrue. */
const claimsAFit = (s: string): boolean => /(^|[:.]\s*)yes\b/i.test(s.replace(/^For \*[^*]+\*:\s*/i, ''));

describe('a BHK ask at a project with no BHK', () => {
  it('does not say yes to 5 BHK at a plantation estate', () => {
    const reply = summarizeUnitConfigs(PLANTATION, 'Ayana', {
      ...askedConfigFamily('is 5 BHK available there?'),
      projectType: 'managed_plantation_estate',
    });
    expect(claimsAFit(reply)).toBe(false);
    expect(reply).toContain('managed plantation estate');
    expect(reply).toMatch(/listed as plots, not BHK/);
    // Still answers — the inventory it DOES have survives the refusal.
    expect(reply).toContain('1 Acre Plot');
  });

  it('names the category for a BHK ask with no number ("what BHK options do you have")', () => {
    const reply = summarizeUnitConfigs(SINGLE_PLOT, 'My-Sooru', {
      ...askedConfigFamily('what BHK options do you have'),
      projectType: 'plotted_development',
    });
    expect(claimsAFit(reply)).toBe(false);
    expect(reply).toMatch(/listed as plots, not BHK/);
    expect(reply).toContain('MUDA Plot');
  });

  it('does not present a villa price as the answer to a BHK yes/no', () => {
    const reply = summarizeUnitConfigs(VILLAS, 'Clarks Exotica', {
      ...askedConfigFamily('is 2 BHK available?'),
      projectType: 'managed_villa_resort',
    });
    expect(claimsAFit(reply)).toBe(false);
    expect(reply).toMatch(/listed as villas, not BHK/);
    expect(reply).toContain('Luxury Villa');
  });

  it('still refuses when the catalog has no project_type to explain why', () => {
    const reply = summarizeUnitConfigs(PLOTTED, 'Viva Greens', {
      ...askedConfigFamily('is 3 bhk available here'),
    });
    expect(claimsAFit(reply)).toBe(false);
    expect(reply).toMatch(/isn't listed by BHK/);
  });

  it('every archetype that cannot have a BHK refuses it', () => {
    const cases: Array<[typeof PLANTATION, string, string]> = [
      [PLANTATION, 'managed_plantation_estate', 'is 5 BHK available there?'],
      [PLANTATION, 'managed_plantation_estate', '4 bhk available?'],
      [PLOTTED, 'plotted_development', 'is 2 BHK available?'],
      [SINGLE_PLOT, 'plotted_development', 'is 3 bhk available here'],
      [VILLAS, 'managed_villa_resort', 'is 2 BHK available?'],
    ];
    for (const [units, projectType, ask] of cases) {
      const reply = summarizeUnitConfigs(units, 'X', { ...askedConfigFamily(ask), projectType });
      expect.soft(claimsAFit(reply), `"${ask}" @ ${projectType} → ${reply}`).toBe(false);
    }
  });
});

describe('a BHK ask at a project that sells BHK', () => {
  it('says no to a family that is not on file, and lists the ones that are', () => {
    const reply = summarizeUnitConfigs(APARTMENT, 'Brigade Eldorado', {
      ...askedConfigFamily('is 5 BHK available?'),
      projectType: 'apartment',
    });
    expect(reply).toMatch(/^No — \*5 BHK\* isn't on file at \*Brigade Eldorado\*/);
    expect(reply).toContain('2 BHK');
    expect(reply).toContain('3 BHK');
  });

  it('still says yes when the asked family IS on file', () => {
    const reply = summarizeUnitConfigs(APARTMENT, 'Brigade Eldorado', {
      ...askedConfigFamily('is 3 BHK available?'),
      projectType: 'apartment',
    });
    expect(claimsAFit(reply)).toBe(true);
    expect(reply).toContain('3 BHK');
  });
});

describe('the sticky-constraint trap', () => {
  // constraints.bhk survives the turn that set it. Reading it as "what was asked
  // NOW" would answer a later generic ask with a no the buyer never asked for.
  it('a generic ask after a BHK turn does not inherit the old no', () => {
    const asked = askedConfigFamily("what's available", { bhk: '5 BHK' });
    expect(asked.inBhkTerms).toBe(false);
    expect(asked.family).toBeUndefined();
    const reply = summarizeUnitConfigs(APARTMENT, 'Brigade Eldorado', {
      ...asked,
      projectType: 'apartment',
    });
    expect(reply).not.toMatch(/No — /);
    expect(claimsAFit(reply)).toBe(true);
  });

  it('the constraint still normalises a spelled-out number the text regex misses', () => {
    const asked = askedConfigFamily('do you have five bhk', { bhk: '5 BHK' });
    expect(asked).toEqual({ family: '5 BHK', inBhkTerms: true });
  });

  it('the buyer’s own digit beats a stale constraint', () => {
    expect(askedConfigFamily('is 2 bhk available', { bhk: '5 BHK' }).family).toBe('2 BHK');
  });

  it('a non-config ask is not a config ask', () => {
    expect(askedConfigFamily('what is the price')).toEqual({ inBhkTerms: false });
    expect(askedConfigFamily(undefined)).toEqual({ inBhkTerms: false });
  });
});

describe('the summary without an ask is unchanged', () => {
  // The honesty branches are opt-in: every caller that does not know what was
  // asked keeps the old copy verbatim, so this change cannot move a reply that
  // was already right.
  it('legacy two-arg calls still summarise families', () => {
    const reply = summarizeUnitConfigs(APARTMENT, 'Brigade Eldorado');
    expect(reply).toMatch(/Exact availability depends on live inventory/);
    expect(claimsAFit(reply)).toBe(true);
  });

  it('an empty book is still an empty book', () => {
    expect(summarizeUnitConfigs([], 'Ayana', { ...askedConfigFamily('is 5 BHK available?') }))
      .toBe("For *Ayana*: configurations aren't published yet");
  });
});
