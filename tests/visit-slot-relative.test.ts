import { describe, expect, it } from 'vitest';
import { isSameDayPhrase, resolveSameDayDate, addMinutesToIso } from '../src/engine/visit-itinerary.js';
import {
  parseDayAnchor,
  parseVisitSlot,
  isMorningWindow,
  isAfternoonWindow,
} from '../src/engine/visit-slot.js';

describe('visit-slot relative', () => {
  const now = new Date('2026-07-06T10:00:00+05:30');

  it('does not invent 11 AM for day-only Monday', () => {
    expect(parseVisitSlot('Monday', now)).toBeNull();
    expect(parseDayAnchor('Monday', now)?.dayLabel).toBe('Monday');
  });

  it('parses Monday morning', () => {
    const slot = parseVisitSlot('Monday morning', now);
    expect(slot?.humanLabel).toMatch(/Monday at 10:30 AM/);
  });

  it('parses Monday afternoon', () => {
    const slot = parseVisitSlot('Monday afternoon', now);
    expect(slot?.humanLabel).toMatch(/Monday at 2:00 PM/);
  });

  it('explicit time wins over day-only', () => {
    const slot = parseVisitSlot('Monday 3 PM', now);
    expect(slot?.humanLabel).toMatch(/3:00 PM/);
  });

  it('same day anchors to prior visit date', () => {
    expect(isSameDayPhrase('Same Day')).toBe(true);
    expect(resolveSameDayDate('same day', '2026-07-13T11:00:00+05:30')).toBe('2026-07-13');
    const slot = parseVisitSlot('same day morning', now, { anchorDateIso: '2026-07-13' });
    expect(slot?.proposedIso).toMatch(/^2026-07-13T10:30/);
  });

  it('detects morning/afternoon windows', () => {
    expect(isMorningWindow('morning works')).toBe(true);
    expect(isAfternoonWindow('afternoon please')).toBe(true);
  });
});

describe('visit-itinerary stagger math', () => {
  it('adds minutes to ISO in IST', () => {
    const next = addMinutesToIso('2026-07-13T10:30:00+05:30', 115);
    expect(next).toBe('2026-07-13T12:25:00+05:30');
  });
});
