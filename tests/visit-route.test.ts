import { describe, expect, it } from 'vitest';
import { initState } from '../src/engine/state.js';
import { decide } from '../src/engine/phases/visit.js';
import type { StoredVisit } from '../src/engine/ports.js';

describe('visit route scheduling', () => {
  const now = new Date('2026-07-06T10:00:00+05:30');

  const cornerstoneBooked: StoredVisit = {
    projectId: 'cornerstone',
    projectName: 'Brigade Cornerstone',
    iso: '2026-07-13T11:00:00+05:30',
    label: 'Monday at 11:00 AM',
    confirmed: true,
  };

  it('asks morning or afternoon for stop 1 day-only', () => {
    const s = {
      ...initState('t', 'naya-advisor'),
      phase: 'visit' as const,
      visit: { projectId: 'eldorado', projectName: 'Brigade Eldorado' },
    };
    const goal = decide(s, { constraints: {}, transition: 'none' }, { text: 'Monday', now, bookedVisits: [] });
    expect(goal.kind).toBe('visit_ask');
    if (goal.kind === 'visit_ask') {
      expect(goal.ask).toBe('window');
      expect(goal.copy.toLowerCase()).toContain('morning or afternoon');
    }
  });

  it('auto-staggers stop 2 on same day when drive minutes known', () => {
    const s = {
      ...initState('t', 'naya-advisor'),
      phase: 'visit' as const,
      visit: { projectId: 'eldorado', projectName: 'Brigade Eldorado' },
    };
    const goal = decide(
      s,
      { constraints: {}, transition: 'none' },
      {
        text: 'Same day',
        now,
        bookedVisits: [cornerstoneBooked],
        driveFromPriorMin: 25,
        driveSource: 'distance_matrix',
      },
    );
    expect(goal.kind).toBe('visit_propose');
    if (goal.kind === 'visit_propose') {
      expect(goal.iso).toBe('2026-07-13T12:55:00+05:30');
      expect(goal.copy).toContain('25 min drive');
    }
  });

  it('proposes stop 2 with stagger explain when buyer picks same day', () => {
    const s = {
      ...initState('t', 'naya-advisor'),
      phase: 'visit' as const,
      visit: {
        projectId: 'eldorado',
        projectName: 'Brigade Eldorado',
        lastAsk: 'same_day_choice' as const,
      },
    };
    const goal = decide(
      s,
      { constraints: {}, transition: 'none' },
      {
        text: 'same day',
        now,
        bookedVisits: [
          {
            ...cornerstoneBooked,
            iso: '2026-07-13T10:00:00+05:30',
            label: 'Monday at 10:00 AM',
          },
        ],
        driveFromPriorMin: 25,
        driveSource: 'distance_matrix',
      },
    );
    expect(goal.kind).toBe('visit_propose');
    if (goal.kind === 'visit_propose') {
      expect(goal.copy).toContain('on site');
      expect(goal.copy).toContain('25 min drive');
      expect(goal.copy).toMatch(/works, or tell me another time/i);
      expect(goal.state.lastAsk).toBe('stagger_propose');
    }
  });

  it('different day after same_day_choice asks for a new day', () => {
    const s = {
      ...initState('t', 'naya-advisor'),
      phase: 'visit' as const,
      visit: {
        projectId: 'eldorado',
        projectName: 'Brigade Eldorado',
        lastAsk: 'same_day_choice' as const,
      },
    };
    const goal = decide(
      s,
      { constraints: {}, transition: 'none' },
      {
        text: 'different day',
        now,
        bookedVisits: [cornerstoneBooked],
      },
    );
    expect(goal.kind).toBe('visit_ask');
    if (goal.kind === 'visit_ask') {
      expect(goal.ask).toBe('day');
    }
  });

  it('proposes stop 2 time when buyer says 2 PM after same-day time ask', () => {
    const s = {
      ...initState('t', 'naya-advisor'),
      phase: 'visit' as const,
      visit: {
        projectId: 'eldorado',
        projectName: 'Brigade Eldorado',
        lastAsk: 'time' as const,
      },
    };
    const goal = decide(
      s,
      { constraints: {}, transition: 'none' },
      {
        text: '2 PM',
        now,
        bookedVisits: [
          {
            ...cornerstoneBooked,
            iso: '2026-07-13T10:30:00+05:30',
            label: 'Monday at 10:30 AM',
          },
        ],
      },
    );
    expect(goal.kind).toBe('visit_propose');
    if (goal.kind === 'visit_propose') {
      expect(goal.iso).toBe('2026-07-13T14:00:00+05:30');
      expect(goal.copy).toContain('Shall I block');
      expect(goal.copy).toContain('Brigade Eldorado');
    }
  });

  it('asks origin when 2+ stops queued', () => {
    const s = {
      ...initState('t', 'naya-advisor'),
      phase: 'visit' as const,
      visit: {
        projectId: 'cornerstone',
        projectName: 'Brigade Cornerstone',
        queued: [{ projectId: 'eldorado', projectName: 'Brigade Eldorado' }],
      },
    };
    const goal = decide(s, { constraints: {}, transition: 'none' }, { text: 'Saturday', now, bookedVisits: [] });
    expect(goal.kind).toBe('visit_ask');
    if (goal.kind === 'visit_ask') expect(goal.ask).toBe('origin');
  });
});
