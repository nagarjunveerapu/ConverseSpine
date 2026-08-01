import { describe, expect, it } from 'vitest';
import { packSameDay } from '../src/engine/visit-feasibility.js';
import { VISIT_ON_SITE_MIN } from '../src/engine/visit-calendar.js';

describe('visit-feasibility', () => {
  it('marks third stop overflow when pack exceeds close', () => {
    const pack = packSameDay({
      dayIso: '2026-08-03',
      firstStartIso: '2026-08-03T10:30:00+05:30',
      onSiteMin: VISIT_ON_SITE_MIN,
      siteVisitHours: 'Mon–Sun, 9am–7pm',
      stops: [
        { projectId: 'a', projectName: 'A', driveInMin: 0 },
        { projectId: 'b', projectName: 'B', driveInMin: 45 },
        { projectId: 'c', projectName: 'C', driveInMin: 60 },
      ],
    });
    // 10:30 + 2h → 12:30; +45 → 13:15 + 2h → 15:15; +60 → 16:15 + 2h → 18:15 OK
    // push drives longer
    const tight = packSameDay({
      dayIso: '2026-08-03',
      firstStartIso: '2026-08-03T10:30:00+05:30',
      onSiteMin: VISIT_ON_SITE_MIN,
      siteVisitHours: 'Mon–Sun, 9am–7pm',
      stops: [
        { projectId: 'a', projectName: 'A', driveInMin: 0 },
        { projectId: 'b', projectName: 'B', driveInMin: 90 },
        { projectId: 'c', projectName: 'C', driveInMin: 90 },
      ],
    });
    expect(tight.preferSplit).toBe(true);
    expect(tight.overflow.length).toBeGreaterThan(0);
    expect(pack.stops).toHaveLength(3);
  });

  it('long drive prefers split', () => {
    const pack = packSameDay({
      dayIso: '2026-08-03',
      firstStartIso: '2026-08-03T10:30:00+05:30',
      stops: [
        { projectId: 'a', projectName: 'A', driveInMin: 0 },
        { projectId: 'b', projectName: 'B', driveInMin: 80 },
      ],
      siteVisitHours: 'Mon–Sun, 9am–7pm',
    });
    expect(pack.preferSplit).toBe(true);
    expect(pack.preferSplitReason).toBe('long_drive');
  });
});
