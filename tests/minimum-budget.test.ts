import { describe, expect, it } from 'vitest';
import { parseBudgetToInr, isMinimumBudgetForTypeQuestion } from '../src/engine/facts.js';
import { minimumBudgetReply } from '../src/engine/compose.js';

describe('minimum budget recovery (RTI-2.1)', () => {
  it('parses glued crore in free text', () => {
    expect(parseBudgetToInr('budget increase to 3Cr')?.max).toBe(30_000_000);
    expect(parseBudgetToInr('budget increase to 3 cr')?.max).toBe(30_000_000);
  });

  it('detects minimum budget questions', () => {
    expect(isMinimumBudgetForTypeQuestion('what is the minimum budget I need to have the villa')).toBe(
      true,
    );
    expect(isMinimumBudgetForTypeQuestion('budget increase to 3Cr')).toBe(false);
  });

  it('composes type floor reply with buyer brief', () => {
    const reply = minimumBudgetReply(
      'Villa',
      { name: 'Palm Grove', display: '₹1.2 Cr' },
      5_000_000,
    );
    expect(reply).toMatch(/Villas on our books start from/);
    expect(reply).toMatch(/Palm Grove/);
    expect(reply).toMatch(/₹50 L/);
  });
});

// ── Narrative-money guards (ten-buyers scorecard, RUN 4q-base-1784715487) ────
// An amount the buyer HAS, PAYS, or LOST is not a price bound; a numbered
// list marker is not a price; a bare digit inside prose is not a price.
import { parseBudgetToInr as parseBudget4q } from '../src/engine/facts.js';

describe('parseBudgetToInr — narrative money never becomes a budget', () => {
  it('savings are not a budget (S01 Meera)', () => {
    expect(parseBudget4q('hi. i want to buy a flat? me and my mom. i have like 12 lakhs saved')).toBeNull();
  });
  it('numbered-list markers are not lakhs (S02 Colonel)', () => {
    expect(parseBudget4q('(1) I prefer ground floor as my knee does not permit stairs')).toBeNull();
    expect(parseBudget4q('Before that, kindly revert on point (3) registration, which you had held.')).toBeNull();
  });
  it('a story amount is not a budget (S03 Rafiq, 2019)', () => {
    expect(parseBudget4q('i booked in 2019. builder took 40 lakhs. 3 years nothing moved. how do YOU make money')).toBeNull();
  });
  it('down payment and take-home are not budgets (S05 Deepak)', () => {
    expect(parseBudget4q('fine. take home 85k. 13L down payment')).toBeNull();
  });
  it('a bare digit inside prose is narration, not a probe answer', () => {
    expect(parseBudget4q('we are a family looking to move sometime next year maybe 2')).toBeNull();
  });
  it('real budgets still parse — anchored, ranged, and probe answers', () => {
    expect(parseBudget4q('budget max 70')?.max).toBe(7_000_000);
    expect(parseBudget4q('2bhk. 55-60 max')?.max).toBe(6_000_000);
    expect(parseBudget4q('around 60')?.max).toBe(6_000_000);
    expect(parseBudget4q('70')?.max).toBe(7_000_000);
    expect(parseBudget4q('under 1.2 cr')?.max).toBe(12_000_000);
  });

  it('gibberish / sub-lakh bare numbers never become a budget (C6)', () => {
    // the live boundary: a stray number in gibberish coerced to ₹0.12 L
    expect(parseBudget4q('asdfghjkl 12345 qwerty zxcvbn')).toBeNull();
    expect(parseBudget4q('50000')).toBeNull(); // ₹50k is not a home budget
    expect(parseBudget4q('150')).toBeNull(); // ambiguous bare mid-number — don't coerce
    // a literal full-rupee amount above the ₹1 L floor still parses
    expect(parseBudget4q('5000000')?.max).toBe(5_000_000);
  });
});
