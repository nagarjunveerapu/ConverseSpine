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

  it('SA-2: come for the visit with 2 discussedProjects seeds multi-stop (no which-project ask)', () => {
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
    expect(goal.kind).not.toBe('visit_recall');
    // Should not ask which project — discussed set seeds first + queued.
    if (goal.kind === 'visit_ask') {
      expect(goal.ask).not.toBe('project');
      expect(goal.state.projectId).toBeTruthy();
      expect((goal.state.queued?.length ?? 0) + (goal.state.projectId ? 1 : 0)).toBeGreaterThanOrEqual(2);
    } else {
      expect(['visit_ask', 'visit_propose', 'visit_booked']).toContain(goal.kind);
    }
  });
});
