import { describe, expect, it } from 'vitest';
import {
  decide as visitDecide,
  exitVisitPhase,
  shouldExitVisitForIntent,
  shouldResumeVisitDraft,
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

  it('V1: same-day / different-day stay only via teach bind (phrase hold removed)', () => {
    // Without teach bind, false compare stamp soft-exits — teach must win on dig.
    expect(
      shouldExitVisitForIntent(
        { constraints: {}, askTopic: 'compare', compareProjectIds: ['a', 'b'] },
        'same day for Krishnaja',
      ),
    ).toBe(true);
    expect(
      shouldExitVisitForIntent({ constraints: {}, wantsMore: true }, 'different day for Krishnaja'),
    ).toBe(true);
    expect(
      shouldExitVisitForIntent(
        { constraints: {}, askTopic: 'compare', compareProjectIds: ['a', 'b'] },
        'same day for Krishnaja',
        'visit_same_day',
      ),
    ).toBe(false);
    expect(
      shouldExitVisitForIntent(
        { constraints: {}, wantsMore: true },
        'different day for Krishnaja',
        'visit_other_day',
      ),
    ).toBe(false);
  });

  it('teach-bound visit kinds never soft-exit even without phrase cues', () => {
    expect(
      shouldExitVisitForIntent(
        { constraints: {}, askTopic: 'compare', compareProjectIds: ['a', 'b'] },
        'ok Krishnaja next',
        'visit_same_day',
      ),
    ).toBe(false);
    expect(
      shouldExitVisitForIntent({ constraints: {}, askTopic: 'compare' }, 'both', 'visit_choose_stops'),
    ).toBe(false);
  });

  it('split_day offer: natural same-day / both same day never soft-exits on false compare', () => {
    const visit = {
      lastAsk: 'split_day' as const,
      splitOffered: true,
      projectId: 'orchards',
      projectName: 'Brigade Orchards',
    };
    expect(
      shouldExitVisitForIntent(
        { constraints: {}, askTopic: 'compare', compareProjectIds: ['a', 'b'] },
        'I want to plan for both on the same day',
        undefined,
        visit,
      ),
    ).toBe(false);
    expect(
      shouldExitVisitForIntent(
        { constraints: {}, askTopic: 'compare' },
        'same day',
        undefined,
        visit,
      ),
    ).toBe(false);
    expect(
      shouldExitVisitForIntent(
        { constraints: {}, askTopic: 'compare' },
        'force all same day',
        undefined,
        visit,
      ),
    ).toBe(false);
  });

  it('closed chooser deixis while which_projects outstanding never soft-exits', () => {
    const visit = { lastAsk: 'which_projects' as const, projectId: 'a', projectName: 'A' };
    expect(
      shouldExitVisitForIntent(
        { constraints: {}, askTopic: 'compare', compareProjectIds: ['a', 'b'] },
        'both',
        undefined,
        visit,
      ),
    ).toBe(false);
    expect(
      shouldExitVisitForIntent(
        { constraints: {}, askTopic: 'compare', compareProjectIds: ['a', 'b'] },
        'dono',
        undefined,
        visit,
      ),
    ).toBe(false);
    expect(
      shouldExitVisitForIntent(
        { constraints: {}, askTopic: 'compare', compareProjectIds: ['a', 'b'] },
        'ye sab',
        undefined,
        visit,
      ),
    ).toBe(false);
    expect(
      shouldExitVisitForIntent(
        { constraints: {}, askTopic: 'compare', compareProjectIds: ['a', 'b'] },
        'sab',
        undefined,
        visit,
      ),
    ).toBe(false);
    expect(
      shouldExitVisitForIntent(
        { constraints: {}, askTopic: 'compare' },
        'compare both',
        undefined,
        visit,
      ),
    ).toBe(true);
  });

  it('soft-exits to discover but keeps the visit draft for resume', () => {
    const s = {
      ...initState('t', 'naya-advisor'),
      phase: 'visit' as const,
      visit: { projectId: 'p1', projectName: 'P1', lastAsk: 'day' as const },
    };
    const next = exitVisitPhase(s);
    expect(next.phase).toBe('discover');
    expect(next.visit?.projectId).toBe('p1');
    expect(next.visit?.lastAsk).toBe('day');
  });

  it('VIS-ADX-05: origin answer after soft-exit resumes the draft', () => {
    const visit = {
      projectId: 'ayana',
      projectName: 'Ayana',
      lastAsk: 'origin' as const,
      originAsked: true,
      queued: [{ projectId: 'krishnaja', projectName: 'Krishnaja Greens' }],
    };
    expect(
      shouldResumeVisitDraft(visit, "I'll come from Indiranagar", { constraints: {} }),
    ).toBe(true);
    expect(
      shouldResumeVisitDraft(visit, 'wait compare them once more first', {
        constraints: {},
        askTopic: 'compare',
        compareProjectIds: ['ayana', 'krishnaja'],
      }),
    ).toBe(false);
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

  it('does not defer SA-4 what-about follow-up (overview chip stays on visit day)', () => {
    let s = initState('naya-advisor', 't-visit-whatabout');
    s = commitTo(s, 'ayana', 'Ayana');
    s = {
      ...s,
      phase: 'visit',
      visit: {
        projectId: 'ayana',
        projectName: 'Ayana',
        lastAsk: 'day',
        askCount: 1,
        queued: [{ projectId: 'krishnaja', projectName: 'Krishnaja Greens' }],
      },
    };
    const goal = visitDecide(
      s,
      {
        constraints: {},
        askTopic: 'overview',
        askTopics: ['overview'],
        namedProjects: [{ projectId: 'krishnaja', name: 'Krishnaja Greens' }],
      },
      { text: 'what about Krishnaja Greens?', now: new Date('2026-07-30T10:00:00+05:30') },
    );
    expect(goal.kind).toBe('visit_ask');
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
