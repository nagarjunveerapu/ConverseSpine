import type { ConversationState, Extracted, OfferedProject, TurnGoal, VisitState } from '../types.js';
import type { StoredVisit } from '../ports.js';
import {
  extractDayWord,
  formatVisitTimeLabel,
  hasExplicitTime,
  isAfternoonWindow,
  isMorningWindow,
  parseDayAnchor,
  parseVisitSlot,
  reparseVisitTime,
  slotFromDayAndTime,
  type ParsedDayAnchor,
} from '../visit-slot.js';
import {
  firstFreeWindow,
  loadCalendarFromVisits,
  staggerAfter,
  VISIT_ON_SITE_MIN,
  wouldCollide,
} from '../visit-calendar.js';
import { isSameDayPhrase, isDifferentDayPhrase, lastBookedVisit, resolveSameDayDate, addMinutesToIso } from '../visit-itinerary.js';
import { buildProjectGeoMap, nearestProjectName, projectGeo, resolveOriginGeoCached } from '../project-geo.js';
import { orderStopsByTravel, type TripStop } from '../trip-logistics.js';

const DECLINE = /\b(no|nope|nah|not (?:that|this|now)|can'?t|cannot|won'?t work|another (?:day|time)|reschedule)\b/i;
const BARE_AFFIRM = /^(?:yes|yeah|yep|yup|ok(?:ay)?|sure|confirm(?:ed)?|go ahead|sounds good)\.?!?\s*$/i;
export const ALSO_RE = /\b(also|as well|too|bhi)\b/i;
const INSTEAD_RE = /\binstead\b|\bki jagah\b/i;
const MAX_VISIT_STOPS = 4;
const ORIGIN_CUE = /\b(?:coming from|starting from|leave from|pickup from|i'?ll be in|from)\b/i;

const VISIT_DEFERRABLE_TOPICS: import('../types.js').AnswerTopic[] = [
  'emi',
  'legal',
  'price',
  'media',
  'location',
  'property_type',
  'amenities',
  'availability',
];

const TOPIC_PROBE_IN_WHAT_ABOUT =
  /\b(?:pricing|price|legal|rera|configurations?|unit types?|units?|bhk|floor plans?|brochure|amenities|location|emi|availability|possession|media|overview|details?)\b/i;

export interface VisitFollowUpExtract {
  askTopic?: import('../types.js').AnswerTopic;
  askTopics?: import('../types.js').AnswerTopic[];
}

/** Buyer asks about the next (or another) queued visit stop — not a project Q&A probe. */
export function isVisitFollowUpQuestion(text: string, ex?: VisitFollowUpExtract): boolean {
  const t = text.trim();
  if (!/\bwhat about\b/i.test(t)) return false;
  if (ex?.askTopic && ex.askTopic !== 'compare') return false;
  if (ex?.askTopics?.some((topic) => topic !== 'compare')) return false;
  if (TOPIC_PROBE_IN_WHAT_ABOUT.test(t)) return false;
  return true;
}

/** Leave visit scheduling when the buyer asks something else (compare, more options, etc.). */
export function shouldExitVisitForIntent(ex: Extracted, text?: string): boolean {
  if (text && isVisitFollowUpQuestion(text, ex)) return false;
  if (ex.transition === 'want_visit') return false;
  if (ex.askTopic === 'compare') return true;
  if ((ex.compareProjectIds?.length ?? 0) >= 2) return true;
  if (ex.wantsMore) return true;
  if (ex.transition === 'see_others') return true;
  if (ex.rejected) return true;
  return false;
}

export interface VisitCtx {
  text: string;
  now: Date;
  siteVisitHours?: string;
  bookedVisits?: readonly StoredVisit[];
  driveFromPriorMin?: number | null;
  driveSource?: 'distance_matrix' | 'haversine' | 'none';
  originGeo?: { lat: number; lng: number } | null;
  projectGeoCatalog?: import('../project-geo.js').ProjectGeoCatalog;
}

export function exitVisitPhase(s: ConversationState): ConversationState {
  const { visit: _v, ...rest } = s;
  return { ...rest, phase: s.focus ? 'focused' : 'discover' };
}

export function decide(s: ConversationState, ex: Extracted, ctx: VisitCtx): TurnGoal {
  const prior = s.visit ?? {};
  const now = ctx.now;
  const booked = ctx.bookedVisits ?? [];

  if (ex.recall) return { kind: 'visit_recall' };

  const visitRouteExpand =
    ALSO_RE.test(ctx.text.trim()) && (ex.namedProjects?.length ?? 0) === 1 && !!prior.projectId;

  if (
    ex.askTopic &&
    VISIT_DEFERRABLE_TOPICS.includes(ex.askTopic) &&
    !parseVisitSlot(ctx.text, now) &&
    !parseDayAnchor(ctx.text, now) &&
    !visitRouteExpand
  ) {
    const answerGoal = deferToProjectAnswer(s, ex);
    if (answerGoal) return answerGoal;
  }

  if (
    isVisitFollowUpQuestion(ctx.text, ex) &&
    (ex.namedProjects?.length ?? 0) >= 1 &&
    (s.phase === 'visit' || (s.visit?.queued?.length ?? 0) > 0 || !!s.visit?.projectId)
  ) {
    return step({
      text: ctx.text,
      named: followUpNamed(ex, ctx.text, s),
      candidates: candidatesOf(s),
      prior,
      now,
      affirm: ex.affirm,
      booked,
      ctx,
    });
  }

  const anchorDate = resolveSameDayDate(ctx.text, lastBookedVisit(booked)?.iso);
  const slot = parseVisitSlot(ctx.text, now, anchorDate ? { anchorDateIso: anchorDate } : undefined);
  const proposedFuture =
    !!prior.proposedIso && new Date(prior.proposedIso).getTime() > now.getTime();

  if (
    prior.awaitingConfirm &&
    prior.proposedIso &&
    hasExplicitTime(ctx.text) &&
    !slot
  ) {
    const reparsed = reparseVisitTime(prior.proposedIso, ctx.text);
    if (reparsed) {
      const projectName = prior.projectName ?? '';
      return {
        kind: 'visit_propose',
        iso: reparsed.proposedIso,
        label: reparsed.humanLabel,
        projectName,
        projectId: prior.projectId ?? '',
        copy: `Shall I block *${reparsed.humanLabel}* for your visit to *${projectName}*? Reply yes to confirm.`,
        state: {
          ...prior,
          awaitingConfirm: true,
          proposedIso: reparsed.proposedIso,
          proposedLabel: reparsed.humanLabel,
        },
      };
    }
  }

  if (prior.awaitingConfirm && ex.affirm && !ex.decline && !slot && proposedFuture) {
    const nextQueuedStop = prior.queued?.[0];
    return {
      kind: 'visit_booked',
      label: prior.proposedLabel ?? '',
      projectName: prior.projectName ?? '',
      projectId: prior.projectId ?? '',
      iso: prior.proposedIso ?? '',
      ...(nextQueuedStop
        ? {
            nextQueuedStop: {
              projectId: nextQueuedStop.projectId,
              projectName: nextQueuedStop.projectName,
              ...(nextQueuedStop.slotText ? { slotText: nextQueuedStop.slotText } : {}),
            },
          }
        : {}),
    };
  }

  return step({ text: ctx.text, named: ex.namedProjects ?? [], candidates: candidatesOf(s), prior, now, affirm: ex.affirm, booked, ctx });
}

function deferToProjectAnswer(s: ConversationState, ex: Extracted): TurnGoal | null {
  const named = ex.namedProjects?.[0];
  const projectId =
    named?.projectId ??
    s.focus?.projectId ??
    s.discover.lastOffered[0]?.projectId;
  if (!projectId) return null;

  const topics = (ex.askTopics ?? []).filter((t) => t !== 'compare');
  const primary =
    topics[0] ?? (ex.askTopic && ex.askTopic !== 'compare' ? ex.askTopic : undefined) ?? 'overview';
  return {
    kind: 'answer',
    topic: primary,
    projectId,
    ...(topics.length > 1 ? { topics } : {}),
  };
}

function followUpNamed(ex: Extracted, text: string, s: ConversationState): OfferedProject[] {
  const named = ex.namedProjects ?? [];
  if (named.length <= 1) return named;
  const t = text.toLowerCase();
  const explicit = named.filter((p) => t.includes(p.name.toLowerCase()));
  if (explicit.length === 1) return explicit;
  const next = s.visit?.queued?.[0];
  if (next) return [{ projectId: next.projectId, name: next.projectName }];
  return named.slice(0, 1);
}

function candidatesOf(s: ConversationState): OfferedProject[] {
  if (s.focus) return [{ projectId: s.focus.projectId, name: s.focus.projectName }];
  return [...s.discover.lastOffered];
}

function say(prefix: string, sentence: string): string {
  return prefix === ''
    ? sentence.charAt(0).toUpperCase() + sentence.slice(1)
    : prefix + sentence.charAt(0).toLowerCase() + sentence.slice(1);
}

function totalStops(prior: VisitState): number {
  return (prior.projectId ? 1 : 0) + (prior.queued?.length ?? 0);
}

function looksLikeOriginAnswer(text: string, prior: VisitState): boolean {
  if (prior.lastAsk !== 'origin') return false;
  const t = text.trim();
  if (!t || BARE_AFFIRM.test(t)) return false;
  if (parseVisitSlot(t, new Date()) || parseDayAnchor(t, new Date())) return false;
  return t.length >= 3 && t.length <= 80;
}

function extractOriginFromText(text: string): string | null {
  const m = text.match(
    /\b(?:coming from|starting from|start from|leave from|i come from|i'll be in|from)\s+(.+?)(?:\s+on\b|[,.]|$)/i,
  );
  if (m?.[1]) return m[1].trim();
  if (ORIGIN_CUE.test(text)) return null;
  return null;
}

/** Locality label for copy + geo — strips "I come from …" cue phrases. */
export function normalizeOriginText(text: string): string {
  const extracted = extractOriginFromText(text);
  if (extracted) return extracted;
  return text.trim();
}

function effectiveDriveMin(ctx: VisitCtx): number | null {
  return ctx.driveFromPriorMin ?? null;
}

function formatOnSiteEndLabel(startIso: string): string {
  const endIso = addMinutesToIso(startIso, VISIT_ON_SITE_MIN);
  const m = /T(\d{2}):(\d{2})/.exec(endIso);
  if (!m) return 'about 90 min on site';
  const h = parseInt(m[1]!, 10);
  const min = parseInt(m[2]!, 10);
  return formatVisitTimeLabel(h, min);
}

function buildStaggerProposeCopy(
  lastBooked: StoredVisit,
  projectName: string,
  slotLabel: string,
  driveMin: number,
  prefix: string,
): string {
  const endTime = formatOnSiteEndLabel(lastBooked.iso);
  const body =
    `your *${lastBooked.projectName}* visit runs until about ${endTime} on site. ` +
    `~${driveMin} min drive to *${projectName}*, ` +
    `so I'm placing *${projectName}* at *${slotLabel}* — works, or tell me another time.`;
  return say(prefix, body);
}

function step(input: {
  text: string;
  named: OfferedProject[];
  candidates: OfferedProject[];
  prior: VisitState;
  now: Date;
  affirm?: boolean;
  booked: readonly StoredVisit[];
  ctx: VisitCtx;
}): TurnGoal {
  const lastBooked = lastBookedVisit(input.booked);
  const isStop2Plus = !!lastBooked;
  const anchorDate = resolveSameDayDate(input.text, lastBooked?.iso);
  const timeOnlyOnAnchoredDay =
    hasExplicitTime(input.text) &&
    !parseDayAnchor(input.text, input.now) &&
    (isStop2Plus || input.prior.lastAsk === 'time');
  const effectiveAnchorIso =
    anchorDate ??
    (timeOnlyOnAnchoredDay && lastBooked?.iso ? lastBooked.iso.slice(0, 10) : null);
  const slotOpts = effectiveAnchorIso ? { anchorDateIso: effectiveAnchorIso } : undefined;
  let slot = parseVisitSlot(input.text, input.now, slotOpts);
  const dayAnchor = parseDayAnchor(input.text, input.now, effectiveAnchorIso ?? undefined);
  const declined = !slot && !dayAnchor && DECLINE.test(input.text);
  const askN = (input.prior.askCount ?? 0) + 1;
  let prefix = declined ? 'No problem — ' : '';

  let prior = { ...input.prior };
  let projectId = prior.projectId;
  let projectName = prior.projectName;
  let queued = prior.queued ?? [];

  if (input.named.length > 1) {
    const capped = input.named.slice(0, MAX_VISIT_STOPS);
    const overflow = input.named.length - capped.length;
    const [first, ...rest] = capped;
    projectId = first!.projectId;
    projectName = first!.name;
    queued = rest.map((p) => ({ projectId: p.projectId, projectName: p.name }));
    if (overflow > 0) {
      prefix = `${prefix}We'll start with ${capped.length} stops and set up the other ${overflow} after — `;
    }
  }

  const singleNamed = input.named.length === 1 ? input.named[0]! : null;
  if (singleNamed && projectId && singleNamed.projectId !== projectId) {
    if (ALSO_RE.test(input.text) && !INSTEAD_RE.test(input.text)) {
      if (!queued.some((q) => q.projectId === singleNamed.projectId)) {
        queued = [...queued, { projectId: singleNamed.projectId, projectName: singleNamed.name }];
      }
      prefix = `We'll plan *${singleNamed.name}* as well — `;
    } else {
      const old = { projectId, projectName, queued, slotText: prior.slotText };
      const parkOld = !INSTEAD_RE.test(input.text) && !!old.projectId && !!old.slotText;
      const parked = [
        ...(parkOld
          ? [{ projectId: old.projectId!, projectName: old.projectName ?? '', slotText: old.slotText! }]
          : []),
        ...(old.queued ?? []),
      ];
      projectId = singleNamed.projectId;
      projectName = singleNamed.name;
      queued = parked;
    }
  } else if (singleNamed && !projectId) {
    projectId = singleNamed.projectId;
    projectName = singleNamed.name;
  } else if (!projectId && input.candidates.length === 1) {
    projectId = input.candidates[0]!.projectId;
    projectName = input.candidates[0]!.name;
  }

  const originFromText = extractOriginFromText(input.text);
  if (originFromText && !prior.originText) {
    prior = { ...prior, originText: originFromText, originAsked: true };
  } else if (looksLikeOriginAnswer(input.text, prior)) {
    prior = { ...prior, originText: normalizeOriginText(input.text), originAsked: true };
  }

  const baseState: VisitState = { ...prior, projectId, projectName, queued };

  if (!projectId || !projectName) {
    const copy = declined
      ? 'No problem — which project would you like to visit?'
      : 'Which project should I set up the visit for?';
    return { kind: 'visit_ask', ask: 'project', copy, state: { ...baseState, askCount: askN, lastAsk: 'project' } };
  }

  const stopCount = (projectId ? 1 : 0) + queued.length;

  if (stopCount >= 2 && !prior.originText && !prior.originAsked && !lastBookedVisit(input.booked)) {
    return {
      kind: 'visit_ask',
      ask: 'origin',
      copy: say(
        prefix,
        `where will you be coming from that day? I'll sequence the ${stopCount} stops sensibly from there.`,
      ),
      state: { ...baseState, askCount: askN, lastAsk: 'origin', originAsked: true },
    };
  }

  if (stopCount >= 2 && prior.originText && !prior.tripOrdered) {
    const cachedOrigin =
      input.ctx.originGeo ??
      (prior.originLat != null && prior.originLng != null
        ? { lat: prior.originLat, lng: prior.originLng }
        : null);
    const anchor = resolveOriginGeoCached(prior.originText, cachedOrigin);
    if (anchor) {
      const toStop = (id: string, name: string): TripStop => {
        const g = projectGeo(id, input.ctx.projectGeoCatalog);
        return { project_id: id, name, lat: g?.lat ?? null, lng: g?.lng ?? null };
      };
      const stops: TripStop[] = [toStop(projectId, projectName), ...queued.map((q) => toStop(q.projectId, q.projectName))];
      const geo = buildProjectGeoMap(stops.map((s) => s.project_id), input.ctx.projectGeoCatalog);
      const nearer = nearestProjectName(
        anchor,
        stops.map((s) => ({ projectId: s.project_id, projectName: s.name })),
        geo,
      );
      if (nearer) {
        prefix = `${prefix}From *${prior.originText}*, *${nearer}* is your nearer first stop — `;
      }
      const ordered = orderStopsByTravel(stops, anchor);
      if (ordered[0]!.project_id !== projectId) {
        const [first, ...rest] = ordered;
        projectId = first!.project_id;
        projectName = first!.name;
        queued = rest.map((s) => ({
          projectId: s.project_id,
          projectName: s.name,
        }));
      }
      prior = { ...prior, tripOrdered: true };
    }
  }

  const stopPreview =
    queued.length > 0 ? ` — then *${queued.map((q) => q.projectName).join('*, *')}*` : '';

  const explicitTime = hasExplicitTime(input.text);
  let fromStagger = false;

  if (isStop2Plus && lastBooked && prior.lastAsk === 'same_day_choice') {
    if (isDifferentDayPhrase(input.text)) {
      return {
        kind: 'visit_ask',
        ask: 'day',
        copy: say(
          prefix,
          `which day works for your visit to *${projectName}*? (e.g. Saturday, tomorrow)`,
        ),
        state: { ...baseState, ...prior, askCount: askN, lastAsk: 'day', slotText: undefined },
      };
    }
  }

  if (isStop2Plus && isVisitFollowUpQuestion(input.text) && !isSameDayPhrase(input.text) && !explicitTime) {
    return {
      kind: 'visit_ask',
      ask: 'day',
      copy: say(
        prefix,
        `which day works for your visit to *${projectName}*? (e.g. Saturday, tomorrow)`,
      ),
      state: { ...baseState, ...prior, askCount: askN, lastAsk: 'day' },
    };
  }

  if (prior.pendingDayIso && (isMorningWindow(input.text) || isAfternoonWindow(input.text))) {
    const window = isMorningWindow(input.text) ? 'morning' : 'afternoon';
    const cal = loadCalendarFromVisits('visit', input.booked);
    const freeIso = firstFreeWindow(cal.blocks, prior.pendingDayIso, window, VISIT_ON_SITE_MIN);
    if (freeIso) {
      const h = parseInt(/T(\d{2}):(\d{2})/.exec(freeIso)?.[1] ?? '10', 10);
      const m = parseInt(/T(\d{2}):(\d{2})/.exec(freeIso)?.[2] ?? '30', 10);
      slot = slotFromDayAndTime(
        { dayIso: prior.pendingDayIso, dayLabel: prior.pendingDayLabel ?? 'Visit' },
        h,
        m,
      );
      prior = { ...prior, pendingDayIso: undefined, pendingDayLabel: undefined };
    }
  }

  if (!slot && dayAnchor && !explicitTime && !isMorningWindow(input.text) && !isAfternoonWindow(input.text)) {
    if (isStop2Plus && (isSameDayPhrase(input.text) || anchorDate)) {
      const staggered = proposeStaggered(input.booked, dayAnchor, input.ctx);
      if (staggered) {
        slot = staggered;
        fromStagger = true;
      }
    } else if (!isStop2Plus) {
      return {
        kind: 'visit_ask',
        ask: 'window',
        copy: say(
          prefix,
          `for *${projectName}* on *${dayAnchor.dayLabel}*${stopPreview} — morning or afternoon?`,
        ),
        state: {
          ...baseState,
          pendingDayIso: dayAnchor.dayIso,
          pendingDayLabel: dayAnchor.dayLabel,
          askCount: askN,
          lastAsk: 'window',
        },
      };
    }
  }

  if (
    !slot &&
    isStop2Plus &&
    (isSameDayPhrase(input.text) || anchorDate || (prior.lastAsk === 'same_day_choice' && BARE_AFFIRM.test(input.text.trim()))) &&
    !explicitTime
  ) {
    const anchor: ParsedDayAnchor = dayAnchor ?? {
      dayIso: lastBooked!.iso.slice(0, 10),
      dayLabel: extractDayWord(lastBooked!.label) ?? 'Same day',
    };
    const staggered = proposeStaggered(input.booked, anchor, input.ctx);
    if (staggered) {
      slot = staggered;
      fromStagger = true;
    } else if (effectiveDriveMin(input.ctx) == null) {
      return {
        kind: 'visit_ask',
        ask: 'time',
        copy: say(
          prefix,
          `what time works for *${projectName}* on the same day as *${lastBooked!.projectName}*?`,
        ),
        state: { ...baseState, lastAsk: 'time' },
      };
    }
  }

  if (!slot && !prior.slotText && prior.lastAsk !== 'same_day_choice') {
    if (BARE_AFFIRM.test(input.text.trim())) {
      return {
        kind: 'visit_ask',
        ask: 'day',
        copy: say(
          prefix,
          `which day works for *${projectName}*${stopPreview}? — for example Saturday or tomorrow.`,
        ),
        state: { ...baseState, askCount: askN, lastAsk: 'day' },
      };
    }
    const copy = declined
      ? `No problem — which day works for *${projectName}*${stopPreview}?`
      : say(
          prefix,
          `which day works for your visit to *${projectName}*${stopPreview}? (e.g. Saturday, tomorrow)`,
        );
    return { kind: 'visit_ask', ask: 'day', copy, state: { ...baseState, askCount: askN, lastAsk: 'day' } };
  }

  const parsed =
    slot ??
    (input.prior.slotText
      ? parseVisitSlot(input.prior.slotText, input.now, slotOpts)
      : null);
  if (!parsed) {
    return {
      kind: 'visit_ask',
      ask: 'day',
      copy: `I didn't catch the day — when would you like to visit *${projectName}*? (e.g. Saturday, tomorrow)`,
      state: { ...baseState, lastAsk: 'day' },
    };
  }

  const cal = loadCalendarFromVisits('visit', input.booked);
  if (wouldCollide(parsed.proposedIso, VISIT_ON_SITE_MIN, cal.blocks)) {
    return {
      kind: 'visit_ask',
      ask: 'time',
      copy: `That overlaps with another visit on your day — what time works for *${projectName}* instead?`,
      state: { ...baseState, lastAsk: 'time' },
    };
  }

  const driveMin = effectiveDriveMin(input.ctx);
  const driveNote =
    driveMin != null && lastBooked
      ? ` (~${driveMin} min drive from *${lastBooked.projectName}*)`
      : '';
  const queuedNote =
    queued.length > 0
      ? ` After this we'll plan *${queued[0]!.projectName}*${queued.length > 1 ? ` and ${queued.length - 1} more` : ''}.`
      : '';

  const copy =
    fromStagger && lastBooked && driveMin != null
      ? buildStaggerProposeCopy(lastBooked, projectName, parsed.humanLabel, driveMin, prefix)
      : say(
          prefix,
          `shall I block *${parsed.humanLabel}* for your visit to *${projectName}*?${driveNote}${queuedNote} Reply yes to confirm.`,
        );

  return {
    kind: 'visit_propose',
    iso: parsed.proposedIso,
    label: parsed.humanLabel,
    projectName,
    projectId,
    copy,
    state: {
      ...baseState,
      ...prior,
      projectId,
      projectName,
      queued,
      awaitingConfirm: true,
      proposedIso: parsed.proposedIso,
      proposedLabel: parsed.humanLabel,
      slotText: input.text,
      lastAsk: fromStagger ? 'stagger_propose' : 'time',
      pendingDayIso: undefined,
      pendingDayLabel: undefined,
    },
  };
}

function proposeStaggered(
  booked: readonly StoredVisit[],
  dayAnchor: ParsedDayAnchor,
  ctx: VisitCtx,
): ReturnType<typeof parseVisitSlot> {
  const prior = lastBookedVisit(booked);
  if (!prior?.iso) return null;
  const driveMin = effectiveDriveMin(ctx);
  if (driveMin == null) return null;
  const nextIso = staggerAfter(prior.iso, driveMin, VISIT_ON_SITE_MIN);
  const h = parseInt(/T(\d{2}):(\d{2})/.exec(nextIso)?.[1] ?? '12', 10);
  const m = parseInt(/T(\d{2}):(\d{2})/.exec(nextIso)?.[2] ?? '0', 10);
  return slotFromDayAndTime(
    { dayIso: dayAnchor.dayIso, dayLabel: dayAnchor.dayLabel },
    h,
    m,
  );
}

export function recallReply(): string {
  return "I'll pull your visit schedule from our system — our team can confirm the exact slots on WhatsApp.";
}

export function isVisitRouteExpand(text: string): boolean {
  return ALSO_RE.test(text.trim()) || /\b(?:add|include)\b/i.test(text.trim());
}
