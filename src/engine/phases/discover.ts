import type { CatalogEnvelope, Constraints, ConversationState, EvidenceSet, Extracted, Match, ProbeKind, SearchFilters, TurnGoal } from '../types.js';
import { resolvePick } from '../state.js';
import { formatInr } from '../compose.js';

export function decide(s: ConversationState, ex: Extracted): TurnGoal {
  const d = s.discover;
  if (ex.recall) return { kind: 'visit_recall' };

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

  // "details on the project" with a shortlist → commit (don't re-search or probe budget).
  if (
    (ex.implicitProjectPick || ex.transition === 'want_details') &&
    d.lastOffered.length === 1
  ) {
    const only = d.lastOffered[0]!;
    return commitPickWithFollowUp(only, ex);
  }

  const pick = resolvePick(ex, d.lastOffered, s);
  if (pick) return commitPickWithFollowUp(pick, ex);

  if (d.lastOffered.length > 0) {
    const detailGoal = offeredDetailGoal(s, ex);
    if (detailGoal) return detailGoal;
  }

  if (ex.transition === 'want_visit') return { kind: 'propose_visit' };
  if (ex.objection) return { kind: 'objection', topic: ex.objectionTopic ?? 'custom' };

  if (ex.rejected && hasNarrowingConstraint(s.constraints)) return { kind: 'ack_reject_recommend' };
  if (ex.wantsMore) return { kind: 'recommend' };
  if (hasNarrowingConstraint(s.constraints)) return { kind: 'recommend' };

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
    ...(c.location ? { locations: c.location } : {}),
    ...(c.propertyType ? { projectTypes: mapProjectTypesForSearch(c.propertyType) } : {}),
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
  if (!c.bhk && !c.budgetMaxInr && !asked.has('bhk')) return 'bhk';
  if (!c.purpose && !c.budgetMaxInr && !asked.has('purpose')) return 'purpose';
  return undefined;
}

function nextSlot(s: ConversationState): ProbeKind {
  return firstMissingSlot(s) ?? 'location';
}

export function hasNarrowingConstraint(c: Constraints): boolean {
  return Boolean(c.budgetMaxInr || c.bhk || c.location || c.propertyType);
}

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
): Match[] {
  let ms = raw.filter((m) => !rejectedIds.includes(m.projectId));
  if (c.budgetMaxInr) {
    const budgetMax = c.budgetMaxInr;
    ms = ms.filter((m) => m.startingPriceInr > 0 && m.startingPriceInr <= budgetMax);
  }
  return ms.slice(0, 3);
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
  return {
    tools: ['search'],
    propertyTypeGap: {
      requestedType: c.propertyType,
      budgetDisplay,
      closestName: cheapest.name,
      closestDisplay: altDisplay,
    },
    noMatch: {
      reasoning: `No *${c.propertyType}*${budgetBit} on our books — closest fit is *${cheapest.name}* from ${altDisplay}`,
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

/** After a shortlist, route legal/EMI/price asks to a project instead of re-searching. */
function offeredDetailGoal(s: ConversationState, ex: Extracted): TurnGoal | null {
  if (ex.budgetFitQuestion || ex.budgetPickQuestion) return null;
  const topics = (ex.askTopics ?? []).filter((t) => t !== 'compare');
  const hasTopic =
    topics.length > 0 || (ex.askTopic && ex.askTopic !== 'compare') || ex.transition === 'want_details';
  if (!hasTopic) return null;

  const pick =
    resolvePick(ex, s.discover.lastOffered) ??
    (s.focus ? { projectId: s.focus.projectId, name: s.focus.projectName } : undefined) ??
    (s.discover.lastOffered.length === 1 ? s.discover.lastOffered[0]! : undefined);
  if (!pick) return null;

  return commitPickWithFollowUp(pick, ex);
}

function commitPickWithFollowUp(
  pick: { projectId: string; name: string },
  ex: Extracted,
): TurnGoal {
  const topics = (ex.askTopics ?? []).filter((t) => t !== 'compare');
  const topic =
    topics[0] ??
    (ex.askTopic && ex.askTopic !== 'compare' ? ex.askTopic : undefined) ??
    (ex.transition === 'want_details' ? 'overview' : undefined);
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
