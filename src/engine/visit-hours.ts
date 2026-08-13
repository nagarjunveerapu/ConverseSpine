/**
 * Parse builder site_visit_hours and validate visit start/end (IST).
 * Default when missing/unparseable: Mon–Sun, 9am–7pm.
 */

export const DEFAULT_SITE_VISIT_HOURS = 'Mon–Sun, 9am–7pm';

export interface SiteHoursWindow {
  /** Minutes from midnight IST — inclusive open. */
  openMin: number;
  /** Minutes from midnight IST — exclusive close for end-of-visit. */
  closeMin: number;
  /** Raw string used (default or builder). */
  label: string;
}

const TIME_RE =
  /(\d{1,2})\s*(?::(\d{2}))?\s*(am|pm)?/gi;

function parseClockToMin(raw: string): number | null {
  const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1]!, 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (!ap && h <= 7) h += 12; // bare "7" in "9am-7pm" → 7pm
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Extract open/close from strings like "Mon–Sun, 9am–7pm" or "9:00 AM - 7:00 PM". */
export function parseSiteVisitHours(raw?: string | null): SiteHoursWindow {
  const label = (raw && raw.trim()) || DEFAULT_SITE_VISIT_HOURS;
  const times: number[] = [];
  const re = new RegExp(TIME_RE.source, 'gi');
  let match: RegExpExecArray | null;
  const s = label.replace(/[–—]/g, '-');
  while ((match = re.exec(s)) !== null) {
    const chunk = match[0]!;
    const min = parseClockToMin(chunk);
    if (min != null) times.push(min);
  }
  if (times.length >= 2) {
    const openMin = times[0]!;
    let closeMin = times[1]!;
    // "9am-7pm" second token may parse as 7 if am/pm lost — prefer later close
    if (closeMin <= openMin && closeMin < 12 * 60) closeMin += 12 * 60;
    return { openMin, closeMin, label };
  }
  return { openMin: 9 * 60, closeMin: 19 * 60, label: DEFAULT_SITE_VISIT_HOURS };
}

const DAY_TOKENS: ReadonlyArray<readonly [RegExp, number]> = [
  [/^sun/i, 0], [/^mon/i, 1], [/^tue/i, 2], [/^wed/i, 3],
  [/^thu/i, 4], [/^fri/i, 5], [/^sat/i, 6],
];

function dayIndex(token: string): number | null {
  for (const [re, idx] of DAY_TOKENS) if (re.test(token.trim())) return idx;
  return null;
}

/**
 * Which weekdays the site is open, from the same string the copy quotes
 * ("Mon–Sun, 9am–7pm" → all seven; "Mon–Sat" → six; "Sat, Sun" → two).
 *
 * Chrome that offers a day must be cut from THIS — the walk shipped copy
 * saying Mon–Sun beside buttons saying Saturday/Sunday, which reads to a
 * buyer as "they don't work weekdays".
 */
export function parseSiteVisitDays(raw?: string | null): Set<number> {
  const all = new Set([0, 1, 2, 3, 4, 5, 6]);
  const label = (raw && raw.trim()) || DEFAULT_SITE_VISIT_HOURS;
  // Day part only — drop anything from the first clock token onward.
  const dayPart = label.replace(/[–—]/g, '-').split(/\d/)[0] ?? '';
  if (!dayPart.trim()) return all;
  const range = /([a-z]{3,9})\s*-\s*([a-z]{3,9})/i.exec(dayPart);
  if (range) {
    const from = dayIndex(range[1]!);
    const to = dayIndex(range[2]!);
    if (from === null || to === null) return all;
    const out = new Set<number>();
    for (let i = 0, d = from; i < 7; i++, d = (d + 1) % 7) {
      out.add(d);
      if (d === to) break;
    }
    return out.size ? out : all;
  }
  const listed = dayPart
    .split(/[,/&]|\band\b/i)
    .map((t) => dayIndex(t))
    .filter((d): d is number => d !== null);
  return listed.length ? new Set(listed) : all;
}

export function minutesFromIsoIst(iso: string): number | null {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

export interface SlotHoursCheck {
  ok: boolean;
  reason?: 'before_open' | 'ends_after_close' | 'bad_iso';
  openMin: number;
  closeMin: number;
  startMin: number | null;
  endMin: number | null;
  hoursLabel: string;
  /** Latest start that still finishes by close for onSiteMin. */
  latestStartMin: number;
}

/** Fit = open ≤ start and start + onSiteMin ≤ close (IST wall clock on that day). */
export function checkSlotAgainstHours(
  startIso: string,
  onSiteMin: number,
  hoursRaw?: string | null,
): SlotHoursCheck {
  const hours = parseSiteVisitHours(hoursRaw);
  const startMin = minutesFromIsoIst(startIso);
  const latestStartMin = hours.closeMin - onSiteMin;
  if (startMin == null) {
    return {
      ok: false,
      reason: 'bad_iso',
      openMin: hours.openMin,
      closeMin: hours.closeMin,
      startMin: null,
      endMin: null,
      hoursLabel: hours.label,
      latestStartMin,
    };
  }
  const endMin = startMin + onSiteMin;
  if (startMin < hours.openMin) {
    return {
      ok: false,
      reason: 'before_open',
      openMin: hours.openMin,
      closeMin: hours.closeMin,
      startMin,
      endMin,
      hoursLabel: hours.label,
      latestStartMin,
    };
  }
  if (endMin > hours.closeMin) {
    return {
      ok: false,
      reason: 'ends_after_close',
      openMin: hours.openMin,
      closeMin: hours.closeMin,
      startMin,
      endMin,
      hoursLabel: hours.label,
      latestStartMin,
    };
  }
  return {
    ok: true,
    openMin: hours.openMin,
    closeMin: hours.closeMin,
    startMin,
    endMin,
    hoursLabel: hours.label,
    latestStartMin,
  };
}

export function formatMinutesAsClock(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const ap = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}:00 ${ap}` : `${h12}:${String(m).padStart(2, '0')} ${ap}`;
}

/** Nearest in-window start on same day ISO date (clamp to open / latestStart). */
export function nearestInWindowStartIso(
  dayIso: string,
  desiredStartMin: number,
  onSiteMin: number,
  hoursRaw?: string | null,
): string | null {
  const hours = parseSiteVisitHours(hoursRaw);
  const latest = hours.closeMin - onSiteMin;
  if (latest < hours.openMin) return null;
  let start = Math.max(hours.openMin, Math.min(desiredStartMin, latest));
  // snap to 15 min
  start = Math.round(start / 15) * 15;
  if (start < hours.openMin) start = hours.openMin;
  if (start > latest) start = latest;
  const hh = String(Math.floor(start / 60)).padStart(2, '0');
  const mm = String(start % 60).padStart(2, '0');
  return `${dayIso}T${hh}:${mm}:00+05:30`;
}
