import { describe, expect, it } from 'vitest';
import {
  firstFreeWindow,
  loadCalendarFromVisits,
  staggerAfter,
  wouldCollide,
  VISIT_ON_SITE_MIN,
} from '../src/engine/visit-calendar.js';

describe('visit-calendar', () => {
  it('detects overlap between two blocks', () => {
    const cal = loadCalendarFromVisits('t', [
      {
        projectId: 'a',
        projectName: 'A',
        iso: '2026-07-13T10:30:00+05:30',
        label: 'Mon 10:30',
        confirmed: true,
      },
    ]);
    expect(wouldCollide('2026-07-13T11:00:00+05:30', VISIT_ON_SITE_MIN, cal.blocks)).toBe(true);
    expect(wouldCollide('2026-07-13T14:00:00+05:30', VISIT_ON_SITE_MIN, cal.blocks)).toBe(false);
  });

  it('picks first free morning window', () => {
    const free = firstFreeWindow([], '2026-07-13', 'morning', VISIT_ON_SITE_MIN);
    expect(free).toBe('2026-07-13T10:30:00+05:30');
  });

  it('staggers after prior visit with drive', () => {
    const next = staggerAfter('2026-07-13T10:30:00+05:30', 25, 90);
    expect(next).toBe('2026-07-13T12:25:00+05:30');
  });
});
