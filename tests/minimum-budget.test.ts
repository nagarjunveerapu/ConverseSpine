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
