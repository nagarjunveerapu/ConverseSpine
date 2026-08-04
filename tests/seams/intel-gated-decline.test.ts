/**
 * A refusal must state the reason it is actually refusing for.
 *
 * `turn.ts:3064` blocks `rental_yield` / `resale_value` from the project-FAQ
 * path so the bot never repeats an unsourced percentage. That guard is
 * correct — the 16 rows on dev read "Estimated 3-4% net rental yield … per
 * recent Magicbricks", which is an estimate with someone else's citation, and
 * a bot quoting it is giving investment advice.
 *
 * What was wrong is what the buyer heard. Measured live on dev before this fix:
 *
 *   B: tell me about brigade eldorado
 *   N: *Brigade Eldorado*. 1 BHK, 2 BHK … from ₹31 L. …
 *   B: what is the rental yield here
 *   N: I don't have rental yield on file.
 *
 * "on file" asserts an absence. The truth is a policy — we hold rows and won't
 * quote them, and the sourced substitute (approved corridor rent bands) is
 * empty: all 5 `micro_market_intel` rows carry `rent_bands_json = []`.
 *
 * These probes assert the REASON, not the refusal. The refusal was never in
 * doubt; it is the one thing about this path that was already right.
 */
import { describe, expect, it } from 'vitest';
import { speakFailure } from '../../src/engine/speak-failure.js';

const noData = (subject: string, alternatives?: string[]) =>
  speakFailure({ kind: 'no_data', stage: 'compose', subject } as never, { alternatives });

describe('an intel-gated atom declines for the reason it actually has', () => {
  it('yield says it will not quote an unsourced figure, not that none exists', () => {
    const reply = noData('rental_yield');
    expect(reply).toMatch(/(?:can'?t|don'?t|won'?t)\s+(?:quote|source)|can'?t source/i);
    expect(reply).not.toMatch(/on file/i);
  });

  it('yield names what a sourced answer would need', () => {
    // Without this the buyer cannot tell a policy from a data gap, and has no
    // way to know the answer is obtainable at all.
    expect(noData('rental_yield')).toMatch(/rent data|stated return/i);
  });

  it('yield names the focused project when subjectLabel is passed (CAT-03)', () => {
    const reply = speakFailure(
      { kind: 'no_data', stage: 'compose', subject: 'rental_yield' } as never,
      { subjectLabel: 'Brigade Eldorado' },
    );
    expect(reply).toMatch(/eldorado/i);
    expect(reply).toMatch(/(?:can'?t|don'?t|won'?t)\s+(?:quote|source)|can'?t source/i);
    expect(reply).not.toMatch(/on file/i);
  });

  it('appreciation refuses to put a number on an unsourced trend', () => {
    const reply = noData('appreciation');
    expect(reply).toMatch(/sourced/i);
    expect(reply).not.toMatch(/^I don'?t have appreciation on file/i);
  });

  it('still offers what it does hold', () => {
    expect(noData('rental_yield', ['pricing', 'the cost sheet'])).toMatch(
      /I do have pricing and the cost sheet/,
    );
  });
});

describe('the generic no_data sentence is untouched for real absences', () => {
  it('a genuinely missing atom still says it is not on file', () => {
    // `possession` has no gate — an absent possession date IS an absence, and
    // dressing it up as a policy would be the same lie in the other direction.
    expect(noData('possession')).toBe("I don't have possession on file.");
  });

  it('the education explainer keeps its own line', () => {
    expect(noData('education_explainer')).toMatch(/short explainer/i);
  });
});
