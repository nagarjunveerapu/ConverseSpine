/** IST visit slot parsing — buyer-stated day/time only. */

const DAY_NAMES: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_HOUR = 11;
const DEFAULT_MINUTE = 0;

export interface ParsedVisitSlot {
  proposedIso: string;
  humanLabel: string;
}

export function extractDayWord(text: string): string | null {
  const m = text.toLowerCase().match(
    /\b(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  );
  return m?.[1] ?? null;
}

/** Parse explicit time from buyer text; default 11:00 AM when only a day is given. */
export function extractVisitTime(text: string): { hour: number; minute: number } {
  const compact = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (compact) {
    let hour = parseInt(compact[1]!, 10);
    const minute = compact[2] ? parseInt(compact[2], 10) : 0;
    const ampm = compact[3]!.toLowerCase();
    if (hour >= 1 && hour <= 12) {
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
    }
    return { hour, minute };
  }

  const twentyFour = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (twentyFour) {
    return { hour: parseInt(twentyFour[1]!, 10), minute: parseInt(twentyFour[2]!, 10) };
  }

  return { hour: DEFAULT_HOUR, minute: DEFAULT_MINUTE };
}

export function formatVisitTimeLabel(hour: number, minute: number): string {
  const h12 = hour % 12 || 12;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const mins = minute > 0 ? `:${String(minute).padStart(2, '0')}` : ':00';
  return `${h12}${mins} ${ampm}`;
}

export function hasExplicitTime(text: string): boolean {
  return (
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.test(text) ||
    /\b([01]?\d|2[0-3]):([0-5]\d)\b/.test(text)
  );
}

/** Re-time a previously chosen day — e.g. buyer says "12 AM" after Saturday was proposed. */
export function reparseVisitTime(priorIso: string, timeText: string): ParsedVisitSlot | null {
  const anchor = new Date(priorIso);
  if (Number.isNaN(anchor.getTime())) return null;
  const { hour, minute } = extractVisitTime(timeText);
  const parts = toIstParts(anchor);
  const target = istInstant(parts.year, parts.month, parts.day, hour, minute);
  if (target.getTime() <= Date.now()) return null;
  const dayLabel = DAY_FULL[parts.dow] ?? 'Visit';
  return {
    proposedIso: toIstIso(parts.year, parts.month, parts.day, hour, minute),
    humanLabel: `${dayLabel} at ${formatVisitTimeLabel(hour, minute)}`,
  };
}

export function parseVisitSlot(raw: string, now: Date): ParsedVisitSlot | null {
  const text = raw.toLowerCase().trim();
  if (!text) return null;

  const { hour, minute } = extractVisitTime(raw);
  const timeLabel = formatVisitTimeLabel(hour, minute);

  const ist = toIstParts(now);
  let target: Date | null = null;
  let dayLabel = '';

  if (/\btomorrow\b/.test(text)) {
    target = istInstantFromParts(addDaysParts(ist, 1), hour, minute);
    dayLabel = 'Tomorrow';
  } else if (/\btoday\b/.test(text)) {
    target = istInstant(ist.year, ist.month, ist.day, hour, minute);
    dayLabel = 'Today';
  } else {
    for (const [word, dow] of Object.entries(DAY_NAMES)) {
      if (new RegExp(`\\b${word}\\b`).test(text)) {
        const next = addDaysParts(ist, nextDowDelta(ist.dow, dow));
        target = istInstantFromParts(next, hour, minute);
        dayLabel = DAY_FULL[dow]!;
        break;
      }
    }
  }

  if (!target || target.getTime() <= now.getTime()) return null;

  const parts = toIstParts(target);
  const iso = toIstIso(parts.year, parts.month, parts.day, hour, minute);
  return {
    proposedIso: iso,
    humanLabel: `${dayLabel} at ${timeLabel}`,
  };
}

interface IstParts {
  year: number;
  month: number;
  day: number;
  dow: number;
}

function toIstParts(d: Date): IstParts {
  const u = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    year: u.getUTCFullYear(),
    month: u.getUTCMonth(),
    day: u.getUTCDate(),
    dow: u.getUTCDay(),
  };
}

function istInstant(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month, day, hour, minute, 0, 0) - IST_OFFSET_MS);
}

function istInstantFromParts(parts: IstParts, hour: number, minute: number): Date {
  return istInstant(parts.year, parts.month, parts.day, hour, minute);
}

function toIstIso(year: number, month: number, day: number, hour: number, minute: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+05:30`;
}

function addDaysParts(ist: IstParts, days: number): IstParts {
  const d = istInstant(ist.year, ist.month, ist.day, 12, 0);
  return toIstParts(new Date(d.getTime() + days * 86_400_000));
}

function nextDowDelta(currentDow: number, targetDow: number): number {
  let delta = targetDow - currentDow;
  if (delta <= 0) delta += 7;
  return delta;
}
