import type { ConversationState, Extracted, OfferedProject, TurnGoal, VisitState } from '../types.js';
import type { StoredVisit } from '../ports.js';
import {
  extractDayWord,
  extractVisitTime,
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
import { isPlausiblePlaceLabel, isNonPlaceUtterance } from '../placeability.js';
import {
  firstFreeWindow,
  loadCalendarFromVisits,
  staggerAfter,
  VISIT_ON_SITE_MIN,
  wouldCollide,
} from '../visit-calendar.js';
import {
  visitChooserPlanPrefix,
  visitForceTeamConfirmCopy,
  visitOriginAskCopy,
  visitProposeConfirmCopy,
} from '../advisory-copy.js';
import {
  isSameDayPhrase,
  isDifferentDayPhrase,
  lastBookedVisit,
  resolveSameDayDate,
  addMinutesToIso,
  formatDriveDuration,
} from '../visit-itinerary.js';
import { buildProjectGeoMap, nearestProjectName, projectGeo, resolveOriginGeoCached } from '../project-geo.js';
import { orderStopsByTravel, type TripStop } from '../trip-logistics.js';
import { resolveFaqQuestionKeys } from '../faq-keys.js';
import { DEFERRABLE_ANSWER_TOPICS } from '../turn-routing/from-speech-act.js';
import { BARE_BHK_CONFIG_RE } from '../turn-routing/intent-authority.js';
import { discourseEntities, discourseOffered, currentShortlist, discussedList } from '../entity-store.js';
import {
  applyPickToQueue,
  formatWhichChooserCopy,
  isAllDeixis,
  resolveWhichPick,
} from '../visit-which.js';
import {
  checkSlotAgainstHours,
  formatMinutesAsClock,
  nearestInWindowStartIso,
  parseSiteVisitHours,
} from '../visit-hours.js';
import {
  ACCEPT_SPLIT_RE,
  FORCE_SAME_DAY_RE,
  forceSameDayPartialCopy,
  packSameDay,
  splitDayCopy,
} from '../visit-feasibility.js';

const DECLINE = /\b(no|nope|nah|not (?:that|this|now)|can'?t|cannot|won'?t work|another (?:day|time)|reschedule)\b/i;
const BARE_AFFIRM = /^(?:yes|yeah|yep|yup|ok(?:ay)?|sure|confirm(?:ed)?|go ahead|sounds good)\.?!?\s*$/i;
/** Closed size token mid-visit ("2BHK") — answer configs, do not re-ask day. */
const BARE_BHK_CONFIG = BARE_BHK_CONFIG_RE;
export const ALSO_RE = /\b(also|as well|too|bhi)\b/i;
export const INSTEAD_RE = /\binstead\b|\bki jagah\b/i;
/** Replace current stop — not add/park (VIS-ADX-08). */
export const REPLACE_STOP_RE =
  /\b(?:instead|rather|actually|forget\s+(?:ayana|that|it)|cancel\s+(?:ayana|that)|ki jagah)\b/i;
const MAX_VISIT_STOPS = 4;
const ORIGIN_CUE = /\b(?:coming from|starting from|leave from|pickup from|i'?ll be in|from)\b/i;

/** Project swap during visit — must not be captured as pickup origin (W3). */
export function isVisitProjectSwitchUtterance(
  text: string,
  namedCount: number,
): boolean {
  if (namedCount < 1) return false;
  if (REPLACE_STOP_RE.test(text) || INSTEAD_RE.test(text)) return true;
  if (ALSO_RE.test(text)) return true;
  return false;
}

/** SA-4: shared facet list + overview (builder/ROI/FAQ cards defer mid-visit). */
const VISIT_DEFERRABLE_TOPICS: readonly import('../types.js').AnswerTopic[] = [
  ...DEFERRABLE_ANSWER_TOPICS,
  'overview',
];

const TOPIC_PROBE_IN_WHAT_ABOUT =
  /\b(?:pricing|price|legal|rera|configurations?|unit types?|units?|bhk|floor plans?|brochure|amenities|location|emi|availability|possession|media|details?)\b/i;

export interface VisitFollowUpExtract {
  askTopic?: import('../types.js').AnswerTopic;
  askTopics?: import('../types.js').AnswerTopic[];
}

/** Buyer asks about the next (or another) queued visit stop — not a project Q&A probe. */
export function isVisitFollowUpQuestion(text: string, ex?: VisitFollowUpExtract): boolean {
  const t = text.trim();
  if (!/\bwhat about\b/i.test(t)) return false;
  // Facet topics block visit follow-up; overview from bare "what about X?" does not (SA-4 / V02).
  const facetTopic = (topic: import('../types.js').AnswerTopic | undefined) =>
    !!topic && topic !== 'compare' && topic !== 'overview';
  if (facetTopic(ex?.askTopic)) return false;
  if (ex?.askTopics?.some((topic) => facetTopic(topic))) return false;
  if (TOPIC_PROBE_IN_WHAT_ABOUT.test(t)) return false;
  return true;
}

const VISIT_ITINERARY_KINDS = new Set([
  'visit_same_day',
  'visit_other_day',
  'visit_force_same_day',
  'visit_ask_team',
  'visit_choose_stops',
  'book_visit',
]);

/** Leave visit scheduling when the buyer asks something else (compare, more options, etc.). */
export function shouldExitVisitForIntent(
  ex: Extracted,
  text?: string,
  embedKind?: string,
  visit?: VisitState,
): boolean {
  if (text && isVisitFollowUpQuestion(text, ex)) return false;
  // Teach-bound itinerary / chooser acts win over false compare stamps.
  if (embedKind && VISIT_ITINERARY_KINDS.has(embedKind)) return false;
  // Closed chooser deixis while which_projects is outstanding — permanent
  // closed-format validator (both/dono/sab/ordinals), not open-act regex.
  if (
    visit?.lastAsk === 'which_projects' &&
    text &&
    !/\bcompare\b/i.test(text) &&
    (isAllDeixis(text) || /^\d+(?:\s*(?:and|,|&)\s*\d+)+$/i.test(text.trim()))
  ) {
    return false;
  }
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
  /** From INTENT_VECTORS bind — teach lane owns open phrasing. */
  embedderIntentKind?: string;
  /** When true, ask-team / force-same-day ignore regex fallback (teach ablation). */
  embedActsOnly?: boolean;
  /** Voice — advisor_web consultative copy; default WhatsApp procedural. */
  channel?: 'whatsapp' | 'advisor_web';
}

/**
 * Leave the visit *phase* for a digression (compare / more options) but keep
 * the scheduling draft (origin, queue, lastAsk, proposed slot). Wiping the
 * draft made "compare → I'll come from Indiranagar" forget the origin ask
 * (VIS-ADX-05). Re-entry is in turn.ts when the draft is still actionable.
 */
export function exitVisitPhase(s: ConversationState): ConversationState {
  return { ...s, phase: s.focus ? 'focused' : 'discover' };
}

/** Draft still waiting on an answer — buyer can resume without saying "visit" again. */
export function hasResumableVisitDraft(visit: VisitState | undefined): boolean {
  if (!visit) return false;
  if (visit.awaitingConfirm && visit.proposedIso) return true;
  if (visit.proposedIso && !visit.awaitingConfirm) return true;
  if ((visit.queued?.length ?? 0) > 0 || (visit.candidateIds?.length ?? 0) > 0) return true;
  if (visit.originAsked && !visit.originText) return true;
  return (
    visit.lastAsk === 'origin' ||
    visit.lastAsk === 'which_projects' ||
    visit.lastAsk === 'day' ||
    visit.lastAsk === 'time' ||
    visit.lastAsk === 'window' ||
    visit.lastAsk === 'same_day_choice' ||
    visit.lastAsk === 'split_day' ||
    visit.lastAsk === 'team_request'
  );
}

/**
 * After soft-exit digression, re-enter visit when the utterance continues the draft
 * (origin locality, day/time, packed visit, chooser deixis) — not a fresh catalog ask.
 */
export function shouldResumeVisitDraft(
  visit: VisitState | undefined,
  text: string,
  ex: Extracted,
  embedKind?: string,
): boolean {
  if (!hasResumableVisitDraft(visit)) return false;
  // Teach-bound visit acts resume even when extract falsely stamped compare.
  if (embedKind && VISIT_ITINERARY_KINDS.has(embedKind)) return true;
  if (ex.askTopic === 'compare' || (ex.compareProjectIds?.length ?? 0) >= 2) return false;
  if (ex.wantsMore || ex.transition === 'see_others' || ex.rejected) return false;
  if (ex.transition === 'want_visit') return true;
  if (parseVisitSlot(text, new Date()) || parseDayAnchor(text, new Date())) return true;
  // FALLBACK — phrase anaphora when embed abstains (VIS-MV-09).
  if (isSameDayPhrase(text) || isDifferentDayPhrase(text)) return true;
  if (
    (isAllDeixis(text) || embedKind === 'visit_choose_stops') &&
    visit?.lastAsk === 'which_projects'
  ) {
    return true;
  }
  if (visit?.lastAsk === 'origin' || (visit?.originAsked && !visit.originText)) {
    return looksLikeOriginAnswer(text, visit!, ex.namedProjects?.length ?? 0);
  }
  if (BARE_AFFIRM.test(text.trim()) && visit?.proposedIso) return true;
  return false;
}

export function decide(s: ConversationState, ex: Extracted, ctx: VisitCtx): TurnGoal {
  const prior = s.visit ?? {};
  const now = ctx.now;
  const booked = ctx.bookedVisits ?? [];

  if (ex.recall) return { kind: 'visit_recall' };

  const visitRouteExpand =
    ALSO_RE.test(ctx.text.trim()) && (ex.namedProjects?.length ?? 0) === 1 && !!prior.projectId;

  // Facet/overview/FAQ mid-scheduling → answer the project, keep visit state.
  // overview was missing from the shared facet list, so builder/ROI Hindi asks
  // fell through to visit_ask (P1 residual-22). Do not steal SA-4 "what about
  // <next stop>?" follow-ups — those resolve to overview but stay on visit day.
  // Never defer while awaiting morning/afternoon — "Morning around 11am" must
  // bind the window (embedder can spuriously stamp availability/FAQ keys).
  const awaitingWindow =
    prior.lastAsk === 'window' || Boolean(prior.pendingDayIso);
  const bareBhkConfig = BARE_BHK_CONFIG.test(ctx.text.trim());
  const deferTopic =
    bareBhkConfig ||
    (ex.askTopic && VISIT_DEFERRABLE_TOPICS.includes(ex.askTopic)) ||
    (ex.askTopics ?? []).some((t) => VISIT_DEFERRABLE_TOPICS.includes(t)) ||
    resolveFaqQuestionKeys(ctx.text).length > 0;
  if (
    deferTopic &&
    !awaitingWindow &&
    !isVisitFollowUpQuestion(ctx.text, ex) &&
    !parseVisitSlot(ctx.text, now) &&
    !parseDayAnchor(ctx.text, now) &&
    !wantsSameDay(ctx.text, ctx.embedderIntentKind, ctx.embedActsOnly) &&
    !wantsOtherDay(ctx.text, ctx.embedderIntentKind, ctx.embedActsOnly) &&
    !visitRouteExpand
  ) {
    const answerGoal = deferToProjectAnswer(
      s,
      bareBhkConfig
        ? {
            ...ex,
            askTopic: 'availability',
            askTopics: ['availability'],
            speechAct: 'answer',
          }
        : ex,
    );
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

  const anchorDate = sameDayAnchorIso(
    ctx.text,
    lastBookedVisit(booked)?.iso,
    ctx.embedderIntentKind,
    ctx.embedActsOnly,
  );
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
        copy: visitProposeConfirmCopy({
          channel: ctx.channel,
          label: reparsed.humanLabel,
          projectName,
        }),
        state: {
          ...prior,
          awaitingConfirm: true,
          proposedIso: reparsed.proposedIso,
          proposedLabel: reparsed.humanLabel,
        },
      };
    }
  }

  // A visit is a fact only with a slot AND a named project (Desk
  // docs/designs/visit-fact-measurement.html, F1+F2). proposedFuture already
  // guarantees the slot; a confirm state that somehow lost its project must
  // ask rather than book — an unattributed booking is exactly the row Desk
  // can never prove happened.
  if (
    prior.awaitingConfirm && ex.affirm && !ex.decline && !slot && proposedFuture
    && !prior.projectId
  ) {
    return {
      kind: 'visit_ask',
      ask: 'project',
      copy: 'Which project should I set up the visit for?',
      state: { ...prior, awaitingConfirm: false, lastAsk: 'project' },
    };
  }

  if (prior.awaitingConfirm && ex.affirm && !ex.decline && !slot && proposedFuture) {
    const nextQueuedStop = prior.queued?.[0];
    return {
      kind: 'visit_booked',
      label: prior.proposedLabel ?? '',
      projectName: prior.projectName ?? '',
      projectId: prior.projectId!,
      iso: prior.proposedIso!,
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

  // Digression cleared awaitingConfirm (VIS-ADX-04) — bare yes re-proposes, never books.
  if (
    !prior.awaitingConfirm &&
    prior.proposedIso &&
    prior.projectId &&
    proposedFuture &&
    ex.affirm &&
    !ex.decline &&
    !slot &&
    BARE_AFFIRM.test(ctx.text.trim())
  ) {
    const projectName = prior.projectName ?? '';
    const label = prior.proposedLabel ?? 'that slot';
    return {
      kind: 'visit_propose',
      iso: prior.proposedIso,
      label,
      projectName,
      projectId: prior.projectId,
      copy: visitProposeConfirmCopy({
        channel: ctx.channel,
        label,
        projectName,
        justConfirm: true,
      }),
      state: { ...prior, awaitingConfirm: true },
    };
  }

  return step({
    text: ctx.text,
    named: ex.namedProjects ?? [],
    candidates: candidatesOf(s),
    prior,
    now,
    affirm: ex.affirm,
    booked,
    ctx,
    wantVisit: ex.transition === 'want_visit',
  });
}

function deferToProjectAnswer(s: ConversationState, ex: Extracted): TurnGoal | null {
  const named = ex.namedProjects?.[0];
  const projectId =
    named?.projectId ??
    s.focus?.projectId ??
    s.visit?.projectId ??
    discourseOffered(s)[0]?.projectId ??
    currentShortlist(s)[0]?.projectId;
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
  const ents = discourseEntities(s);
  if (ents.length > 0) {
    const discussed = ents
      .filter((e) => e.roles.includes('discussed'))
      .sort((a, b) => a.firstSeenTurn - b.firstSeenTurn)
      .map((e) => ({ projectId: e.projectId, name: e.name }));
    if (discussed.length >= 2) return discussed;
    if (s.focus) return [{ projectId: s.focus.projectId, name: s.focus.projectName }];
    if (discussed.length === 1) return discussed;
    return discourseOffered(s);
  }
  const discussed = discussedList(s);
  if (discussed.length >= 2) return [...discussed];
  if (s.focus) return [{ projectId: s.focus.projectId, name: s.focus.projectName }];
  if (discussed.length === 1) return [...discussed];
  return [...currentShortlist(s)];
}

function say(prefix: string, sentence: string): string {
  return prefix === ''
    ? sentence.charAt(0).toUpperCase() + sentence.slice(1)
    : prefix + sentence.charAt(0).toLowerCase() + sentence.slice(1);
}

function totalStops(prior: VisitState): number {
  return (prior.projectId ? 1 : 0) + (prior.queued?.length ?? 0);
}

function looksLikeOriginAnswer(
  text: string,
  prior: VisitState,
  namedCount: number,
): boolean {
  if (prior.lastAsk !== 'origin') return false;
  if (isVisitProjectSwitchUtterance(text, namedCount)) return false;
  if (namedCount >= 1) return false; // named project while origin ask → switch/add, not locality
  const t = text.trim();
  if (!t || BARE_AFFIRM.test(t)) return false;
  if (parseVisitSlot(t, new Date()) || parseDayAnchor(t, new Date())) return false;
  if (isNonPlaceUtterance(t)) return false;
  const label = normalizeOriginText(t);
  if (!isPlausiblePlaceLabel(label)) return false;
  return t.length >= 3 && t.length <= 80;
}

/** Teach-first act; regex is abstain fallback unless embedActsOnly. */
function wantsAskTeam(text: string, embedKind?: string, embedActsOnly?: boolean): boolean {
  if (embedKind === 'visit_ask_team') return true;
  if (embedActsOnly) return false;
  // FALLBACK — closed cues when embedder abstains
  return /\b(?:ask|request|tell)\s+(?:the\s+)?(?:team|sales)\b|\b(?:team|sales)\s+(?:for|se)\b|\bafter\s+hours\b/i.test(
    text,
  );
}

/** Teach-first act; regex is abstain fallback unless embedActsOnly. */
function wantsForceSameDay(text: string, embedKind?: string, embedActsOnly?: boolean): boolean {
  if (embedKind === 'visit_force_same_day') return true;
  if (embedActsOnly) return false;
  // FALLBACK — closed cues when embedder abstains
  return FORCE_SAME_DAY_RE.test(text) || /\ball\s+same\s+day\b/i.test(text);
}

/** Teach-first itinerary act; closed same-day phrase is abstain fallback unless embedActsOnly. */
function wantsSameDay(text: string, embedKind?: string, embedActsOnly?: boolean): boolean {
  if (embedKind === 'visit_same_day') return true;
  if (embedKind === 'visit_force_same_day') return false;
  if (embedActsOnly) return false;
  return isSameDayPhrase(text);
}

/** Teach-first itinerary act; closed different-day phrase is abstain fallback unless embedActsOnly. */
function wantsOtherDay(text: string, embedKind?: string, embedActsOnly?: boolean): boolean {
  if (embedKind === 'visit_other_day') return true;
  if (embedActsOnly) return false;
  return isDifferentDayPhrase(text);
}

/** Same-day calendar anchor only when wantsSameDay fires (teach or phrase fallback). */
function sameDayAnchorIso(
  text: string,
  priorIso: string | null | undefined,
  embedKind?: string,
  embedActsOnly?: boolean,
): string | null {
  if (!priorIso || !wantsSameDay(text, embedKind, embedActsOnly)) return null;
  return resolveSameDayDate(text, priorIso) ?? priorIso.slice(0, 10);
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
  if (!m) return 'about 2 hours on site';
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
    `${formatDriveDuration(driveMin)} drive to *${projectName}*, ` +
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
  wantVisit?: boolean;
}): TurnGoal {
  const lastBooked = lastBookedVisit(input.booked);
  const isStop2Plus = !!lastBooked;
  const anchorDate = sameDayAnchorIso(
    input.text,
    lastBooked?.iso,
    input.ctx.embedderIntentKind,
    input.ctx.embedActsOnly,
  );
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

  // Team-request confirm (force same-day overflow)
  if (prior.awaitingTeamRequestConfirm && input.affirm && !DECLINE.test(input.text)) {
    const nextQueuedStop = prior.queued?.[0];
    if (prior.proposedIso && prior.projectId && prior.projectName) {
      return {
        kind: 'visit_booked',
        label: prior.proposedLabel ?? '',
        projectName: prior.projectName,
        projectId: prior.projectId,
        iso: prior.proposedIso,
        ...(nextQueuedStop
          ? {
              nextQueuedStop: {
                projectId: nextQueuedStop.projectId,
                projectName: nextQueuedStop.projectName,
              },
            }
          : {}),
      };
    }
  }

  // After-hours / exception: file pending team request (never firm-book).
  // Intent from teach (`visit_ask_team`) or closed fallback when embed abstains.
  if (
    projectId &&
    projectName &&
    wantsAskTeam(input.text, input.ctx.embedderIntentKind, input.ctx.embedActsOnly) &&
    (prior.lastAsk === 'time' ||
      prior.lastAsk === 'window' ||
      prior.lastAsk === 'team_request' ||
      !!prior.pendingDayIso)
  ) {
    const dayIso = prior.pendingDayIso ?? prior.proposedIso?.slice(0, 10) ?? isoTodayIst(input.now);
    const clock = extractVisitTime(input.text) ?? { hour: 18, minute: 0 };
    const label = `${prior.pendingDayLabel ?? extractDayWord(input.text) ?? 'Visit'} at ${formatVisitTimeLabel(clock.hour, clock.minute)}`;
    return {
      kind: 'visit_ask',
      ask: 'team_request',
      copy: say(
        prefix,
        `Noted — I've sent a request to the team for *${projectName}* ${label} (outside standard hours). ` +
          `We'll confirm on WhatsApp. This is not a firm booking yet.`,
      ),
      state: {
        ...prior,
        projectId,
        projectName,
        queued,
        awaitingConfirm: false,
        awaitingTeamRequestConfirm: false,
        lastAsk: 'team_request',
        askCount: askN,
        pendingDayIso: undefined,
        pendingDayLabel: undefined,
        pendingTeamRequests: [
          {
            projectId,
            projectName,
            preferredDateIso: dayIso,
            reason: 'outside_hours' as const,
          },
        ],
      },
    };
  }

  // Resolve which-projects chooser reply
  const chooserPool: OfferedProject[] = (prior.candidateIds ?? []).map((c) => ({
    projectId: c.projectId,
    name: c.projectName,
  }));
  if (prior.lastAsk === 'which_projects' && chooserPool.length > 0 && !projectId) {
    const pick = resolveWhichPick(input.text, chooserPool);
    if (pick.kind === 'all') {
      const applied = applyPickToQueue(chooserPool, MAX_VISIT_STOPS);
      if (applied) {
        projectId = applied.projectId;
        projectName = applied.projectName;
        queued = applied.queued;
        prefix = `${prefix}${visitChooserPlanPrefix(
          input.ctx.channel,
          chooserPool.length === 2 ? 'both' : 'all',
        )}`;
      }
    } else if (pick.kind === 'subset') {
      const applied = applyPickToQueue(pick.projects, MAX_VISIT_STOPS);
      if (applied) {
        projectId = applied.projectId;
        projectName = applied.projectName;
        queued = applied.queued;
      }
    } else {
      return {
        kind: 'visit_ask',
        ask: 'which_projects',
        copy: formatWhichChooserCopy(chooserPool),
        state: {
          ...prior,
          candidateIds: chooserPool.map((c) => ({ projectId: c.projectId, projectName: c.name })),
          askCount: askN,
          lastAsk: 'which_projects',
        },
      };
    }
  }

  // Split-day accept / force (embedder visit_force_same_day or closed fallback)
  if (prior.lastAsk === 'split_day' && prior.splitOffered) {
    if (wantsForceSameDay(input.text, input.ctx.embedderIntentKind, input.ctx.embedActsOnly)) {
      prior = { ...prior, preferredDayHint: 'same_forced', splitOffered: false };
    } else if (ACCEPT_SPLIT_RE.test(input.text) || BARE_AFFIRM.test(input.text.trim())) {
      prior = { ...prior, preferredDayHint: 'next', splitOffered: false };
      // Keep first stop(s) that fit — leave queue; day ask for active
    } else if (
      DECLINE.test(input.text) ||
      wantsOtherDay(input.text, input.ctx.embedderIntentKind, input.ctx.embedActsOnly)
    ) {
      prior = { ...prior, preferredDayHint: 'other', splitOffered: false };
    }
  } else if (wantsForceSameDay(input.text, input.ctx.embedderIntentKind, input.ctx.embedActsOnly)) {
    prior = { ...prior, preferredDayHint: 'same_forced' };
  } else if (
    wantsOtherDay(input.text, input.ctx.embedderIntentKind, input.ctx.embedActsOnly) &&
    !prior.preferredDayHint
  ) {
    prior = { ...prior, preferredDayHint: 'other' };
  }

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
  } else if (
    !projectId &&
    input.named.length === 0 &&
    input.candidates.length > 1 &&
    isAllDeixis(input.text)
  ) {
    // Explicit all/both/these only — never silent seed of whole discussed set
    const capped = input.candidates.slice(0, MAX_VISIT_STOPS);
    const [first, ...rest] = capped;
    projectId = first!.projectId;
    projectName = first!.name;
    queued = rest.map((p) => ({ projectId: p.projectId, projectName: p.name }));
  }

  const singleNamed = input.named.length === 1 ? input.named[0]! : null;
  if (singleNamed && projectId && singleNamed.projectId !== projectId) {
    const replaceStop =
      REPLACE_STOP_RE.test(input.text) ||
      INSTEAD_RE.test(input.text) ||
      // Packed "visit X on Monday at 11" while another propose is open = switch
      (!!slot && !ALSO_RE.test(input.text));
    if (ALSO_RE.test(input.text) && !replaceStop) {
      if (!queued.some((q) => q.projectId === singleNamed.projectId)) {
        queued = [...queued, { projectId: singleNamed.projectId, projectName: singleNamed.name }];
      }
      prefix = `We'll plan *${singleNamed.name}* as well — `;
    } else if (replaceStop) {
      projectId = singleNamed.projectId;
      projectName = singleNamed.name;
      queued = [];
      prior = {
        ...prior,
        awaitingConfirm: false,
        proposedIso: undefined,
        proposedLabel: undefined,
        slotText: undefined,
        pendingDayIso: undefined,
        pendingDayLabel: undefined,
        originText: undefined,
        originLat: undefined,
        originLng: undefined,
        originAsked: false,
        tripOrdered: false,
      };
    } else {
      const old = { projectId, projectName, queued, slotText: prior.slotText };
      const parkOld = !!old.projectId && !!old.slotText;
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

  // Which-projects chooser: ≥2 discussed, no selection yet (never auto-queue all)
  const needsChooser =
    !projectId &&
    input.named.length === 0 &&
    input.candidates.length >= 2 &&
    (input.wantVisit || prior.lastAsk === 'which_projects' || !prior.projectId);

  if (needsChooser && prior.lastAsk !== 'which_projects') {
    const pool = input.candidates.slice(0, MAX_VISIT_STOPS);
    return {
      kind: 'visit_ask',
      ask: 'which_projects',
      copy: formatWhichChooserCopy(pool),
      state: {
        ...prior,
        candidateIds: pool.map((c) => ({ projectId: c.projectId, projectName: c.name })),
        askCount: askN,
        lastAsk: 'which_projects',
      },
    };
  }

  const originFromText = extractOriginFromText(input.text);
  if (
    originFromText &&
    !prior.originText &&
    !isVisitProjectSwitchUtterance(input.text, input.named.length) &&
    isPlausiblePlaceLabel(originFromText)
  ) {
    prior = { ...prior, originText: originFromText, originAsked: true };
  } else if (looksLikeOriginAnswer(input.text, prior, input.named.length)) {
    prior = { ...prior, originText: normalizeOriginText(input.text), originAsked: true };
  } else if (
    prior.lastAsk === 'origin' &&
    !prior.originText &&
    input.named.length === 0 &&
    !BARE_AFFIRM.test(input.text.trim()) &&
    !parseVisitSlot(input.text, input.now) &&
    !parseDayAnchor(input.text, input.now) &&
    (isNonPlaceUtterance(input.text) || !isPlausiblePlaceLabel(normalizeOriginText(input.text)))
  ) {
    // Noise while origin outstanding — never stamp junk (VIS-MV-08 / V8 clarify).
    const smalltalk = /\b(?:why is|cricket|football|weather|joke|lol|lmao)\b/i.test(input.text);
    const clarify = smalltalk
      ? `I couldn't make sense of that for planning. I'm better on homes than that — still need your starting area so I can sequence the stops. Where will you be coming from that day?`
      : `I couldn't make sense of that. To plan your visits in order, I need a starting area — e.g. Indiranagar or Whitefield. Where will you be coming from?`;
    return {
      kind: 'visit_ask',
      ask: 'origin',
      copy: say(prefix, clarify),
      state: {
        ...prior,
        projectId,
        projectName,
        queued,
        askCount: askN,
        lastAsk: 'origin',
        originAsked: true,
      },
    };
  }

  const baseState: VisitState = { ...prior, projectId, projectName, queued };

  if (!projectId || !projectName) {
    if (input.candidates.length >= 2) {
      const pool = input.candidates.slice(0, MAX_VISIT_STOPS);
      return {
        kind: 'visit_ask',
        ask: 'which_projects',
        copy: formatWhichChooserCopy(pool),
        state: {
          ...baseState,
          candidateIds: pool.map((c) => ({ projectId: c.projectId, projectName: c.name })),
          askCount: askN,
          lastAsk: 'which_projects',
        },
      };
    }
    const copy = declined
      ? 'No problem — which project would you like to visit?'
      : 'Which project should I set up the visit for?';
    return { kind: 'visit_ask', ask: 'project', copy, state: { ...baseState, askCount: askN, lastAsk: 'project' } };
  }

  const stopCount = (projectId ? 1 : 0) + queued.length;

  // Origin mandatory for multi-stop until banked (including after first book)
  if (stopCount >= 2 && !prior.originText && !prior.originAsked) {
    return {
      kind: 'visit_ask',
      ask: 'origin',
      copy: say(
        prefix,
        visitOriginAskCopy(input.ctx.channel, stopCount),
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

  // Same-day feasibility → split warn (once) before scheduling
  if (
    stopCount >= 2 &&
    prior.tripOrdered &&
    !prior.splitOffered &&
    prior.preferredDayHint !== 'same_forced' &&
    prior.preferredDayHint !== 'next' &&
    prior.preferredDayHint !== 'other' &&
    !lastBooked
  ) {
    const hours = parseSiteVisitHours(input.ctx.siteVisitHours);
    const dayIso = dayAnchor?.dayIso ?? prior.pendingDayIso ?? isoTodayIst(input.now);
    const firstStart = `${dayIso}T10:30:00+05:30`;
    const packStops = [
      { projectId, projectName, driveInMin: 0 as number | null },
      ...queued.map((q, i) => ({
        projectId: q.projectId,
        projectName: q.projectName,
        driveInMin: i === 0 ? (input.ctx.driveFromPriorMin ?? null) : null,
      })),
    ];
    // Estimate unknown drives via haversine catalog when available
    const pack = packSameDay({
      dayIso,
      firstStartIso: firstStart,
      stops: packStops.map((s, i) => {
        if (i === 0) return s;
        if (s.driveInMin != null) return s;
        const prev = packStops[i - 1]!;
        const a = projectGeo(prev.projectId, input.ctx.projectGeoCatalog);
        const b = projectGeo(s.projectId, input.ctx.projectGeoCatalog);
        if (a && b) {
          const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
          return { ...s, driveInMin: Math.max(15, Math.round((km / 25) * 60)) };
        }
        return s;
      }),
      siteVisitHours: input.ctx.siteVisitHours,
    });
    if (pack.preferSplit && (pack.overflow.length > 0 || stopCount >= 3 || pack.preferSplitReason === 'long_drive')) {
      const fittingNames = pack.fitting.map((p) => p.projectName);
      const overflowNames =
        pack.overflow.length > 0
          ? pack.overflow.map((p) => p.projectName)
          : queued.slice(-1).map((q) => q.projectName);
      const day1Names =
        fittingNames.length > 0 ? fittingNames : [projectName, ...(queued[0] ? [queued[0].projectName] : [])];
      return {
        kind: 'visit_ask',
        ask: 'split_day',
        copy: say(
          prefix,
          splitDayCopy({
            fittingNames: day1Names.slice(0, Math.max(1, stopCount - 1)),
            overflowNames: overflowNames.length ? overflowNames : [queued[queued.length - 1]!.projectName],
            hoursLabel: hours.label,
            reason: pack.preferSplitReason,
          }).replace(/^\w/, (c) => c.toLowerCase()),
        ),
        state: {
          ...baseState,
          ...prior,
          projectId,
          projectName,
          queued,
          splitOffered: true,
          lastAsk: 'split_day',
          askCount: askN,
        },
      };
    }
  }

  const stopPreview =
    queued.length > 0 ? ` — then *${queued.map((q) => q.projectName).join('*, *')}*` : '';

  const explicitTime = hasExplicitTime(input.text);
  let fromStagger = false;

  const embedKind = input.ctx.embedderIntentKind;
  const embedActsOnly = input.ctx.embedActsOnly;

  if (isStop2Plus && lastBooked && prior.lastAsk === 'same_day_choice') {
    if (wantsOtherDay(input.text, embedKind, embedActsOnly)) {
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

  if (
    isStop2Plus &&
    isVisitFollowUpQuestion(input.text) &&
    !wantsSameDay(input.text, embedKind, embedActsOnly) &&
    !explicitTime
  ) {
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
    if (isStop2Plus && (wantsSameDay(input.text, embedKind, embedActsOnly) || anchorDate)) {
      const staggered = proposeStaggered(input.booked, dayAnchor, input.ctx);
      if (staggered) {
        slot = staggered;
        fromStagger = true;
      }
    } else if (!isStop2Plus && prior.preferredDayHint === 'same_forced') {
      // Force same-day path: default morning start so packSameDay + team overflow can run
      // (VIS-MV-04) — do not dead-end on morning/afternoon.
      slot = slotFromDayAndTime(dayAnchor, 10, 30);
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
    (wantsSameDay(input.text, embedKind, embedActsOnly) ||
      anchorDate ||
      (prior.lastAsk === 'same_day_choice' && BARE_AFFIRM.test(input.text.trim()))) &&
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
    const hoursLabel = parseSiteVisitHours(input.ctx.siteVisitHours).label;
    const copy = declined
      ? `No problem — which day and time work for *${projectName}*${stopPreview}? (Site visits usually ${hoursLabel}.)`
      : say(
          prefix,
          `which day and time work for your visit to *${projectName}*${stopPreview}? (e.g. Saturday morning, or Monday 11am — site visits usually ${hoursLabel})`,
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

  // Hours: start AND end (start+120) must be in window
  let proposeIso = parsed.proposedIso;
  let proposeLabel = parsed.humanLabel;
  const hoursCheck = checkSlotAgainstHours(proposeIso, VISIT_ON_SITE_MIN, input.ctx.siteVisitHours);
  if (!hoursCheck.ok) {
    const dayIso = proposeIso.slice(0, 10);
    const nearest = nearestInWindowStartIso(
      dayIso,
      hoursCheck.startMin ?? hoursCheck.openMin,
      VISIT_ON_SITE_MIN,
      input.ctx.siteVisitHours,
    );
    if (nearest && (input.affirm || !hasExplicitTime(input.text))) {
      // window defaults: snap to nearest silently into propose
      const h = parseInt(/T(\d{2}):(\d{2})/.exec(nearest)?.[1] ?? '10', 10);
      const m = parseInt(/T(\d{2}):(\d{2})/.exec(nearest)?.[2] ?? '30', 10);
      const fixed = slotFromDayAndTime(
        { dayIso, dayLabel: prior.pendingDayLabel ?? extractDayWord(proposeLabel) ?? 'Visit' },
        h,
        m,
      );
      if (fixed) {
        proposeIso = fixed.proposedIso;
        proposeLabel = fixed.humanLabel;
      }
    } else if (hasExplicitTime(input.text)) {
      const nearestLabel = nearest
        ? formatMinutesAsClock(minutesFromNearest(nearest))
        : formatMinutesAsClock(hoursCheck.latestStartMin);
      const startClock = formatMinutesAsClock(hoursCheck.startMin ?? 0);
      const endClock = formatMinutesAsClock(hoursCheck.endMin ?? 0);
      return {
        kind: 'visit_ask',
        ask: 'time',
        copy: say(
          prefix,
          `${startClock} would run until ${endClock} — past site hours (${hoursCheck.hoursLabel}). ` +
            `Closest I can do is ${nearestLabel} — OK, or another time? I can also ask the team if you need later.`,
        ),
        state: {
          ...baseState,
          ...prior,
          lastAsk: 'time',
          pendingDayIso: dayIso,
          pendingDayLabel: prior.pendingDayLabel ?? extractDayWord(proposeLabel) ?? undefined,
        },
      };
    }
  }

  // Same-day stagger that would end after close → team request path (don't propose illegal)
  if (fromStagger && lastBooked) {
    const staggerCheck = checkSlotAgainstHours(proposeIso, VISIT_ON_SITE_MIN, input.ctx.siteVisitHours);
    if (!staggerCheck.ok) {
      return {
        kind: 'visit_ask',
        ask: 'team_request',
        copy: say(
          prefix,
          `same day after *${lastBooked.projectName}* would land outside site hours (${staggerCheck.hoursLabel}). ` +
            `I can ask the team for a same-day exception for *${projectName}*, or we pick a different day — which do you prefer?`,
        ),
        state: {
          ...baseState,
          ...prior,
          projectId,
          projectName,
          queued,
          lastAsk: 'team_request',
          pendingTeamRequests: [
            ...(prior.pendingTeamRequests ?? []),
            {
              projectId,
              projectName,
              preferredDateIso: lastBooked.iso.slice(0, 10),
              reason: 'overpacked',
            },
          ],
        },
      };
    }
  }

  // Force same-day: file team requests for hours overflow OR long-drive tail
  // (split may have been preferSplit for distance with empty hours-overflow).
  let pendingTeam = prior.pendingTeamRequests;
  let awaitingTeam = prior.awaitingTeamRequestConfirm;
  if (prior.preferredDayHint === 'same_forced' && queued.length > 0 && !fromStagger) {
    const hours = parseSiteVisitHours(input.ctx.siteVisitHours);
    const pack = packSameDay({
      dayIso: proposeIso.slice(0, 10),
      firstStartIso: proposeIso,
      stops: [
        { projectId, projectName, driveInMin: 0 },
        ...queued.map((q) => ({
          projectId: q.projectId,
          projectName: q.projectName,
          driveInMin: input.ctx.driveFromPriorMin ?? 45,
        })),
      ],
      siteVisitHours: input.ctx.siteVisitHours,
    });
    let overflowStops = pack.overflow;
    // Long-drive / over-span split with no clock overflow — still don't firm the far tail.
    if (
      overflowStops.length === 0 &&
      pack.preferSplit &&
      (pack.preferSplitReason === 'long_drive' || pack.preferSplitReason === 'over_span') &&
      queued.length > 0
    ) {
      const tail = queued[queued.length - 1]!;
      overflowStops = [
        {
          projectId: tail.projectId,
          projectName: tail.projectName,
          startIso: proposeIso,
          endIso: proposeIso,
          fits: false,
        },
      ];
    }
    if (overflowStops.length > 0) {
      const overflowIds = new Set(overflowStops.map((o) => o.projectId));
      const fittingNames = [
        projectName,
        ...queued.filter((q) => !overflowIds.has(q.projectId)).map((q) => q.projectName),
      ];
      queued = queued.filter((q) => !overflowIds.has(q.projectId));
      pendingTeam = overflowStops.map((o) => ({
        projectId: o.projectId,
        projectName: o.projectName,
        preferredDateIso: proposeIso.slice(0, 10),
        reason: 'overpacked' as const,
      }));
      awaitingTeam = true;
      prefix = `${prefix}${forceSameDayPartialCopy({
        fittingNames: fittingNames.length ? fittingNames : pack.fitting.map((f) => f.projectName),
        overflowNames: overflowStops.map((o) => o.projectName),
        hoursLabel: hours.label,
      })} `;
    }
  }

  const driveMin = effectiveDriveMin(input.ctx);
  const driveNote =
    driveMin != null && lastBooked
      ? ` (${formatDriveDuration(driveMin)} drive from *${lastBooked.projectName}*)`
      : '';
  const queuedNote =
    queued.length > 0
      ? ` After this we'll plan *${queued[0]!.projectName}*${queued.length > 1 ? ` and ${queued.length - 1} more` : ''}.`
      : pendingTeam?.length
        ? ` *${pendingTeam.map((t) => t.projectName).join('*, *')}* will be a team request (pending).`
        : '';

  const copy =
    fromStagger && lastBooked && driveMin != null
      ? buildStaggerProposeCopy(lastBooked, projectName, proposeLabel, driveMin, prefix)
      : awaitingTeam
        ? visitForceTeamConfirmCopy({
            channel: input.ctx.channel,
            prefix,
            proposeLabel,
            projectName,
          })
        : visitProposeConfirmCopy({
            channel: input.ctx.channel,
            label: proposeLabel,
            projectName,
            driveNote,
            queuedNote,
            prefix,
          });

  return {
    kind: 'visit_propose',
    iso: proposeIso,
    label: proposeLabel,
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
      awaitingTeamRequestConfirm: awaitingTeam,
      pendingTeamRequests: pendingTeam,
      proposedIso: proposeIso,
      proposedLabel: proposeLabel,
      slotText: input.text,
      lastAsk: fromStagger ? 'stagger_propose' : awaitingTeam ? 'team_request' : 'time',
      pendingDayIso: undefined,
      pendingDayLabel: undefined,
    },
  };
}

function isoTodayIst(now: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now);
}

function minutesFromNearest(iso: string): number {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return 10 * 60 + 30;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
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
