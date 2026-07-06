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
