import type { CatalogEnvelope, Constraints, ConversationState, EvidenceSet, Extracted, Match, ProbeKind, SearchFilters, TurnGoal } from '../types.js';
import { nameMentioned } from '../project_references.js';
import { resolvePick } from '../state.js';
import { formatInr } from '../compose.js';

export function decide(s: ConversationState, ex: Extracted): TurnGoal {
  const d = s.discover;
  if (ex.recall) return { kind: 'visit_recall' };

  // Explicit name is authoritative. A single PROJECT_VECTORS hit (≥0.65, and
  // already gated against pure search/location/budget noise upstream) means the
  // buyer NAMED this project. That is a pick, not a filter adjustment — it must
  // beat the recovery/refinement search-belt below (forceRecommendList /
  // freshSearchBoard), which would otherwise turn "Ayana" after a vague brief
  // ("green near the hills") into a no_fit search. Compare/visit/details and
  // "show me more" keep their own downstream paths.
  if (
    (ex.namedProjects?.length ?? 0) === 1 &&
    ex.speechAct !== 'search' &&
    ex.transition !== 'want_visit' &&
    ex.transition !== 'want_details' &&
    ex.askTopic !== 'compare' &&
    !ex.compareAdvice &&
    !ex.wantsMore &&
    !ex.rejected
  ) {
    const namedPick = resolvePick(ex, d.lastOffered, s);
    if (namedPick) return commitPickWithFollowUp(namedPick, ex);
  }

  // Fresh search board: narrowing + empty shortlist beats embedder compare/visit noise.
  const freshSearchBoard =
    d.lastOffered.length === 0 &&
    !s.focus &&
    (hasNarrowingConstraint(s.constraints) || hasNarrowingConstraint(ex.constraints));
  if (
    freshSearchBoard &&
    (ex.speechAct === 'search' ||
      ex.speechAct === 'visit_book' ||
      ex.transition === 'want_visit' ||
      ex.forceRecommendList)
  ) {
    return { kind: 'recommend' };
  }

  if (
    (ex.budgetPickQuestion || ex.compareAdvice) &&
    d.lastOffered.length >= 2 &&
    !ex.wantsMore &&
    !ex.rejected
  ) {
    return { kind: 'answer', topic: 'compare', projectId: d.lastOffered[0]!.projectId };
  }

  // Compare before pick — "compare ayana and krishnaja" must not commit to Ayana.
  if (ex.askTopic === 'compare' && (ex.compareProjectIds?.length ?? 0) >= 2) {
    return { kind: 'answer', topic: 'compare', projectId: ex.compareProjectIds![0]! };
  }
  // "Ayana and Krishnaja" / correction after wrong compare — two named projects → compare.
  if ((ex.namedProjects?.length ?? 0) >= 2 && !ex.transition) {
    return {
      kind: 'answer',
      topic: 'compare',
      projectId: ex.namedProjects![0]!.projectId,
    };
  }

  // Details ask: commit only when pick is unambiguous (named/ordinal or singleton).
  // Multi shortlist without a name → answer the facet across the shortlist when
  // one was asked; only a topicless "tell me more" earns the pick-menu.
  if (ex.implicitProjectPick || ex.transition === 'want_details') {
    const explicit = resolvePick(ex, d.lastOffered, s);
    if (explicit) return commitPickWithFollowUp(explicit, ex);
    if (d.lastOffered.length === 1) {
      return commitPickWithFollowUp(d.lastOffered[0]!, ex);
    }
    if (d.lastOffered.length >= 2) {
      const across = shortlistAnswerGoal(s, ex);
      if (across) return across;
      return { kind: 'clarify_project_pick' };
    }
  }

  // LOC-G01 belt: search + narrowing constraints must recommend, not commit on
  // hallucinated PROJECT_VECTORS identity (empty shortlist / off-shortlist pick).
  if (ex.speechAct === 'search' && hasNarrowingConstraint(s.constraints)) {
    return { kind: 'recommend' };
  }

  const pick = resolvePick(ex, d.lastOffered, s);
  if (pick) return commitPickWithFollowUp(pick, ex);

  if (d.lastOffered.length > 0) {
    const detailGoal = offeredDetailGoal(s, ex);
    if (detailGoal) return detailGoal;
  }

  // P2 multi-act: search brief + visit on empty board → shortlist first.
  // Embedder namedProjects must not invent a visit/compare board here.
  if (ex.transition === 'want_visit' || ex.speechAct === 'visit_book') {
    const narrowing =
      hasNarrowingConstraint(s.constraints) || hasNarrowingConstraint(ex.constraints);
    if (narrowing && d.lastOffered.length === 0 && !s.focus) {
      return { kind: 'recommend' };
    }
    if (!(ex.namedProjects?.length)) {
      return narrowing ? { kind: 'recommend' } : { kind: 'propose_visit' };
    }
  }
  if (ex.objection) return { kind: 'objection', topic: ex.objectionTopic ?? 'custom' };

  if (ex.rejected && hasNarrowingConstraint(s.constraints)) return { kind: 'ack_reject_recommend' };
  if (ex.wantsMore) return { kind: 'recommend' };
  // P2: search + media/facet without a pick → recommend board (not clarify).
  if (
    hasNarrowingConstraint(s.constraints) &&
    ((ex.askTopics ?? []).some((t) => t === 'media' || t === 'price' || t === 'legal') ||
      ex.askTopic === 'media' ||
      ex.askTopic === 'price')
  ) {
    return { kind: 'recommend' };
  }
  if (hasNarrowingConstraint(s.constraints)) return { kind: 'recommend' };

  // Below-threshold guard. Everything above failed to route this turn, so the
  // engine does NOT understand the ask. The remaining fallbacks (greet, orient)
  // have generative compose contracts — reaching them with a real question is
  // what produced "Hey there! 👋 Welcome to Naya Advisor" for "is my money safe
  // with this builder?", and a portfolio pitch plus an invented "great choice
  // going for an investment property" on the turn after. Ask instead of guess.
  //
  // Smalltalk still wins: "hi there" is understood, not a miss. A question we
  // DID route (askTopic/askTopics) never reaches here.
  if (ex.isQuestion && !ex.smalltalk && !ex.askTopic && !(ex.askTopics?.length)) {
    return { kind: 'clarify_intent' };
  }
  if (s.turnCount === 0) return { kind: 'greet' };
  if (ex.smalltalk) return { kind: 'smalltalk' };
  if (!d.oriented) return { kind: 'orient' };
  if (firstMissingSlot(s) === undefined || d.ignoredProbes >= 3) return { kind: 'recommend' };
  return { kind: 'probe', slot: nextSlot(s) };
}

export function searchFilters(c: Constraints): SearchFilters {
  const config = configurationFilter(c);
  return {
    ...(c.budgetMaxInr !== undefined ? { budgetMaxInr: c.budgetMaxInr } : {}),
    ...(c.budgetMinInr !== undefined ? { budgetMinInr: c.budgetMinInr } : {}),
    ...(config ? { bhks: config } : {}),
    ...(c.location?.trim() ? { locations: c.location.trim() } : {}),
    ...(c.propertyType ? { projectTypes: mapProjectTypesForSearch(c.propertyType) } : {}),
    ...(c.purpose ? { purpose: c.purpose } : {}),
    // nearAirport / readyToMove stay on Constraints for provenance + compose —
    // do NOT invent locality tokens or stuff free-text into Desk search_text.
    maxResults: 3,
  };
}

function configurationFilter(c: Constraints): string | undefined {
  if (!c.bhk) return undefined;
  return c.bhk;
}

/** Map buyer words to NayaDesk project_type slugs (supports multiple via comma or "or"). */
export function mapProjectTypesForSearch(raw: string): string {
  const slugs = new Set<string>();
  for (const part of raw.split(/,|\s+or\s+/i)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    for (const slug of mapSingleProjectType(trimmed)) slugs.add(slug);
  }
  return [...slugs].join(',');
}

function mapSingleProjectType(label: string): string[] {
  const s = label.toLowerCase();
  if (s.includes('apartment') || s.includes('flat')) return ['apartment'];
  if (s.includes('villa')) return ['villa', 'managed_villa_resort'];
  if (s.includes('plantation') || s.includes('planted') || s.includes('estate')) {
    return ['managed_plantation_estate'];
  }
  if (s.includes('plot') || s.includes('land') || s.includes('plotted')) return ['plot', 'plotted'];
  if (s === 'apartment') return ['apartment'];
  if (s === 'villa') return ['villa', 'managed_villa_resort'];
  if (s === 'plot') return ['plot', 'plotted'];
  if (s === 'plantation') return ['managed_plantation_estate'];
  return [label];
}

/** @deprecated use mapProjectTypesForSearch */
function mapProjectTypeForSearch(raw: string): string {
  return mapProjectTypesForSearch(raw);
}

export function resolveRecommend(
  base: TurnGoal,
  matches: Match[],
  catalog: CatalogEnvelope,
  c: Constraints,
  rejectedIds: readonly string[],
  noMatchReasoning?: string,
): { goal: TurnGoal; evidence: EvidenceSet } {
  const filtered = matches.filter((m) => !rejectedIds.includes(m.projectId)).slice(0, 3);
  if (filtered.length > 0) {
    return { goal: base, evidence: { tools: ['search'], matches: filtered } };
  }
  if (c.budgetMaxInr && catalog.priceMinInr > 0 && catalog.priceMinInr > c.budgetMaxInr) {
    const floorProject = catalog.sample.find((p) => p.startingPriceDisplay === formatInr(catalog.priceMinInr));
    return {
      goal: { kind: 'no_fit' },
      evidence: {
        tools: ['catalog'],
        floor: { display: formatInr(catalog.priceMinInr), projectName: floorProject?.name },
      },
    };
  }
  return {
    goal: { kind: 'no_fit' },
    evidence: {
      tools: ['search'],
      noMatch: {
        reasoning: noMatchReasoning || 'No exact match for those filters',
        nearby: [],
      },
    },
  };
}

export function firstMissingSlot(s: ConversationState): ProbeKind | undefined {
  const c = s.constraints;
  const asked = new Set(s.discover.asked);
  if (!c.location && !asked.has('location')) return 'location';
  if (!c.budgetMaxInr && !asked.has('budget')) return 'budget';
  // Adaptive: purpose decides whether bedrooms are even the right question —
  // an investor gets purpose first and no bhk probe (mirror of the advisor
  // brief's rule table; same branch axis, coherent ladders).
  if (!c.purpose && !c.budgetMaxInr && !asked.has('purpose')) return 'purpose';
  if (c.purpose !== 'investment' && !c.bhk && !c.budgetMaxInr && !asked.has('bhk')) return 'bhk';
  return undefined;
}

function nextSlot(s: ConversationState): ProbeKind {
  return firstMissingSlot(s) ?? 'location';
}

export function hasNarrowingConstraint(c: Constraints): boolean {
  return Boolean(c.budgetMaxInr || c.bhk || c.location || c.propertyType);
}

/**
 * Location vs project micro_market.
 * Prefer Desk expanded_locations / identity reasons over Spine-invented place lists.
 * Only structural string overlap here (buyer loc ↔ micro_market text).
 */
export function matchMicroMarket(microMarket: string, location: string): boolean {
  const m = microMarket.toLowerCase();
  const loc = location.toLowerCase();
  if (m.includes(loc) || loc.includes(m)) return true;
  for (const part of loc.split('/')) {
    const p = part.trim();
    if (p.length >= 3 && (m.includes(p) || p.includes(m))) return true;
  }
  return false;
}

export function filterSearchMatches(
  raw: Match[],
  c: Constraints,
  rejectedIds: readonly string[],
  opts?: { locationAliases?: readonly string[] },
): Match[] {
  let ms = raw.filter((m) => !rejectedIds.includes(m.projectId));
  if (c.budgetMaxInr) {
    const budgetMax = c.budgetMaxInr;
    ms = ms.filter((m) => m.startingPriceInr > 0 && m.startingPriceInr <= budgetMax);
  }
  if (c.location) {
    // Desk expand aliases (from NayaDesk, not Spine hardcodes) + buyer location.
    const locs = [c.location, ...(opts?.locationAliases ?? [])].filter(Boolean);
    ms = ms.filter(
      (m) =>
        locs.some((loc) => matchMicroMarket(m.microMarket, loc)) ||
        deskLocationIdentityHit(m, locs),
    );
  }
  return ms.slice(0, 3);
}

/**
 * Trust Desk match_reasons when they echo the buyer's own location tokens.
 * No Spine place-name catalog (no Devanahalli / Aerospace invent).
 */
export function deskLocationIdentityHit(m: Match, locs: readonly string[]): boolean {
  const reasons = (m.matchReasons ?? []).join(' ').toLowerCase();
  if (!reasons) return false;
  for (const loc of locs) {
    const lc = loc.toLowerCase().trim();
    if (!lc) continue;
    if (reasons.includes(lc)) return true;
    const tokens = lc.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
    if (tokens.some((t) => reasons.includes(t))) return true;
  }
  return false;
}

/** When search returns options but none fit budget (and optional location), build honest no-fit evidence. */
export function buildBudgetNoFitEvidence(
  c: Constraints,
  raw: Match[],
  rejectedIds: readonly string[],
): EvidenceSet | null {
  if (!c.budgetMaxInr) return null;
  let pool = raw.filter((m) => !rejectedIds.includes(m.projectId));
  if (c.location) {
    pool = pool.filter((m) => matchMicroMarket(m.microMarket, c.location!));
  }
  if (pool.length === 0) return null;
  const cheapest = [...pool].sort((a, b) => a.startingPriceInr - b.startingPriceInr)[0]!;
  if (cheapest.startingPriceInr <= 0 || cheapest.startingPriceInr <= c.budgetMaxInr) return null;
  const locBit = c.location ? ` in ${c.location}` : '';
  const closestDisplay = cheapest.startingPriceDisplay || formatInr(cheapest.startingPriceInr);
  return {
    tools: ['search'],
    floor: { display: closestDisplay, projectName: cheapest.name },
    budgetGap: {
      budgetDisplay: formatInr(c.budgetMaxInr),
      location: c.location,
      closestName: cheapest.name,
      closestDisplay,
      closestProjectId: cheapest.projectId,
    },
    noMatch: {
      reasoning: `Nothing${locBit} starts within ${formatInr(c.budgetMaxInr)} — closest is *${cheapest.name}* from ${closestDisplay}`,
      nearby: [],
    },
  };
}

/** When property type filter yields zero but other types fit at same budget. */
export function buildPropertyTypeNoFitEvidence(
  c: Constraints,
  withoutTypeMatches: Match[],
  rejectedIds: readonly string[],
): EvidenceSet | null {
  if (!c.propertyType) return null;
  let pool = withoutTypeMatches.filter((m) => !rejectedIds.includes(m.projectId));
  if (c.budgetMaxInr) {
    pool = pool.filter((m) => m.startingPriceInr > 0 && m.startingPriceInr <= c.budgetMaxInr!);
  }
  if (pool.length === 0) return null;
  const cheapest = [...pool].sort((a, b) => a.startingPriceInr - b.startingPriceInr)[0]!;
  const budgetDisplay = c.budgetMaxInr ? formatInr(c.budgetMaxInr) : undefined;
  const altDisplay = cheapest.startingPriceDisplay || formatInr(cheapest.startingPriceInr);
  const budgetBit = budgetDisplay ? ` at ${budgetDisplay}` : '';
  // Name the locality too (AB-2 / G-family honesty): "no plantation IN WHITEFIELD"
  // is the honest claim — "no plantation" alone reads as a catalog-wide gap.
  const locBit = c.location?.trim() ? ` in *${c.location.trim()}*` : '';
  return {
    tools: ['search'],
    propertyTypeGap: {
      requestedType: c.propertyType,
      budgetDisplay,
      ...(c.location?.trim() ? { location: c.location.trim() } : {}),
      closestName: cheapest.name,
      closestDisplay: altDisplay,
      closestProjectId: cheapest.projectId,
    },
    noMatch: {
      reasoning: `No *${c.propertyType}*${budgetBit}${locBit} on our books — closest fit is *${cheapest.name}* from ${altDisplay}`,
      nearby: [],
    },
  };
}

/** When BHK+budget+location jointly fail but smaller configs exist nearby. */
export function buildConstraintGapEvidence(
  c: Constraints,
  withoutBhkMatches: Match[],
  rejectedIds: readonly string[],
): EvidenceSet | null {
  if (!c.bhk) return null;
  const alt = withoutBhkMatches.filter((m) => !rejectedIds.includes(m.projectId));
  if (alt.length === 0) return null;
  const cheapest = [...alt].sort((a, b) => a.startingPriceInr - b.startingPriceInr)[0]!;
  const altDisplay = cheapest.startingPriceDisplay || formatInr(cheapest.startingPriceInr);
  const budgetBit = c.budgetMaxInr ? ` at ${formatInr(c.budgetMaxInr)}` : '';
  const locBit = c.location ? ` in ${c.location}` : '';
  return {
    tools: ['search'],
    constraintGap: {
      blocking: 'joint',
      bhk: c.bhk,
      budgetDisplay: c.budgetMaxInr ? formatInr(c.budgetMaxInr) : undefined,
      location: c.location,
      alternateProject: cheapest.name,
      alternateProjectId: cheapest.projectId,
      alternatePriceDisplay: altDisplay,
    },
    noMatch: {
      reasoning: `No *${c.bhk}*${budgetBit}${locBit} on our books — nearby options start from *${cheapest.name}* at ${altDisplay} in smaller configurations`,
      nearby: [],
    },
  };
}

/** After a shortlist, route legal/EMI/price/availability asks to a project instead of re-searching. */
function offeredDetailGoal(s: ConversationState, ex: Extracted): TurnGoal | null {
  if (ex.budgetFitQuestion || ex.budgetPickQuestion) return null;
  const topics = (ex.askTopics ?? []).filter((t) => t !== 'compare');
  const hasTopic =
    topics.length > 0 || (ex.askTopic && ex.askTopic !== 'compare') || ex.transition === 'want_details';
  if (!hasTopic) return null;

  const pick =
    resolvePick(ex, s.discover.lastOffered, s) ??
    recentBuyerNamedPick(s, s.discover.lastOffered) ??
    (s.focus ? { projectId: s.focus.projectId, name: s.focus.projectName } : undefined) ??
    (s.discover.lastOffered.length === 1 ? s.discover.lastOffered[0]! : undefined) ??
    (s.discover.discussedProjects?.length
      ? s.discover.discussedProjects[s.discover.discussedProjects.length - 1]
      : undefined);
  // Facet ask ("Starting prices") with multi shortlist but no pick → answer the
  // facet for every shortlisted project (4q-fix3 kill #1: the clarify-pick
  // sinkhole ate EMI/legal/cost asks with "Which one should I open — 1) 2) 3)?").
  // Topics with no shortlist-wide lane still clarify; a constraint refine
  // without a named pick still re-searches (PIV-03).
  if (!pick) {
    const refine = ex.speechAct === 'search' && hasNarrowingConstraint(s.constraints);
    if (s.discover.lastOffered.length >= 2 && !refine) {
      // shortlistAnswerGoal reads askTopic AND askTopics; the clarify fallback
      // keeps its original askTopics-only condition — nothing NEW clarifies.
      const across = shortlistAnswerGoal(s, ex);
      if (across) return across;
      if (topics.length > 0) return { kind: 'clarify_project_pick' };
    }
    return null;
  }

  return commitPickWithFollowUp(pick, ex);
}

/**
 * Facet topics that have a shortlist-wide answer lane (compare-matrix rows,
 * per-project legal detail, per-project EMI basis). Topics outside this set —
 * overview ("tell me more"), media (a brochure send targets one project),
 * amenities (no per-project fetch lane yet) — keep the pick-menu.
 */
const SHORTLIST_ANSWERABLE: ReadonlySet<import('../types.js').AnswerTopic> = new Set([
  'price',
  'emi',
  'legal',
  'availability',
  'location',
  'property_type',
] as import('../types.js').AnswerTopic[]);

/** Facet ask over a ≥2 shortlist with no pick → answer across the board. */
function shortlistAnswerGoal(s: ConversationState, ex: Extracted): TurnGoal | null {
  const asked = (ex.askTopics?.length ? ex.askTopics : ex.askTopic ? [ex.askTopic] : []).filter(
    (t) => SHORTLIST_ANSWERABLE.has(t),
  );
  if (!asked.length) return null;
  const ids = s.discover.lastOffered.slice(0, 3).map((o) => o.projectId);
  if (ids.length < 2) return null;
  return {
    kind: 'shortlist_answer',
    topic: asked[0]!,
    ...(asked.length > 1 ? { topics: asked } : {}),
    projectIds: ids,
  };
}

/** Prior buyer turn named a shortlisted project — use for facet asks without re-naming. */
function recentBuyerNamedPick(
  s: ConversationState,
  offered: readonly import('../types.js').OfferedProject[],
): import('../types.js').OfferedProject | undefined {
  if (!offered.length) return undefined;
  const msgs = s.discover.recentMessages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (!m || m.role !== 'buyer') continue;
    const t = m.text.toLowerCase();
    // Builder-agnostic: nameMentioned drops a leading brand token when present
    // (e.g. "Brigade Eldorado" → "eldorado"), not a hardcoded builder list.
    for (const o of offered) {
      if (nameMentioned(o.name, t) || t.includes(o.name.toLowerCase())) return o;
    }
    break;
  }
  return undefined;
}

export function commitPickWithFollowUp(
  pick: { projectId: string; name: string },
  ex: Extracted,
): TurnGoal {
  const topics = (ex.askTopics ?? []).filter((t) => t !== 'compare');
  const topic =
    topics[0] ??
    (ex.askTopic && ex.askTopic !== 'compare' ? ex.askTopic : undefined) ??
    (ex.transition === 'want_details' || ex.implicitProjectPick || ex.pickName || ex.pickOrdinal
      ? 'overview'
      : undefined);
  if (topic) {
    return {
      kind: 'commit',
      projectId: pick.projectId,
      projectName: pick.name,
      followUp: topic,
      ...(topics.length > 1 ? { followUpTopics: topics } : {}),
    };
  }
  return { kind: 'commit', projectId: pick.projectId, projectName: pick.name };
}

export interface TypeFloorHit {
  name: string;
  display: string;
  priceInr: number;
}

/** Cheapest catalog project for a property type (no budget cap). */
export async function cheapestMatchForPropertyType(
  search: (filters: SearchFilters) => Promise<{
    matches: Array<{ name: string; starting_price_inr: number; starting_price_display: string }>;
  }>,
  propertyType: string,
): Promise<TypeFloorHit | null> {
  const filters: SearchFilters = {
    projectTypes: mapProjectTypesForSearch(propertyType),
    maxResults: 25,
  };
  const result = await search(filters);
  const pool = result.matches.filter((m) => m.starting_price_inr > 0);
  if (!pool.length) return null;
  const cheapest = [...pool].sort((a, b) => a.starting_price_inr - b.starting_price_inr)[0]!;
  return {
    name: cheapest.name,
    display: cheapest.starting_price_display || formatInr(cheapest.starting_price_inr),
    priceInr: cheapest.starting_price_inr,
  };
}

export function displayPropertyTypeLabel(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('villa')) return 'Villa';
  if (s.includes('apartment') || s.includes('flat')) return 'Apartment';
  if (s.includes('plot') || s.includes('land')) return 'Plot / land';
  if (s.includes('plantation') || s.includes('planted') || s.includes('estate')) return 'Planted estate';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
