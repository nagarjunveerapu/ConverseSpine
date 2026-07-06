/** Visit itinerary helpers — same-day anaphora + booked visit reads. */

import type { StoredVisit } from './ports.js';

export const SAME_DAY_RE =
  /\b(?:same\s+day|that\s+day|that\s+date|the\s+same\s+day|as\s+before)\b/i;

export const DIFFERENT_DAY_RE =
  /\b(?:different|another|next)\s+day\b|\b(?:a\s+)?different\s+day\b|\blater\s+in\s+the\s+week\b/i;

export const SAME_TIME_RE = /\bsame\s+time\b/i;

export const AFTER_THAT_RE = /\b(?:after\s+that|back\s+to\s+back)\b/i;

export function isSameDayPhrase(text: string): boolean {
  return SAME_DAY_RE.test(text.trim());
}

export function isDifferentDayPhrase(text: string): boolean {
  const t = text.trim();
  if (isSameDayPhrase(t)) return false;
  return DIFFERENT_DAY_RE.test(t);
}

export function isMorningAfternoonOnly(text: string): 'morning' | 'afternoon' | null {
  const t = text.toLowerCase();
  if (/\b(morning|subah)\b/.test(t) && !/\b(afternoon|evening|shaam|dopahar)\b/.test(t)) {
    return 'morning';
  }
  if (/\b(afternoon|dopahar)\b/.test(t) && !/\bmorning\b/.test(t)) {
    return 'afternoon';
  }
  return null;
}

/** Last confirmed visit on the itinerary — anchor for same-day scheduling. */
export function lastBookedVisit(visits: readonly StoredVisit[]): StoredVisit | null {
  const confirmed = visits.filter((v) => v.confirmed && v.iso);
  return confirmed.length > 0 ? confirmed[confirmed.length - 1]! : null;
}

/** ISO date part (YYYY-MM-DD) from last booked visit when buyer says "same day". */
export function resolveSameDayDate(
  text: string,
  priorVisitIso: string | null | undefined,
): string | null {
  if (!isSameDayPhrase(text) || !priorVisitIso) return null;
  return priorVisitIso.slice(0, 10);
}

export function minutesFromIso(iso: string): number | null {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

export function addMinutesToIso(iso: string, addMin: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const next = new Date(d.getTime() + addMin * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const ist = new Date(next.getTime() + 5.5 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const mo = ist.getUTCMonth();
  const day = ist.getUTCDate();
  const h = ist.getUTCHours();
  const mi = ist.getUTCMinutes();
  return `${y}-${pad(mo + 1)}-${pad(day)}T${pad(h)}:${pad(mi)}:00+05:30`;
}
