import { describe, expect, it } from 'vitest';
import {
  markAskedFromAdvisorConstraints,
  mergeAdvisorPreferences,
} from '../src/advisor/apply-preferences.js';
import { resolveAskNextStepGoal } from '../src/engine/ask-next-step.js';
import { firstMissingSlot } from '../src/engine/phases/discover.js';
import { initState } from '../src/engine/state.js';

describe('A3 — advisor prefs suppress re-ask', () => {
  it('markAskedFromAdvisorConstraints records filled hard slots', () => {
    let s = initState('a3', 'naya-advisor');
    s = {
      ...s,
      constraints: mergeAdvisorPreferences(s.constraints, {
        location: 'North Bangalore',
        budget: '₹80L–1 Cr',
        bhk: '2 BHK',
        purpose: 'self_use',
      }),
    };
    s = markAskedFromAdvisorConstraints(s);
    expect(s.discover.asked).toEqual(
      expect.arrayContaining(['location', 'budget', 'bhk', 'purpose']),
    );
    expect(s.discover.ignoredProbes).toBe(0);
    expect(firstMissingSlot(s)).toBeUndefined();
  });

  it('cold ask_next_step with filled location does not probe location', () => {
    let s = initState('a3', 'naya-advisor');
    s = {
      ...s,
      constraints: { location: 'North Bangalore' },
      discover: { ...s.discover, oriented: true },
    };
    s = markAskedFromAdvisorConstraints(s);
    const g = resolveAskNextStepGoal(s);
    expect(g).not.toEqual({ kind: 'probe', slot: 'location' });
    expect(g).toEqual({ kind: 'probe', slot: 'budget' });
  });

  it('cold ask_next_step with complete brief recommends', () => {
    let s = initState('a3', 'naya-advisor');
    s = {
      ...s,
      constraints: {
        location: 'North Bangalore',
        budgetMaxInr: 10_000_000,
        bhk: '2 BHK',
        purpose: 'self_use',
      },
      discover: { ...s.discover, oriented: true },
    };
    s = markAskedFromAdvisorConstraints(s);
    expect(firstMissingSlot(s)).toBeUndefined();
    expect(resolveAskNextStepGoal(s)).toEqual({ kind: 'recommend' });
  });

  it('idempotent when slots already asked', () => {
    let s = initState('a3', 'naya-advisor');
    s = {
      ...s,
      constraints: { location: 'Whitefield', budgetMaxInr: 5_000_000 },
      discover: { ...s.discover, asked: ['location', 'budget'] },
    };
    const next = markAskedFromAdvisorConstraints(s);
    expect(next).toBe(s);
  });
});
