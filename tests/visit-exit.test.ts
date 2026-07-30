import { describe, expect, it } from 'vitest';
import {
  decide as visitDecide,
  exitVisitPhase,
  shouldExitVisitForIntent,
} from '../src/engine/phases/visit.js';
import { commitTo, initState } from '../src/engine/state.js';

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
    expect(shouldExitVisitForIntent({ constraints: {}, pickName: 'Beta' }, 'what about Beta?')).toBe(
      false,
    );
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

  it('defers overview/FAQ asks mid-visit instead of visit_ask', () => {
    let s = initState('naya-advisor', 't-visit-faq');
    s = commitTo(s, 'brigade-eldorado-naya-advisor', 'Brigade Eldorado');
    s = {
      ...s,
      phase: 'visit',
      visit: {
        projectId: 'brigade-eldorado-naya-advisor',
        projectName: 'Brigade Eldorado',
        lastAsk: 'day',
        askCount: 1,
      },
    };
    const ctx = { text: 'बिल्डर कौन है??', now: new Date('2026-07-30T10:00:00+05:30') };
    const goal = visitDecide(
      s,
      { constraints: {}, askTopic: 'overview', askTopics: ['overview'] },
      ctx,
    );
    expect(goal.kind).toBe('answer');
    if (goal.kind !== 'answer') return;
    expect(goal.topic).toBe('overview');
  });

  it('defers using visit.projectId when focus was cleared', () => {
    let s = initState('naya-advisor', 't-visit-nofocus');
    s = {
      ...s,
      phase: 'visit',
      focus: undefined,
      visit: {
        projectId: 'brigade-eldorado-naya-advisor',
        projectName: 'Brigade Eldorado',
        lastAsk: 'day',
        askCount: 1,
      },
    };
    const goal = visitDecide(
      s,
      { constraints: {}, askTopic: 'overview', askTopics: ['overview'] },
      { text: 'एक बात: एप्रिसिएशन? बताओ', now: new Date('2026-07-30T10:00:00+05:30') },
    );
    expect(goal.kind).toBe('answer');
    if (goal.kind !== 'answer') return;
    expect(goal.topic).toBe('overview');
    expect(goal.projectId).toBe('brigade-eldorado-naya-advisor');
  });
});
