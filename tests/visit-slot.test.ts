import { describe, expect, it } from 'vitest';
import {
  extractVisitTime,
  formatVisitTimeLabel,
  isVisitDayUtterance,
  parseDayAnchor,
  parseVisitSlot,
  reparseVisitTime,
} from '../src/engine/visit-slot.js';

describe('visit-slot', () => {
  const mondayBase = new Date('2026-07-06T10:00:00+05:30'); // Monday

  it('parses monday 10AM', () => {
    const slot = parseVisitSlot('i want to visit this monday 10AM', mondayBase);
    expect(slot?.humanLabel).toMatch(/Monday at 10:00 AM/);
    expect(slot?.proposedIso).toContain('T10:00:00+05:30');
  });

  it('parses monday 10PM', () => {
    const slot = parseVisitSlot('monday 10PM', mondayBase);
    expect(slot?.humanLabel).toMatch(/Monday at 10:00 PM/);
    expect(slot?.proposedIso).toContain('T22:00:00+05:30');
  });

  it('returns null for day-only — no silent 11 AM default', () => {
    expect(parseVisitSlot('Saturday', mondayBase)).toBeNull();
    expect(parseDayAnchor('Saturday', mondayBase)?.dayLabel).toBe('Saturday');
  });

  it('VIS-ADX-07: Monday evening proposes ~5pm (not day-only window trap)', () => {
    const slot = parseVisitSlot('actually Monday evening instead', mondayBase);
    expect(slot?.humanLabel).toMatch(/Monday at 5:00 PM/);
    expect(slot?.proposedIso).toContain('T17:00:00+05:30');
  });

  it('isVisitDayUtterance treats weekdays as scheduling not location', () => {
    expect(isVisitDayUtterance('Tuesday')).toBe(true);
    expect(isVisitDayUtterance('Tuesday morning')).toBe(true);
    expect(isVisitDayUtterance('Tuesday pricing')).toBe(false);
  });

  it('extractVisitTime handles compact am/pm', () => {
    expect(extractVisitTime('10AM')).toEqual({ hour: 10, minute: 0 });
    expect(extractVisitTime('10 PM')).toEqual({ hour: 22, minute: 0 });
    expect(extractVisitTime('12 AM')).toEqual({ hour: 0, minute: 0 });
    expect(extractVisitTime('10.30 AM')).toEqual({ hour: 10, minute: 30 });
    expect(extractVisitTime('tomorrow 10.30am')).toEqual({ hour: 10, minute: 30 });
    expect(extractVisitTime('Saturday')).toBeNull();
    expect(formatVisitTimeLabel(10, 0)).toBe('10:00 AM');
  });

  // A hardcoded "future" date is only future until it isn't: this test was
  // pinned to 2026-08-15 and went red the morning that became yesterday,
  // taking every open PR with it. reparseVisitTime compares the slot against
  // Date.now() and takes no clock argument (unlike parseVisitSlot and
  // parseDayAnchor, which both accept `now`), so the date has to be derived
  // rather than injected. Computed in IST, because the day label the assertion
  // reads comes from toIstParts — a UTC-derived Saturday is a Friday in CI.
  function nextSaturdayIst(hour: number): string {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const nowIst = new Date(Date.now() + IST_OFFSET_MS);
    // 6 = Saturday. `|| 7` keeps it strictly future when today IS Saturday,
    // so midnight on the target day is never already past.
    const daysAhead = (6 - nowIst.getUTCDay() + 7) % 7 || 7;
    const target = new Date(nowIst.getTime() + daysAhead * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-` +
      `${pad(target.getUTCDate())}T${pad(hour)}:00:00+05:30`
    );
  }

  it('reparseVisitTime keeps day and changes time', () => {
    const retimed = reparseVisitTime(nextSaturdayIst(11), '12 AM');
    expect(retimed?.humanLabel).toMatch(/Saturday at 12:00 AM/);
    expect(retimed?.proposedIso).toContain('T00:00:00+05:30');
  });
});
