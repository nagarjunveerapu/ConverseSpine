import type {
  ConstraintAuthority,
  ConstraintAuthorityKey,
  ThreadState,
  Constraints,
  DiscoverState,
  Extracted,
  Match,
  OfferedProject,
} from './types.js';
import {
  clearOfferedExcept,
  currentShortlist,
  pushFocus,
  recordEntities,
  stripLegacyMirrors,
} from './entity-store.js';

export function initState(threadId: string, builderId: string): ThreadState {
  return {
    threadId,
    builderId,
    phase: 'discover',
    constraints: {},
    discover: emptyDiscover(),
    turnCount: 0,
  };
}

/** WhatsApp test soak: wipe session without a second phone. */
export function isSessionResetText(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return t === '/reset' || t === '/start' || t === 'start over' || t === 'new chat';
}

/** Keep conversation + Desk ids; drop focus, brief, visit, returning-buyer. */
export function freshSession(s: ThreadState): ThreadState {
  const next = initState(s.threadId, s.builderId);
  return {
    ...next,
    ...(s.ndThreadId ? { ndThreadId: s.ndThreadId } : {}),
    ...(s.ndBuyerPhone ? { ndBuyerPhone: s.ndBuyerPhone } : {}),
  };
}

export function emptyDiscover(): DiscoverState {
  return {
    asked: [],
    rejectedProjectIds: [],
    lastOffered: [],
    oriented: false,
    ignoredProbes: 0,
    advancedOnce: false,
  };
}

export function withNdThread(
  s: ThreadState,
  ndThreadId: string,
  buyerPhone: string,
): ThreadState {
  return { ...s, ndThreadId, ndBuyerPhone: buyerPhone };
}

export function incObjection(s: ThreadState): ThreadState {
  return { ...s, objectionCount: (s.objectionCount ?? 0) + 1 };
}

export function applyVisitBooked(
  s: ThreadState,
  explicitNext?: { projectId: string; projectName: string; slotText?: string },
): ThreadState {
  const queued = s.visit?.queued ?? [];
  const next = queued[0] ?? explicitNext;
  const prev = s.visit ?? {};
  const carry = {
    ...(prev.originText ? { originText: prev.originText } : {}),
    ...(prev.originLat != null ? { originLat: prev.originLat } : {}),
    ...(prev.originLng != null ? { originLng: prev.originLng } : {}),
    ...(prev.originAsked ? { originAsked: prev.originAsked } : {}),
    ...(prev.tripOrdered ? { tripOrdered: prev.tripOrdered } : {}),
    ...(prev.preferredDayHint ? { preferredDayHint: prev.preferredDayHint } : {}),
    ...(prev.pendingTeamRequests?.length
      ? { pendingTeamRequests: prev.pendingTeamRequests }
      : {}),
  };
  if (next) {
    const rest = queued.length > 0 ? queued.slice(1) : [];
    const lastAsk =
      prev.preferredDayHint === 'next' || prev.preferredDayHint === 'other'
        ? ('day' as const)
        : ('same_day_choice' as const);
    return {
      ...s,
      phase: 'visit',
      visit: {
        projectId: next.projectId,
        projectName: next.projectName,
        ...(next.slotText ? { slotText: next.slotText } : {}),
        ...(rest.length ? { queued: rest } : {}),
        lastAsk,
        ...carry,
      },
    };
  }
  // Firm queue empty but team requests remain — stay in visit with pending note
  if (prev.pendingTeamRequests?.length) {
    return {
      ...s,
      phase: 'visit',
      visit: {
        lastAsk: 'team_request',
        ...carry,
        pendingTeamRequests: prev.pendingTeamRequests,
      },
    };
  }
  const { visit: _v, ...rest } = s;
  // Advisor / board visit often books with visit.projectId set but focus unset
  // (chooser / propose_visit). Without a pin, sticky handoff traps "2BHK" etc.
  const focus =
    s.focus ??
    (prev.projectId && prev.projectName
      ? { projectId: prev.projectId, projectName: prev.projectName }
      : undefined);
  if (focus) {
    return {
      ...rest,
      phase: 'focused',
      focus,
      postVisitAckPending: true,
      // `visit` is cleared by design, but the FACT of the booking has to outlive
      // the turn — otherwise the next visit-shaped question starts from zero.
      lastBookedProjectId: focus.projectId,
      visitRebookOffered: false,
    };
  }
  return { ...rest, phase: 'handoff' };
}

export function applyExtracted(
  s: ThreadState,
  ex: Extracted,
  skipKeys?: ReadonlySet<'bhk' | 'location' | 'propertyType' | 'budget'>,
  options?: {
    locationValidated?: boolean;
    authority?: Partial<Record<ConstraintAuthorityKey, ConstraintAuthority>>;
  },
): ThreadState {
  const incoming = pruneUndefined(ex.constraints);
  if (skipKeys?.has('bhk')) delete incoming.bhk;
  if (skipKeys?.has('location')) delete incoming.location;
  if (skipKeys?.has('propertyType')) delete incoming.propertyType;
  if (skipKeys?.has('budget')) {
    delete incoming.budgetMaxInr;
    delete incoming.budgetMinInr;
  }
  if (incoming.location && !options?.locationValidated && !isPlausibleLocation(incoming.location)) {
    delete incoming.location;
  }
  if (incoming.location && s.constraints.location) {
    const prev = s.constraints.location.trim().toLowerCase();
    const next = incoming.location.trim().toLowerCase();
    if (prev === next) {
      delete incoming.location;
    } else if (next.length <= prev.length && prev.includes(next)) {
      // Buyer named a sub-area we already cover — keep the more specific constraint.
      delete incoming.location;
    }
    // Lateral move (e.g. Whitefield while focused on Devanahalli) — allow replace.
  }
  if (incoming.propertyType && s.constraints.propertyType) {
    const prevLen = s.constraints.propertyType.length;
    if (incoming.propertyType.length < prevLen) delete incoming.propertyType;
  }
  const constraints: Constraints = { ...s.constraints, ...incoming };
  if (skipKeys?.has('bhk')) delete constraints.bhk;
  if (skipKeys?.has('location')) delete constraints.location;
  if (skipKeys?.has('propertyType')) delete constraints.propertyType;
  if (skipKeys?.has('budget')) {
    delete constraints.budgetMaxInr;
    delete constraints.budgetMinInr;
  }
  const buyerName = ex.nameIntro ?? s.buyerName;
  const constraintAuthority = { ...(s.constraintAuthority ?? {}) };
  if (incoming.location && options?.authority?.location) {
    constraintAuthority.location = options.authority.location;
  }
  if (incoming.propertyType && options?.authority?.propertyType) {
    constraintAuthority.propertyType = options.authority.propertyType;
  }
  if (incoming.bhk && options?.authority?.bhk) {
    constraintAuthority.bhk = options.authority.bhk;
  }
  if (
    (incoming.budgetMaxInr !== undefined || incoming.budgetMinInr !== undefined) &&
    options?.authority?.budget
  ) {
    constraintAuthority.budget = options.authority.budget;
  }
  for (const key of skipKeys ?? []) delete constraintAuthority[key];

  let rejected = s.discover.rejectedProjectIds;
  if (ex.rejected) {
    const hit = resolveRejected(ex, currentShortlist(s));
    if (hit && !rejected.includes(hit)) rejected = [...rejected, hit];
  }

  return {
    ...s,
    ...(buyerName ? { buyerName } : {}),
    constraints,
    constraintAuthority,
    // The latest monthly figure wins; an older one is never erased by a turn
    // that simply didn't mention money.
    ...(ex.affordability ? { affordability: ex.affordability } : {}),
    discover: { ...s.discover, rejectedProjectIds: rejected },
  };
}

function resolveRejected(ex: Extracted, offered: readonly OfferedProject[]): string | null {
  if (ex.rejectedName) {
    const n = ex.rejectedName.toLowerCase();
    const hit = offered.find((o) => o.name.toLowerCase().includes(n));
    if (hit) return hit.projectId;
  }
  return null;
}

export function resolvePick(
  ex: Extracted,
  offered: readonly OfferedProject[],
  s?: ThreadState,
): OfferedProject | null {
  if (typeof ex.pickOrdinal === 'number' && ex.pickOrdinal >= 1 && ex.pickOrdinal <= offered.length) {
    return offered[ex.pickOrdinal - 1] ?? null;
  }
  const named = ex.namedProjects;
  if (named && named.length >= 1) {
    const n = named[0];
    if (!n) return null;
    return offered.find((o) => o.projectId === n.projectId) ?? n;
  }
  if (ex.pickName) {
    const n = ex.pickName.toLowerCase();
    return offered.find((o) => o.name.toLowerCase().includes(n)) ?? null;
  }
  if ((ex.implicitProjectPick || ex.transition === 'want_details') && offered.length === 1) {
    return offered[0] ?? null;
  }
  if (ex.implicitProjectPick && s?.focus) {
    return { projectId: s.focus.projectId, name: s.focus.projectName };
  }
  if (ex.transition === 'want_details' && s?.focus) {
    return { projectId: s.focus.projectId, name: s.focus.projectName };
  }
  if (ex.affirm && offered.length === 1) {
    if (s?.rti?.pendingPrompt?.kind === 'offer_project') return offered[0] ?? null;
    return null;
  }
  return null;
}

export function recordOffered(s: ThreadState, matches: readonly Match[]): ThreadState {
  if (matches.length === 0) return s;
  const keep = new Set(matches.map((m) => m.projectId));
  // Phase 1c — store is authority: clear stale offered roles, write card payload,
  // set shortlistIds. Legacy lastOffered is revive-only (not mirrored).
  const cleared = clearOfferedExcept(s, keep);
  const withEntities = recordEntities(
    cleared,
    matches.map((m, i) => ({
      projectId: m.projectId,
      name: m.name,
      ...(m.microMarket ? { microMarket: m.microMarket } : {}),
      startingPriceDisplay: m.startingPriceDisplay,
      ...(m.startingPriceInr > 0 ? { startingPriceInr: m.startingPriceInr } : {}),
      ...(m.tradeoffNote ? { tradeoffNote: m.tradeoffNote } : {}),
      ...(m.dimensionFit ? { dimensionFit: m.dimensionFit } : {}),
      ...(m.dimensionGap ? { dimensionGap: m.dimensionGap } : {}),
      offeredRank: i,
    })),
    'offered',
    s.turnCount,
  );
  return stripLegacyMirrors({
    ...withEntities,
    shortlistIds: matches.map((m) => m.projectId),
    discover: { ...withEntities.discover, ignoredProbes: 0 },
  });
}

/** Drop stale shortlist — next successful recommend repopulates (W2). */
export function clearLastOffered(s: ThreadState): ThreadState {
  if ((s.shortlistIds?.length ?? 0) === 0 && currentShortlist(s).length === 0) return s;
  const cleared = clearOfferedExcept(s, new Set());
  return stripLegacyMirrors({
    ...cleared,
    shortlistIds: [],
    discover: { ...cleared.discover, ignoredProbes: cleared.discover.ignoredProbes },
  });
}

/**
 * One-shot revive: pre-1c KV with only `lastOffered` → shortlistIds + entities.
 * When the store already has authority, strip stale mirrors so they cannot poison.
 */
export function hydrateLegacyDiscourse(s: ThreadState): ThreadState {
  if ((s.shortlistIds?.length ?? 0) > 0) return stripLegacyMirrors(s);
  const legacy = s.discover.lastOffered ?? [];
  if (!legacy.length) return stripLegacyMirrors(s);
  const matches: Match[] = legacy.map((o) => ({
    projectId: o.projectId,
    name: o.name,
    microMarket: o.microMarket ?? '',
    startingPriceInr: o.startingPriceInr ?? 0,
    startingPriceDisplay: o.startingPriceDisplay ?? '',
    matchReasons: [],
    ...(o.tradeoffNote ? { tradeoffNote: o.tradeoffNote } : {}),
  }));
  return recordOffered(
    { ...s, discover: { ...s.discover, lastOffered: [] } },
    matches,
  );
}

/** True when search-shaping constraints changed (not purpose/name). No locality hardcode. */
export function constraintsMateriallyChanged(prev: Constraints, next: Constraints): boolean {
  const norm = (v: string | undefined) => (v ?? '').trim().toLowerCase();
  return (
    norm(prev.location) !== norm(next.location) ||
    prev.bhk !== next.bhk ||
    prev.budgetMaxInr !== next.budgetMaxInr ||
    prev.budgetMinInr !== next.budgetMinInr ||
    norm(prev.propertyType) !== norm(next.propertyType)
  );
}

export function appendTranscript(
  s: ThreadState,
  buyerText: string,
  botReply: string,
  atMs: number,
): ThreadState {
  const prev = s.discover.recentMessages ?? [];
  const next = [
    ...prev,
    { text: buyerText, role: 'buyer' as const, atMs },
    { text: botReply, role: 'bot' as const, atMs: atMs + 1 },
  ].slice(-12);
  return { ...s, discover: { ...s.discover, recentMessages: next } };
}

export function markOriented(s: ThreadState): ThreadState {
  return { ...s, discover: { ...s.discover, oriented: true } };
}

export function markAsked(s: ThreadState, slot: DiscoverState['asked'][number]): ThreadState {
  const asked = s.discover.asked.includes(slot) ? s.discover.asked : [...s.discover.asked, slot];
  return { ...s, discover: { ...s.discover, asked, ignoredProbes: s.discover.ignoredProbes + 1 } };
}

export function recordDiscussed(
  s: ThreadState,
  projects: ReadonlyArray<OfferedProject>,
): ThreadState {
  if (projects.length === 0) return s;
  // Phase 1c — store is uncapped authority; no legacy mirror write-through.
  return stripLegacyMirrors(
    recordEntities(
      s,
      projects.filter((p) => p.projectId && p.name).map((p) => ({ projectId: p.projectId, name: p.name })),
      'discussed',
      s.turnCount,
    ),
  );
}

export function commitTo(s: ThreadState, projectId: string, projectName: string): ThreadState {
  const clearUnit = s.focusUnit && s.focusUnit.projectId !== projectId;
  const base = clearUnit ? (({ focusUnit: _u, ...rest }) => rest)(s) : s;
  const discussed = recordDiscussed(
    { ...base, phase: 'focused', focus: { projectId, projectName } },
    [{ projectId, name: projectName }],
  );
  // Phase 1a dual-write: focus becomes a STACK entry, so a later turn can pop
  // back. `focus` stays the single source of truth until 1b.
  return pushFocus(discussed, projectId, s.turnCount);
}

export function releaseToDiscover(s: ThreadState): ThreadState {
  const focus = s.focus;
  const withDiscussed = focus
    ? recordDiscussed(s, [{ projectId: focus.projectId, name: focus.projectName }])
    : s;
  const { focus: _f, ...rest } = withDiscussed;
  // Dual-write: focusStack[0] means "current focus". Clear it with legacy focus
  // so focusedEntity / salience do not keep a released project as #1.
  return { ...rest, phase: 'discover', focusStack: [] };
}

export function isSameAsLast(s: ThreadState, matches: readonly Match[]): boolean {
  const prev = currentShortlist(s);
  if (prev.length === 0 || prev.length !== matches.length) return false;
  return prev.every((p, i) => p.projectId === matches[i]?.projectId);
}

function pruneUndefined(c: Partial<Constraints>): Partial<Constraints> {
  const out: Partial<Constraints> = {};
  if (c.budgetMaxInr !== undefined) out.budgetMaxInr = c.budgetMaxInr;
  if (c.budgetMinInr !== undefined) out.budgetMinInr = c.budgetMinInr;
  if (c.bhk !== undefined) out.bhk = c.bhk;
  if (c.location !== undefined) out.location = c.location;
  if (c.propertyType !== undefined) out.propertyType = c.propertyType;
  if (c.purpose !== undefined) out.purpose = c.purpose;
  if (c.nearAirport !== undefined) out.nearAirport = c.nearAirport;
  if (c.readyToMove !== undefined) out.readyToMove = c.readyToMove;
  // Trade-off Advisor soft signals — a missing line here silently drops the
  // field at the extract→state boundary (this bit priorityFocus once).
  if (c.commuteHub !== undefined) out.commuteHub = c.commuteHub;
  if (c.priorityFocus !== undefined) out.priorityFocus = c.priorityFocus;
  if (c.schoolsMentioned !== undefined) out.schoolsMentioned = c.schoolsMentioned;
  if (c.worries !== undefined) out.worries = c.worries;
  if (c.walkabilityMentioned !== undefined) out.walkabilityMentioned = c.walkabilityMentioned;
  if (c.valueMentioned !== undefined) out.valueMentioned = c.valueMentioned;
  return out;
}

import { isAdvisorBriefChipPhrase } from './advisor-brief-chips.js';
import { extractDayWord } from './visit-slot.js';

function isPlausibleLocation(loc: string): boolean {
  const lc = loc.toLowerCase().trim();
  if (!lc || lc.length < 3) return false;
  if (extractDayWord(lc)) return false;
  if (isAdvisorBriefChipPhrase(loc)) return false;
  if (/\bback\s+to\b/.test(lc)) return false;
  if (/\b(?:switch\s+to|instead|what\s+about|tell\s+me\s+about)\b/.test(lc)) return false;
  if (/\b(compare|both|projects|options|show|visit|pricing|legal|plantation|properties|property|homes|flats|apartments|investment|preservation|appreciation|diversification|rental|breakdown|costs?|details?|emi|overview|amenities|availability|brochure|about|tell)\b/.test(lc)) {
    return false;
  }
  // Regex pollution: "North Bangalore under 1.5 Cr" must not stick as a locality.
  if (
    /\b(?:under|below|above|budget|crore|crs?\b|lakh|lakhs|lacs?|\d+\s*(?:cr|l)\b|\d(?:\.\d)?\s*bhk)\b/i.test(
      lc,
    )
  ) {
    return false;
  }
  if (lc.split(/\s+/).length > 8) return false;
  return true;
}
