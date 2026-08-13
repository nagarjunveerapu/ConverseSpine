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

  it('bare 2BHK mid-visit defers to availability answer (not re-ask day)', () => {
    const s = {
      ...initState('t', 'brigade-group'),
      phase: 'visit' as const,
      focus: { projectId: 'eldorado', projectName: 'Brigade Eldorado' },
      visit: { projectId: 'eldorado', projectName: 'Brigade Eldorado', lastAsk: 'day' as const },
    };
    const goal = decide(
      s,
      { constraints: { bhk: '2 BHK' }, transition: 'none' },
      { text: '2BHK', now },
    );
    expect(goal.kind).toBe('answer');
    if (goal.kind === 'answer') {
      expect(goal.topic).toBe('availability');
      expect(goal.projectId).toBe('eldorado');
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

  it('want_visit with focus uses the open project, not the discussed set', () => {
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
      expect(goal.ask).not.toBe('which_projects');
      expect(goal.state.projectId).toBe('krishnaja');
    }
  });

  it('which-projects: come for the visit with 2 discussed and no focus asks chooser', () => {
    const s = {
      ...initState('t', 'lokations'),
      phase: 'visit' as const,
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

  it('which-projects: "both" maps to full candidate set then asks origin', () => {
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
      {
        constraints: {},
        transition: 'none',
        // Live dig: "both" can stamp compare — visit chooser must still win.
        askTopic: 'compare',
        compareProjectIds: ['ayana', 'krishnaja'],
      },
      { text: 'both', now },
    );
    expect(goal.kind).toBe('visit_ask');
    if (goal.kind === 'visit_ask') {
      expect(goal.ask).toBe('origin');
      expect((goal.state.queued?.length ?? 0) + 1).toBe(2);
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

  it('VIS-ADX-04: bare yes after digression re-proposes, does not book', () => {
    const s = {
      ...initState('t', 'lokations'),
      phase: 'visit' as const,
      visit: {
        projectId: 'ayana',
        projectName: 'Ayana',
        awaitingConfirm: false,
        proposedIso: '2026-07-11T10:30:00+05:30',
        proposedLabel: 'Saturday at 10:30 AM',
      },
    };
    const goal = decide(
      s,
      { constraints: {}, transition: 'none', affirm: true },
      { text: 'yes', now },
    );
    expect(goal.kind).toBe('visit_propose');
    if (goal.kind === 'visit_propose') {
      expect(goal.copy).toMatch(/just to confirm/i);
      expect(goal.state.awaitingConfirm).toBe(true);
    }
  });

  it('VIS-LONG-03: gibberish while confirm open kills one-shot (does not re-propose)', () => {
    const s = {
      ...initState('t', 'lokations'),
      phase: 'visit' as const,
      visit: {
        projectId: 'ayana',
        projectName: 'Ayana',
        awaitingConfirm: true,
        proposedIso: '2026-07-13T10:00:00+05:30',
        proposedLabel: 'Monday at 10:00 AM',
        slotText: 'I want Ayana visit Monday 10am',
        lastAsk: 'time' as const,
      },
    };
    const goal = decide(
      s,
      { constraints: {}, transition: 'none' },
      { text: 'kjsdhfkjsdhf', now },
    );
    expect(goal.kind).not.toBe('visit_propose');
    expect(goal.kind).not.toBe('visit_booked');
    if (goal.kind === 'visit_ask') {
      expect(goal.state.awaitingConfirm).toBe(false);
      expect(goal.state.proposedIso).toBe('2026-07-13T10:00:00+05:30');
    }
  });

  it('MV-06: ask the team after hours reject files pending, not firm book', () => {
    const s = {
      ...initState('t', 'lokations'),
      phase: 'visit' as const,
      visit: {
        projectId: 'ayana',
        projectName: 'Ayana',
        lastAsk: 'time' as const,
        pendingDayIso: '2026-08-04',
        pendingDayLabel: 'Monday',
      },
    };
    const goal = decide(
      s,
      { constraints: {}, transition: 'none' },
      {
        text: 'ask the team for 6pm',
        now,
        siteVisitHours: 'Mon–Sun, 9am–7pm',
        embedderIntentKind: 'visit_ask_team',
      },
    );
    expect(goal.kind).toBe('visit_ask');
    if (goal.kind === 'visit_ask') {
      expect(goal.ask).toBe('team_request');
      expect(goal.copy).toMatch(/not a firm booking|pending|team/i);
      expect(goal.state.pendingTeamRequests?.length).toBeGreaterThan(0);
      expect(goal.state.awaitingConfirm).toBeFalsy();
    }
  });

  it('MV-08: gibberish on origin re-asks origin, does not stamp', () => {
    const s = {
      ...initState('t', 'lokations'),
      phase: 'visit' as const,
      visit: {
        projectId: 'ayana',
        projectName: 'Ayana',
        queued: [{ projectId: 'krishnaja', projectName: 'Krishnaja Greens' }],
        lastAsk: 'origin' as const,
        originAsked: true,
      },
    };
    const goal = decide(
      s,
      { constraints: {}, transition: 'none' },
      { text: 'asdfghjkl qwerty', now },
    );
    expect(goal.kind).toBe('visit_ask');
    if (goal.kind === 'visit_ask') {
      expect(goal.ask).toBe('origin');
      expect(goal.state.originText).toBeUndefined();
      expect(goal.copy).toMatch(/couldn't make sense/i);
      expect(goal.copy).toMatch(/coming from|starting area/i);
    }
  });

  it('ablation: embedActsOnly ignores ask-team regex without teach bind', () => {
    const s = {
      ...initState('t', 'lokations'),
      phase: 'visit' as const,
      visit: {
        projectId: 'ayana',
        projectName: 'Ayana',
        lastAsk: 'time' as const,
        pendingDayIso: '2026-08-04',
        pendingDayLabel: 'Monday',
      },
    };
    const goal = decide(
      s,
      { constraints: {}, transition: 'none' },
      {
        text: 'ask the team for 6pm',
        now,
        siteVisitHours: 'Mon–Sun, 9am–7pm',
        embedActsOnly: true,
      },
    );
    // Without teach bind, must not file team_request (regex path off).
    if (goal.kind === 'visit_ask') {
      expect(goal.ask).not.toBe('team_request');
      expect(goal.state.pendingTeamRequests ?? []).toHaveLength(0);
    } else {
      expect(goal.kind).not.toBe('visit_booked');
    }
  });

  it('MV-04b: natural "both on the same day" after split offer forces same day (not digression)', () => {
    const s = {
      ...initState('t', 'brigade-group'),
      phase: 'visit' as const,
      visit: {
        projectId: 'orchards',
        projectName: 'Brigade Orchards',
        queued: [{ projectId: 'cornerstone-utopia', projectName: 'Brigade Cornerstone Utopia' }],
        lastAsk: 'split_day' as const,
        splitOffered: true,
        originText: 'Anantapur',
        originAsked: true,
        tripOrdered: true,
      },
    };
    const goal = decide(
      s,
      { constraints: {}, transition: 'none' },
      {
        text: 'I want to plan for both on the same day',
        now,
        siteVisitHours: 'Mon–Sun, 9am–7pm',
        driveFromPriorMin: 180,
      },
    );
    expect(['visit_propose', 'visit_ask', 'visit_booked']).toContain(goal.kind);
    expect(goal.kind).not.toBe('answer');
    if (goal.kind === 'visit_propose' || goal.kind === 'visit_ask' || goal.kind === 'visit_booked') {
      expect(goal.state.preferredDayHint === 'same_forced' || goal.state.splitOffered === false).toBe(true);
    }
  });

  it('MV-04: force same day Monday proposes with team overflow, skips window dead-end', () => {
    const s = {
      ...initState('t', 'brigade-group'),
      phase: 'visit' as const,
      visit: {
        projectId: 'cornerstone-utopia',
        projectName: 'Brigade Cornerstone Utopia',
        queued: [
          { projectId: 'eldorado', projectName: 'Brigade Eldorado' },
          { projectId: 'orchards', projectName: 'Brigade Orchards' },
        ],
        lastAsk: 'split_day' as const,
        splitOffered: true,
        originText: 'Whitefield',
        originAsked: true,
        tripOrdered: true,
      },
    };
    const goal = decide(
      s,
      { constraints: {}, transition: 'none' },
      {
        text: 'force all same day Monday',
        now,
        siteVisitHours: 'Mon–Sun, 9am–7pm',
        embedderIntentKind: 'visit_force_same_day',
        driveFromPriorMin: 90,
      },
    );
    expect(['visit_propose', 'visit_ask']).toContain(goal.kind);
    if (goal.kind === 'visit_propose') {
      expect(goal.copy).toMatch(/team|request/i);
      expect(goal.state.awaitingTeamRequestConfirm || (goal.state.pendingTeamRequests?.length ?? 0) > 0).toBe(
        true,
      );
    } else if (goal.kind === 'visit_ask') {
      expect(goal.ask).not.toBe('window');
      expect(goal.copy).toMatch(/team|force|same day|Monday/i);
    }
  });

  it('VIS-ADX-08: actually visit other project with packed slot replaces, no origin for 2 stops', () => {
    const s = {
      ...initState('t', 'lokations'),
      phase: 'visit' as const,
      visit: {
        projectId: 'ayana',
        projectName: 'Ayana',
        awaitingConfirm: true,
        proposedIso: '2026-07-11T10:30:00+05:30',
        proposedLabel: 'Saturday at 10:30 AM',
        slotText: 'Saturday morning',
      },
    };
    const goal = decide(
      s,
      {
        constraints: {},
        transition: 'want_visit',
        namedProjects: [{ projectId: 'krishnaja', name: 'Krishnaja Greens' }],
      },
      { text: "actually let's visit Krishnaja on Monday at 11am", now },
    );
    expect(goal.kind).toBe('visit_propose');
    if (goal.kind === 'visit_propose') {
      expect(goal.projectName).toMatch(/krishnaja/i);
      expect(goal.label).toMatch(/Monday.*11/i);
      expect(goal.state.queued?.length ?? 0).toBe(0);
    }
  });
});
