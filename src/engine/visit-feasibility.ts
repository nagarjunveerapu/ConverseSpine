/**
 * Same-day pack feasibility: 120 min on-site + drives vs site hours.
 */

import { VISIT_ON_SITE_MIN } from './visit-calendar.js';
import { checkSlotAgainstHours, parseSiteVisitHours } from './visit-hours.js';
import { addMinutesToIso } from './visit-itinerary.js';

export const LONG_DRIVE_MIN = 75;
export const MAX_SAME_DAY_SPAN_MIN = 6.5 * 60;

export interface PackStop {
  projectId: string;
  projectName: string;
  /** Drive minutes INTO this stop from previous (0 for first). */
  driveInMin: number | null;
}

export interface PackedStop {
  projectId: string;
  projectName: string;
  startIso: string;
  endIso: string;
  fits: boolean;
}

export interface PackResult {
  stops: PackedStop[];
  fitting: PackedStop[];
  overflow: PackedStop[];
  preferSplit: boolean;
  preferSplitReason?: 'long_drive' | 'ends_after_close' | 'over_span';
}

export function packSameDay(input: {
  dayIso: string;
  firstStartIso: string;
  stops: PackStop[];
  siteVisitHours?: string | null;
  onSiteMin?: number;
}): PackResult {
  const onSite = input.onSiteMin ?? VISIT_ON_SITE_MIN;
  const packed: PackedStop[] = [];
  let priorStart: string | null = null;

  for (let i = 0; i < input.stops.length; i++) {
    const s = input.stops[i]!;
    let startIso: string;
    if (i === 0) {
      startIso = input.firstStartIso;
    } else if (s.driveInMin == null) {
      startIso = addMinutesToIso(priorStart!, onSite);
    } else {
      startIso = addMinutesToIso(priorStart!, onSite + s.driveInMin);
    }
    const endIso = addMinutesToIso(startIso, onSite);
    const check = checkSlotAgainstHours(startIso, onSite, input.siteVisitHours);
    packed.push({
      projectId: s.projectId,
      projectName: s.projectName,
      startIso,
      endIso,
      fits: check.ok,
    });
    priorStart = startIso;
  }

  const fitting = packed.filter((p) => p.fits);
  const overflow = packed.filter((p) => !p.fits);

  let preferSplit = false;
  let preferSplitReason: PackResult['preferSplitReason'];

  if (input.stops.some((s, i) => i > 0 && s.driveInMin != null && s.driveInMin >= LONG_DRIVE_MIN)) {
    preferSplit = true;
    preferSplitReason = 'long_drive';
  }
  if (overflow.length > 0) {
    preferSplit = true;
    preferSplitReason = preferSplitReason ?? 'ends_after_close';
  }
  if (input.stops.length >= 3 && packed.length >= 2) {
    const span =
      (new Date(packed[packed.length - 1]!.endIso).getTime() - new Date(packed[0]!.startIso).getTime()) /
      60000;
    if (span > MAX_SAME_DAY_SPAN_MIN) {
      preferSplit = true;
      preferSplitReason = preferSplitReason ?? 'over_span';
    }
  }

  return { stops: packed, fitting, overflow, preferSplit, preferSplitReason };
}

export function splitDayCopy(input: {
  fittingNames: string[];
  overflowNames: string[];
  hoursLabel?: string;
  reason?: PackResult['preferSplitReason'];
}): string {
  const day1 = input.fittingNames.length ? input.fittingNames.join(' + ') : 'the nearer stops';
  const rest = input.overflowNames.join(' + ') || 'the farther stop';
  const hours = input.hoursLabel ?? parseSiteVisitHours().label;
  const why =
    input.reason === 'long_drive'
      ? 'These stops are far apart'
      : `With ~2 hours at each site plus drives, a same-day run won't fit inside site hours (${hours})`;
  return `${why}. I'd plan *${day1}* on day 1, then *${rest}* on the next day — OK, or force all same day?`;
}

export function forceSameDayPartialCopy(input: {
  fittingNames: string[];
  overflowNames: string[];
  hoursLabel?: string;
}): string {
  const hours = input.hoursLabel ?? parseSiteVisitHours().label;
  const firm = input.fittingNames.join(' + ');
  const pending = input.overflowNames.join(' + ');
  return (
    `With ~2 hours at each site plus drives, *${pending}* would land after site hours (${hours}). ` +
    `I can confirm *${firm}* now. For *${pending}* same day, I'll send a request to the team — ` +
    `they may not be able to host after hours. Shall I confirm the firm stop(s) and note *${pending}* as a same-day team request?`
  );
}

export const FORCE_SAME_DAY_RE =
  /\b(?:force|all\s+same\s+day|same\s+day\s+(?:anyway|all)|all\s+(?:three|four)\s+same)\b/i;

export const ACCEPT_SPLIT_RE =
  /\b(?:next\s+day|other\s+day|different\s+day|split|two\s+days)\b/i;
