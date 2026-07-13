import { describe, it, expect } from 'vitest';
import { detectTopics, isCostComponentAsk } from '../src/engine/facts.js';
import { shouldRunTurnIntent } from '../src/engine/turn-intent/classify.js';
import { initState } from '../src/engine/state.js';

/**
 * W7 (audit P0.3) — cost-sheet component asks must classify as the `price`
 * topic so they reach the pricing evidence instead of falling to no_fit.
 * Dev repro (focused on Ayana): "stamp duty?" and "total charges and taxes?"
 * answered "which project?" because the price regex only knew "cost"/"price".
 * Scoped to avoid collisions: RERA "registration" stays legal, "maintenance
 * charges" stays its own FAQ — only cost-qualified forms are price asks.
 */
describe('detectTopics — cost-sheet components are price asks (W7)', () => {
  it('routes stamp duty / registration charges / taxes / cost sheet to price', () => {
    expect(detectTopics('stamp duty?')).toContain('price');
    expect(detectTopics('what are the registration charges')).toContain('price');
    expect(detectTopics('total charges and taxes?')).toContain('price');
    expect(detectTopics('is there any gst')).toContain('price');
    expect(detectTopics('show me the cost sheet')).toContain('price');
  });

  it('does NOT hijack the maintenance FAQ or RERA-registration (legal)', () => {
    expect(detectTopics('maintenance charges?')).not.toContain('price');
    expect(detectTopics('what is the RERA registration')).not.toContain('price');
  });

  it('still recognises the original price vocabulary', () => {
    expect(detectTopics('what is the all-in cost')).toContain('price');
    expect(detectTopics('how much for a 2 bhk')).toContain('price');
  });
});

describe('isCostComponentAsk — unambiguous cost-sheet vocabulary only', () => {
  it('matches cost components', () => {
    for (const t of ['stamp duty?', 'registration charges?', 'total charges and taxes?', 'is there gst', 'cost sheet please']) {
      expect(isCostComponentAsk(t)).toBe(true);
    }
  });
  it('does NOT match maintenance / RERA-registration / plain price talk', () => {
    for (const t of ['maintenance charges?', 'RERA registration number', 'how much is it', 'what is the price']) {
      expect(isCostComponentAsk(t)).toBe(false);
    }
  });
  it('bare tax(es) is excluded — property/income tax must not steal into cost (review nit)', () => {
    expect(isCostComponentAsk('is there property tax?')).toBe(false);
    expect(isCostComponentAsk('any income tax benefit?')).toBe(false);
    // …but a cost neighbour still grounds it:
    expect(isCostComponentAsk('total charges and taxes?')).toBe(true);
  });
  it('data-driven: matches the focused project cost terms — the long tail (NayaDesk #212)', () => {
    // Terms the regex could never know, supplied from Desk cost_sheet.match_terms.
    const ayana = ['floor rise', 'floor', 'bescom', 'corner', 'plantation management'];
    expect(isCostComponentAsk('what is the floor rise?', ayana)).toBe(true);
    expect(isCostComponentAsk('any BESCOM charges?', ayana)).toBe(true);
    expect(isCostComponentAsk('is there a corner premium?', ayana)).toBe(true);
    // No terms → the long tail is NOT recognised by the universal regex alone:
    expect(isCostComponentAsk('what is the floor rise?')).toBe(false);
    // Universal regex still fires regardless of the project terms:
    expect(isCostComponentAsk('stamp duty?', ayana)).toBe(true);
  });
});

describe('shouldRunTurnIntent — focused cost ask skips the RTI probe (W7)', () => {
  const focused = {
    ...initState('c1', 'lokations'),
    phase: 'focused' as const,
    focus: { projectId: 'ayana-lokations', projectName: 'Ayana' },
  };
  it('a focused cost-sheet ask bypasses the search-recovery probe', () => {
    expect(shouldRunTurnIntent(focused, undefined, 'stamp duty?')).toBe(false);
    expect(shouldRunTurnIntent(focused, undefined, 'registration charges?')).toBe(false);
    expect(shouldRunTurnIntent(focused, undefined, 'what are the total charges and taxes?')).toBe(false);
  });
});
