import { describe, expect, it } from 'vitest';
import {
  checkSlotAgainstHours,
  nearestInWindowStartIso,
  parseSiteVisitHours,
  DEFAULT_SITE_VISIT_HOURS,
} from '../src/engine/visit-hours.js';
import { VISIT_ON_SITE_MIN } from '../src/engine/visit-calendar.js';

describe('visit-hours', () => {
  it('defaults when missing', () => {
    expect(parseSiteVisitHours(null).label).toBe(DEFAULT_SITE_VISIT_HOURS);
    expect(parseSiteVisitHours('').openMin).toBe(9 * 60);
    expect(parseSiteVisitHours('').closeMin).toBe(19 * 60);
  });

  it('parses Mon–Sun, 9am–7pm', () => {
    const h = parseSiteVisitHours('Mon–Sun, 9am–7pm');
    expect(h.openMin).toBe(9 * 60);
    expect(h.closeMin).toBe(19 * 60);
  });

  it('6pm start with 2h on-site ends after 7pm close', () => {
    const c = checkSlotAgainstHours('2026-08-03T18:00:00+05:30', VISIT_ON_SITE_MIN, 'Mon–Sun, 9am–7pm');
    expect(c.ok).toBe(false);
    expect(c.reason).toBe('ends_after_close');
  });

  it('10:30am start fits', () => {
    const c = checkSlotAgainstHours('2026-08-03T10:30:00+05:30', VISIT_ON_SITE_MIN, 'Mon–Sun, 9am–7pm');
    expect(c.ok).toBe(true);
  });

  it('nearest snaps late start earlier', () => {
    const iso = nearestInWindowStartIso('2026-08-03', 18 * 60, VISIT_ON_SITE_MIN, 'Mon–Sun, 9am–7pm');
    expect(iso).toBe('2026-08-03T17:00:00+05:30');
  });
});
