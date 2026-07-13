import { describe, it, expect } from 'vitest';
import { advisorSearchPrefs, importanceFromConstraints } from '../src/engine/advisor-weights.js';
import { detectSoftPrefs } from '../src/engine/facts.js';

// Trade-off Advisor capture chain: chip/free-text → soft signals → weights.
// These pin the deterministic mappings so ranking and BPE memory stay in
// lockstep (the same numbers are searched with and persisted).

describe('detectSoftPrefs — advisor soft signals', () => {
  it('parses the three priority chip answers', () => {
    expect(detectSoftPrefs('Shorter commute').priorityFocus).toBe('commute');
    expect(detectSoftPrefs('staying on budget please').priorityFocus).toBe('budget');
    expect(detectSoftPrefs('about equal, honestly').priorityFocus).toBe('balanced');
  });

  it('captures the commute hub from free text', () => {
    expect(detectSoftPrefs('we both work at ITPL').commuteHub).toBe('ITPL');
    expect(detectSoftPrefs('My office is in Whitefield, near the lake').commuteHub).toBe('Whitefield');
    expect(detectSoftPrefs('commuting to Electronic City daily').commuteHub).toBe('Electronic City');
  });

  it('flags school mentions without inventing importance', () => {
    expect(detectSoftPrefs('need good schools nearby').schoolsMentioned).toBe(true);
    expect(detectSoftPrefs('2 BHK in Whitefield').schoolsMentioned).toBeUndefined();
  });

  it('plain search briefs carry no priority', () => {
    const out = detectSoftPrefs('self-use home, budget ₹50-70L, 2 BHK, in Whitefield');
    expect(out.priorityFocus).toBeUndefined();
  });
});

describe('importanceFromConstraints — chip answer → weights', () => {
  it('commute-first buyer', () => {
    expect(importanceFromConstraints({ priorityFocus: 'commute' }))
      .toEqual({ commute: 0.9, budget: 0.6, schools: 0.5 });
  });
  it('budget-first buyer, schools mentioned', () => {
    expect(importanceFromConstraints({ priorityFocus: 'budget', schoolsMentioned: true }))
      .toEqual({ commute: 0.5, budget: 0.9, schools: 0.7 });
  });
  it('no priority: only given signals register', () => {
    expect(importanceFromConstraints({})).toEqual({});
    expect(importanceFromConstraints({ commuteHub: 'ITPL' })).toEqual({ commute: 0.7 });
  });
});

describe('worries — the understanding half of the brief', () => {
  it('a named fear bumps its dimension above the defaults', () => {
    expect(importanceFromConstraints({ worries: ['overpaying'] }).budget).toBe(0.9);
    expect(importanceFromConstraints({ worries: ['daily traffic'] }).commute).toBe(0.8);
    expect(importanceFromConstraints({ worries: ['schools too far'] }).schools).toBe(0.8);
  });

  it('worries compose with a stated priority (max, not overwrite)', () => {
    const w = importanceFromConstraints({ priorityFocus: 'commute', worries: ['overpaying'] });
    expect(w).toEqual({ commute: 0.9, budget: 0.9, schools: 0.5 });
  });

  it('derives priority when worries settle it — the bot then skips the ask', async () => {
    const { derivedPriorityFromWorries } = await import('../src/engine/advisor-weights.js');
    expect(derivedPriorityFromWorries({ worries: ['daily traffic'] })).toBe('commute');
    expect(derivedPriorityFromWorries({ worries: ['overpaying', 'hidden costs'] })).toBe('budget');
    expect(derivedPriorityFromWorries({ worries: ['overpaying', 'daily traffic'] })).toBeUndefined();
    expect(derivedPriorityFromWorries({ worries: ['trusting the builder'] })).toBeUndefined();
  });
});

describe('advisorSearchPrefs — search payload', () => {
  it('empty constraints → empty payload (advisor stays off)', () => {
    expect(advisorSearchPrefs({})).toEqual({});
  });
  it('full soft-signal set → weights + hub + soft target from stated cap', () => {
    expect(advisorSearchPrefs({
      priorityFocus: 'commute', commuteHub: 'ITPL', budgetMaxInr: 9000000, schoolsMentioned: true,
    })).toEqual({
      preferenceWeights: { commute: 0.9, budget: 0.6, schools: 0.7 },
      commuteHub: 'ITPL',
      budgetTargetInr: 9000000,
    });
  });
});
