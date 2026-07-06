import type { ConversationState, Constraints, DiscoverState, Extracted, Match, OfferedProject } from './types.js';

export function initState(convId: string, builderId: string): ConversationState {
  return {
    convId,
    builderId,
    phase: 'discover',
    constraints: {},
    discover: emptyDiscover(),
    turnCount: 0,
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

export function withNdConversation(
  s: ConversationState,
  ndConversationId: string,
  buyerPhone: string,
): ConversationState {
  return { ...s, ndConversationId, ndBuyerPhone: buyerPhone };
}

export function incObjection(s: ConversationState): ConversationState {
  return { ...s, objectionCount: (s.objectionCount ?? 0) + 1 };
}

export function applyVisitBooked(s: ConversationState): ConversationState {
  const queued = s.visit?.queued ?? [];
  if (queued.length > 0) {
    const [next, ...rest] = queued;
    return {
      ...s,
      phase: 'visit',
      visit: {
        projectId: next!.projectId,
        projectName: next!.projectName,
        ...(next!.slotText ? { slotText: next!.slotText } : {}),
        ...(rest.length ? { queued: rest } : {}),
      },
    };
  }
  const { visit: _v, ...rest } = s;
  if (s.focus) {
    return { ...rest, phase: 'focused', postVisitAckPending: true };
  }
  return { ...rest, phase: 'handoff' };
}

export function applyExtracted(
  s: ConversationState,
  ex: Extracted,
  skipKeys?: ReadonlySet<'bhk' | 'location' | 'propertyType' | 'budget'>,
): ConversationState {
  const incoming = pruneUndefined(ex.constraints);
  if (skipKeys?.has('bhk')) delete incoming.bhk;
  if (skipKeys?.has('location')) delete incoming.location;
  if (skipKeys?.has('propertyType')) delete incoming.propertyType;
  if (skipKeys?.has('budget')) {
    delete incoming.budgetMaxInr;
    delete incoming.budgetMinInr;
  }
  if (incoming.location && !isPlausibleLocation(incoming.location)) {
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

  let rejected = s.discover.rejectedProjectIds;
  if (ex.rejected) {
    const hit = resolveRejected(ex, s.discover.lastOffered);
    if (hit && !rejected.includes(hit)) rejected = [...rejected, hit];
  }

  return {
    ...s,
    ...(buyerName ? { buyerName } : {}),
    constraints,
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
  s?: ConversationState,
): OfferedProject | null {
  if (typeof ex.pickOrdinal === 'number' && ex.pickOrdinal >= 1 && ex.pickOrdinal <= offered.length) {
    return offered[ex.pickOrdinal - 1] ?? null;
  }
  if (ex.pickName) {
    const n = ex.pickName.toLowerCase();
    return offered.find((o) => o.name.toLowerCase().includes(n)) ?? null;
  }
  if ((ex.implicitProjectPick || ex.transition === 'want_details') && offered.length === 1) {
    return offered[0] ?? null;
  }
  if (ex.affirm && offered.length === 1) {
    if (s?.rti?.pendingPrompt?.kind === 'offer_project') return offered[0] ?? null;
    return null;
  }
  return null;
}

export function recordOffered(s: ConversationState, matches: readonly Match[]): ConversationState {
  if (matches.length === 0) return s;
  const lastOffered = matches.map((m) => ({
    projectId: m.projectId,
    name: m.name,
    microMarket: m.microMarket,
    startingPriceDisplay: m.startingPriceDisplay,
  }));
  return { ...s, discover: { ...s.discover, lastOffered, ignoredProbes: 0 } };
}

export function appendTranscript(
  s: ConversationState,
  buyerText: string,
  botReply: string,
  atMs: number,
): ConversationState {
  const prev = s.discover.recentMessages ?? [];
  const next = [
    ...prev,
    { text: buyerText, role: 'buyer' as const, atMs },
    { text: botReply, role: 'bot' as const, atMs: atMs + 1 },
  ].slice(-12);
  return { ...s, discover: { ...s.discover, recentMessages: next } };
}

export function markOriented(s: ConversationState): ConversationState {
  return { ...s, discover: { ...s.discover, oriented: true } };
}

export function markAsked(s: ConversationState, slot: DiscoverState['asked'][number]): ConversationState {
  const asked = s.discover.asked.includes(slot) ? s.discover.asked : [...s.discover.asked, slot];
  return { ...s, discover: { ...s.discover, asked, ignoredProbes: s.discover.ignoredProbes + 1 } };
}

export function commitTo(s: ConversationState, projectId: string, projectName: string): ConversationState {
  return { ...s, phase: 'focused', focus: { projectId, projectName } };
}

export function releaseToDiscover(s: ConversationState): ConversationState {
  const { focus: _f, ...rest } = s;
  return { ...rest, phase: 'discover' };
}

export function isSameAsLast(s: ConversationState, matches: readonly Match[]): boolean {
  const prev = s.discover.lastOffered;
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
  return out;
}

import { isAdvisorBriefChipPhrase } from './advisor-brief-chips.js';

function isPlausibleLocation(loc: string): boolean {
  const lc = loc.toLowerCase().trim();
  if (!lc || lc.length < 3) return false;
  if (isAdvisorBriefChipPhrase(loc)) return false;
  if (/\b(compare|both|projects|options|show|visit|pricing|legal|plantation|properties|property|homes|flats|apartments|investment|preservation|appreciation|diversification|rental)\b/.test(lc)) {
    return false;
  }
  if (lc.split(/\s+/).length > 8) return false;
  return true;
}
