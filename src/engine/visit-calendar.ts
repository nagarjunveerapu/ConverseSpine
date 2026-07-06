/** Single-buyer visit day calendar — v1 blocks from itinerary + in-flight propose. */

import type { StoredVisit } from './ports.js';
import { addMinutesToIso, minutesFromIso } from './visit-itinerary.js';

export const VISIT_ON_SITE_MIN = 90;

export type DayWindow = 'morning' | 'afternoon';

export type CalendarBlockStatus = 'proposed' | 'booked';

export interface CalendarBlock {
  projectId: string;
  projectName: string;
  startIso: string;
  endIso: string;
  status: CalendarBlockStatus;
  consent: 'awaiting' | 'confirmed';
}

export interface VisitDayCalendar {
  calendarId: string;
  timezone: 'Asia/Kolkata';
  capacityMode: 'single_buyer';
  visitOnSiteMin: number;
  blocks: CalendarBlock[];
}

const MORNING_START_MIN = 10 * 60 + 30;
const AFTERNOON_START_MIN = 14 * 60;
const MORNING_END_MIN = 12 * 60;
const AFTERNOON_END_MIN = 17 * 60;

function endIso(startIso: string, durationMin: number): string {
  return addMinutesToIso(startIso, durationMin);
}

export function loadCalendarFromVisits(
  calendarId: string,
  visits: readonly StoredVisit[],
  activePropose?: { projectId: string; projectName: string; iso: string; awaiting: boolean },
): VisitDayCalendar {
  const blocks: CalendarBlock[] = [];
  for (const v of visits) {
    if (!v.iso) continue;
    blocks.push({
      projectId: v.projectId,
      projectName: v.projectName,
      startIso: v.iso,
      endIso: endIso(v.iso, VISIT_ON_SITE_MIN),
      status: v.confirmed ? 'booked' : 'proposed',
      consent: v.confirmed ? 'confirmed' : 'awaiting',
    });
  }
  if (activePropose?.iso) {
    const dup = blocks.some(
      (b) => b.projectId === activePropose.projectId && b.startIso === activePropose.iso,
    );
    if (!dup) {
      blocks.push({
        projectId: activePropose.projectId,
        projectName: activePropose.projectName,
        startIso: activePropose.iso,
        endIso: endIso(activePropose.iso, VISIT_ON_SITE_MIN),
        status: 'proposed',
        consent: activePropose.awaiting ? 'awaiting' : 'confirmed',
      });
    }
  }
  return {
    calendarId,
    timezone: 'Asia/Kolkata',
    capacityMode: 'single_buyer',
    visitOnSiteMin: VISIT_ON_SITE_MIN,
    blocks,
  };
}

function blocksOnDay(blocks: readonly CalendarBlock[], dayIso: string): CalendarBlock[] {
  return blocks.filter((b) => b.startIso.slice(0, 10) === dayIso);
}

export function wouldCollide(
  candidateIso: string,
  durationMin: number,
  blocks: readonly CalendarBlock[],
): boolean {
  const day = candidateIso.slice(0, 10);
  const startMin = minutesFromIso(candidateIso);
  if (startMin === null) return false;
  const endMin = startMin + durationMin;
  for (const b of blocksOnDay(blocks, day)) {
    const bStart = minutesFromIso(b.startIso);
    const bEnd = minutesFromIso(b.endIso);
    if (bStart === null || bEnd === null) continue;
    if (startMin < bEnd && endMin > bStart) return true;
  }
  return false;
}

export function firstFreeWindow(
  blocks: readonly CalendarBlock[],
  dayIso: string,
  window: DayWindow,
  durationMin: number,
): string | null {
  const dayBlocks = blocksOnDay(blocks, dayIso);
  const startBound = window === 'morning' ? MORNING_START_MIN : AFTERNOON_START_MIN;
  const endBound = window === 'morning' ? MORNING_END_MIN : AFTERNOON_END_MIN;

  for (let min = startBound; min + durationMin <= endBound; min += 15) {
    const hh = String(Math.floor(min / 60)).padStart(2, '0');
    const mm = String(min % 60).padStart(2, '0');
    const candidate = `${dayIso}T${hh}:${mm}:00+05:30`;
    if (!wouldCollide(candidate, durationMin, dayBlocks)) return candidate;
  }
  return null;
}

export function staggerAfter(
  priorStartIso: string,
  driveMin: number,
  onSiteMin: number = VISIT_ON_SITE_MIN,
): string {
  return addMinutesToIso(priorStartIso, onSiteMin + driveMin);
}
