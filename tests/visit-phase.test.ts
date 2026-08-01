import { describe, expect, it } from 'vitest';
import { initState } from '../src/engine/state.js';
import { decide } from '../src/engine/phases/visit.js';

describe('visit phase', () => {
  const now = new Date('2026-07-06T10:00:00+05:30');

  it('does not loop on bare yes when asking for day', () => {
    const s = {
      ...initState('t', 'naya-advisor'),
      phase: 'visit' as const,
      focus: { projectId: 'earth-aroma', projectName: 'Earth Aroma' },
      visit: { projectId: 'earth-aroma', projectName: 'Earth Aroma', lastAsk: 'day' },
    };
    const goal = decide(
      s,
      { constraints: {}, transition: 'none', affirm: true },
      { text: 'yes', now },
    );
    expect(goal.kind).toBe('visit_ask');
    if (goal.kind === 'visit_ask') {
      expect(goal.copy.toLowerCase()).toContain('which');
      expect(goal.copy.toLowerCase()).toContain('day');
    }
  });

  it('binds morning window even when extract stamps a deferrable facet', () => {
    const s = {
      ...initState('t', 'naya-advisor'),
      phase: 'visit' as const,
      focus: { projectId: 'eldorado', projectName: 'Brigade Eldorado' },
      visit: {
        projectId: 'eldorado',
        projectName: 'Brigade Eldorado',
        pendingDayIso: '2026-08-01',
        pendingDayLabel: 'Saturday',
        lastAsk: 'window' as const,
      },
    };
    const goal = decide(
      s,
      { constraints: {}, transition: 'none', askTopic: 'availability', askTopics: ['availability'] },
      { text: 'Morning around 11am', now },
    );
    expect(goal.kind).not.toBe('answer');
    expect(['visit_propose', 'visit_booked', 'visit_ask']).toContain(goal.kind);
  });

  it('confirms visit when awaitingConfirm and buyer says yes', () => {
    const s = {
      ...initState('t', 'naya-advisor'),
      phase: 'visit' as const,
      focus: { projectId: 'earth-aroma', projectName: 'Earth Aroma' },
      visit: {
        projectId: 'earth-aroma',
        projectName: 'Earth Aroma',
        awaitingConfirm: true,
        proposedIso: '2026-07-12T11:00:00+05:30',
        proposedLabel: 'Saturday at 11:00 AM',
      },
    };
    const goal = decide(
      s,
      { constraints: {}, transition: 'none', affirm: true },
      { text: 'yes', now },
    );
    expect(goal.kind).toBe('visit_booked');
  });

  it('which-projects: come for the visit with 2 discussed asks chooser (no silent multi-seed)', () => {
    const s = {
      ...initState('t', 'lokations'),
      phase: 'visit' as const,
      focus: { projectId: 'krishnaja', projectName: 'Krishnaja Greens' },
      discover: {
        ...initState('t', 'lokations').discover,
        discussedProjects: [
          { projectId: 'ayana', name: 'Ayana' },
          { projectId: 'krishnaja', name: 'Krishnaja Greens' },
        ],
        lastOffered: [
          { projectId: 'ayana', name: 'Ayana' },
          { projectId: 'krishnaja', name: 'Krishnaja Greens' },
        ],
      },
      visit: undefined,
    };
    const goal = decide(
      s,
      { constraints: {}, transition: 'want_visit' },
      { text: 'come for the visit', now },
    );
    expect(goal.kind).toBe('visit_ask');
    if (goal.kind === 'visit_ask') {
      expect(goal.ask).toBe('which_projects');
      expect(goal.copy).toMatch(/which should we visit/i);
      expect(goal.state.candidateIds?.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('which-projects: "all" maps to full candidate set then asks origin', () => {
    const s = {
      ...initState('t', 'lokations'),
      phase: 'visit' as const,
      visit: {
        lastAsk: 'which_projects' as const,
        candidateIds: [
          { projectId: 'ayana', projectName: 'Ayana' },
          { projectId: 'krishnaja', projectName: 'Krishnaja Greens' },
        ],
      },
    };
    const goal = decide(
      s,
      { constraints: {}, transition: 'none' },
      { text: 'all of them', now },
    );
    expect(goal.kind).toBe('visit_ask');
    if (goal.kind === 'visit_ask') {
      expect(goal.ask).toBe('origin');
      expect(goal.state.projectId).toBeTruthy();
      expect((goal.state.queued?.length ?? 0) + 1).toBe(2);
    }
  });

  it('hours: explicit 6pm rejected when end past close', () => {
    const s = {
      ...initState('t', 'lokations'),
      phase: 'visit' as const,
      visit: {
        projectId: 'ayana',
        projectName: 'Ayana',
      },
    };
    const goal = decide(
      s,
      { constraints: {}, transition: 'none' },
      { text: 'Monday 6pm', now, siteVisitHours: 'Mon–Sun, 9am–7pm' },
    );
    expect(goal.kind).toBe('visit_ask');
    if (goal.kind === 'visit_ask') {
      expect(goal.ask).toBe('time');
      expect(goal.copy).toMatch(/past site hours|site hours/i);
    }
  });
});
