import { describe, expect, it } from 'vitest';
import { extractVisitTime, formatVisitTimeLabel, parseVisitSlot, reparseVisitTime } from '../src/engine/visit-slot.js';

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

  it('defaults to 11 AM when only day given', () => {
    const slot = parseVisitSlot('Saturday', mondayBase);
    expect(slot?.humanLabel).toMatch(/Saturday at 11:00 AM/);
  });

  it('extractVisitTime handles compact am/pm', () => {
    expect(extractVisitTime('10AM')).toEqual({ hour: 10, minute: 0 });
    expect(extractVisitTime('10 PM')).toEqual({ hour: 22, minute: 0 });
    expect(extractVisitTime('12 AM')).toEqual({ hour: 0, minute: 0 });
    expect(formatVisitTimeLabel(10, 0)).toBe('10:00 AM');
  });

  it('reparseVisitTime keeps day and changes time', () => {
    const mondayBase = new Date('2026-07-06T10:00:00+05:30');
    const slot = parseVisitSlot('Saturday', mondayBase);
    expect(slot?.proposedIso).toBeTruthy();
    const retimed = reparseVisitTime(slot!.proposedIso, '12 AM');
    expect(retimed?.humanLabel).toMatch(/Saturday at 12:00 AM/);
    expect(retimed?.proposedIso).toContain('T00:00:00+05:30');
  });
});
