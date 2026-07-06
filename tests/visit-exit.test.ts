import { describe, expect, it } from 'vitest';
import { exitVisitPhase, shouldExitVisitForIntent } from '../src/engine/phases/visit.js';
import { initState } from '../src/engine/state.js';

describe('visit exit', () => {
  it('exits visit intent for compare', () => {
    expect(shouldExitVisitForIntent({ constraints: {}, askTopic: 'compare' })).toBe(true);
    expect(
      shouldExitVisitForIntent({
        constraints: {},
        compareProjectIds: ['a', 'b', 'c'],
      }),
    ).toBe(true);
  });

  it('stays in visit for bare day answers', () => {
    expect(shouldExitVisitForIntent({ constraints: {}, askTopic: undefined })).toBe(false);
  });

  it('clears visit state and returns to discover', () => {
    const s = {
      ...initState('t', 'naya-advisor'),
      phase: 'visit' as const,
      visit: { projectId: 'p1', projectName: 'P1', lastAsk: 'day' as const },
    };
    const next = exitVisitPhase(s);
    expect(next.phase).toBe('discover');
    expect(next.visit).toBeUndefined();
  });
});
