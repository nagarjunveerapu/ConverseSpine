/** IST visit slot parsing — buyer-stated day/time only. No silent 11 AM default. */

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

export interface ParsedVisitSlot {
  proposedIso: string;
  humanLabel: string;
}

export interface ParsedDayAnchor {
  dayIso: string;
  dayLabel: string;
}

export function extractDayWord(text: string): string | null {
  const m = text.toLowerCase().match(
    /\b(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  );
  return m?.[1] ?? null;
}

/** Explicit clock time from buyer text — null when none stated. */
export function extractVisitTime(text: string): { hour: number; minute: number } | null {
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

  return null;
}

export function formatVisitTimeLabel(hour: number, minute: number): string {
  const h12 = hour % 12 || 12;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const mins = minute > 0 ? `:${String(minute).padStart(2, '0')}` : ':00';
  return `${h12}${mins} ${ampm}`;
}

export function hasExplicitTime(text: string): boolean {
  return extractVisitTime(text) !== null;
}

export function isMorningWindow(text: string): boolean {
  return /\b(morning|subah)\b/i.test(text) && !/\b(afternoon|evening|dopahar|shaam)\b/i.test(text);
}

export function isAfternoonWindow(text: string): boolean {
  return /\b(afternoon|dopahar)\b/i.test(text) && !/\bmorning\b/i.test(text);
}

/** Re-time a previously chosen day — e.g. buyer says "12 PM" after Saturday was proposed. */
export function reparseVisitTime(priorIso: string, timeText: string): ParsedVisitSlot | null {
  const anchor = new Date(priorIso);
  if (Number.isNaN(anchor.getTime())) return null;
  const parsed = extractVisitTime(timeText);
  if (!parsed) return null;
  const { hour, minute } = parsed;
  const parts = toIstParts(anchor);
  const target = istInstant(parts.year, parts.month, parts.day, hour, minute);
  if (target.getTime() <= Date.now()) return null;
  const dayLabel = DAY_FULL[parts.dow] ?? 'Visit';
  return {
    proposedIso: toIstIso(parts.year, parts.month, parts.day, hour, minute),
    humanLabel: `${dayLabel} at ${formatVisitTimeLabel(hour, minute)}`,
  };
}

/** Day anchor without inventing a clock time. */
export function parseDayAnchor(raw: string, now: Date, anchorDateIso?: string): ParsedDayAnchor | null {
  const text = raw.toLowerCase().trim();
  if (!text && !anchorDateIso) return null;

  if (anchorDateIso && /same\s+day|that\s+day|that\s+date|as\s+before/i.test(text)) {
    const parts = anchorDateIso.slice(0, 10).split('-').map(Number);
    if (parts.length !== 3) return null;
    const d = istInstant(parts[0]!, parts[1]! - 1, parts[2]!, 12, 0);
    const ist = toIstParts(d);
    return { dayIso: anchorDateIso.slice(0, 10), dayLabel: DAY_FULL[ist.dow]! };
  }

  const ist = toIstParts(now);
  let parts: IstParts | null = null;
  let dayLabel = '';

  if (/\btomorrow\b/.test(text)) {
    parts = addDaysParts(ist, 1);
    dayLabel = 'Tomorrow';
  } else if (/\btoday\b/.test(text)) {
    parts = ist;
    dayLabel = 'Today';
  } else {
    for (const [word, dow] of Object.entries(DAY_NAMES)) {
      if (new RegExp(`\\b${word}\\b`).test(text)) {
        parts = addDaysParts(ist, nextDowDelta(ist.dow, dow));
        dayLabel = DAY_FULL[dow]!;
        break;
      }
    }
  }

  if (!parts) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const dayIso = `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)}`;
  const probe = istInstant(parts.year, parts.month, parts.day, 18, 0);
  if (probe.getTime() <= now.getTime()) return null;
  return { dayIso, dayLabel };
}

export function slotFromDayAndTime(
  dayAnchor: ParsedDayAnchor,
  hour: number,
  minute: number,
): ParsedVisitSlot {
  const [y, mo, d] = dayAnchor.dayIso.split('-').map(Number);
  return {
    proposedIso: toIstIso(y!, mo! - 1, d!, hour, minute),
    humanLabel: `${dayAnchor.dayLabel} at ${formatVisitTimeLabel(hour, minute)}`,
  };
}

export function parseVisitSlot(
  raw: string,
  now: Date,
  opts?: { anchorDateIso?: string; forceTime?: { hour: number; minute: number } },
): ParsedVisitSlot | null {
  const text = raw.toLowerCase().trim();
  if (!text && !opts?.forceTime) return null;

  const explicit = opts?.forceTime ?? extractVisitTime(raw);
  const dayOnly = !explicit && !isMorningWindow(raw) && !isAfternoonWindow(raw);

  const dayAnchor = parseDayAnchor(raw, now, opts?.anchorDateIso);
  if (!dayAnchor) return null;

  if (dayOnly) return null;

  let hour: number;
  let minute: number;
  if (explicit) {
    hour = explicit.hour;
    minute = explicit.minute;
  } else if (isMorningWindow(raw)) {
    hour = 10;
    minute = 30;
  } else if (isAfternoonWindow(raw)) {
    hour = 14;
    minute = 0;
  } else {
    return null;
  }

  const target = istInstant(
    ...(() => {
      const [y, mo, d] = dayAnchor.dayIso.split('-').map(Number);
      return [y!, mo! - 1, d!, hour, minute] as const;
    })(),
  );
  if (target.getTime() <= now.getTime()) return null;

  return slotFromDayAndTime(dayAnchor, hour, minute);
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
