import type { CatalogEnvelope, Constraints, ConversationState, EvidenceSet, Extracted, Match, ProbeKind, SearchFilters, TurnGoal } from '../types.js';
import { splitComposeTopics } from '../facts.js';
import { nameMentioned } from '../project_references.js';
import { resolvePick } from '../state.js';
import { formatInr } from '../compose.js';
import { currentShortlist, discussedList } from '../entity-store.js';
import { isAttentionNudge, isNonPlaceUtterance } from '../placeability.js';
import { isAdvisorBriefChipPhrase } from '../advisor-brief-chips.js';
import { isCompareAmongOfferedTurn } from '../turn-intent/compare-intent.js';
import { asksForAHuman, asksForSomethingNotOnBook, resolveBookQuestion, resolveSituation } from '../book-questions.js';

export function decide(
  s: ConversationState,
  ex: Extracted,
  buyerText?: string,
  opts?: { skipBrief?: boolean },
): TurnGoal {
  const d = s.discover;
  const asked = s.discover.asked;
  const mergedC = mergeConstraints(s.constraints, ex.constraints);
  const ready = isBriefReady(mergedC, { asked });
  const readyState = isBriefReady(s.constraints, { asked });
  // "Can someone call me?", "connect me to your sales manager", "who will show
  // me around?" — a request for a PERSON, which no open project turns into a
  // question about that project. It has to be resolved above every fact path
  // below, or the focused answer layer treats it as a missing data point and
  // says "I don't have that on file" to a buyer asking for a callback.
  if (opts?.skipBrief && buyerText) {
    const handoff = asksForAHuman(buyerText);
    if (handoff) return { kind: 'recommend', bookQuestion: handoff };
  }
  if (ex.recallConstraints) return { kind: 'recall_constraints' };
  if (ex.recall) return { kind: 'visit_recall' };
  const asksEmi =
    ex.askTopic === 'emi' || (ex.askTopics?.includes('emi') ?? false);
  if (
    ex.emiContractV1 &&
    (ex.emiPrincipalInr !== undefined || (asksEmi && currentShortlist(s).length === 0))
  ) {
    return { kind: 'emi_calculate' };
  }

  // Explicit name is authoritative. A single PROJECT_VECTORS hit (≥0.65, and
  // already gated against pure search/location/budget noise upstream) means the
  // buyer NAMED this project. That is a pick, not a filter adjustment — it must
  // beat the recovery/refinement search-belt below (forceRecommendList /
  // freshSearchBoard), which would otherwise turn "Ayana" after a vague brief
  // ("green near the hills") into a no_fit search. Compare/visit/details and
  // "show me more" keep their own downstream paths.
  //
  // Bare "Brigade Orchards" must commit even when compare_resolve wrongly stamped
  // askTopic=compare by pairing with a shortlist sibling — only an explicit
  // compare cue (or two named projects) keeps the compare path.
  const explicitCompareAsk =
    !!ex.compareAdvice ||
    (ex.namedProjects?.length ?? 0) >= 2 ||
    (typeof buyerText === 'string' && isCompareAmongOfferedTurn(buyerText));
  if (
    (ex.namedProjects?.length ?? 0) === 1 &&
    ex.speechAct !== 'search' &&
    ex.transition !== 'want_visit' &&
    ex.transition !== 'want_details' &&
    !explicitCompareAsk &&
    !ex.wantsMore &&
    !ex.rejected
  ) {
    const namedPick = resolvePick(ex, currentShortlist(s), s);
    if (namedPick) return commitPickWithFollowUp(namedPick, ex);
  }

  // Fresh search board: brief-ready + empty shortlist beats embedder compare/visit noise.
  // propertyType / lone BHK is NOT enough — probe fulfillments first (catalog-stress).
  const freshSearchBoard =
    currentShortlist(s).length === 0 &&
    !s.focus &&
    ready;
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
    currentShortlist(s).length >= 2 &&
    !ex.wantsMore &&
    !ex.rejected
  ) {
    return { kind: 'answer', topic: 'compare', projectId: currentShortlist(s)[0]!.projectId };
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
  // Media chips ("send the brochure") often set want_details/implicit — recover the
  // prior named shortlist pick before the clarify menu (CAT-04/07).
  if (ex.implicitProjectPick || ex.transition === 'want_details') {
    const mediaKind =
      typeof ex.mediaAssetKind === 'string' ? ex.mediaAssetKind.trim() : '';
    const explicit =
      resolvePick(ex, currentShortlist(s), s) ??
      recentBuyerNamedPick(s, currentShortlist(s)) ??
      (s.focus ? { projectId: s.focus.projectId, name: s.focus.projectName } : undefined) ??
      (() => {
        const discussed = discussedList(s);
        return discussed.length ? discussed[discussed.length - 1] : undefined;
      })();
    if (explicit) {
      if (mediaKind) {
        return {
          kind: 'commit',
          projectId: explicit.projectId,
          projectName: explicit.name,
          followUp: 'media',
        };
      }
      return commitPickWithFollowUp(explicit, ex);
    }
    if (currentShortlist(s).length === 1) {
      const only = currentShortlist(s)[0]!;
      if (mediaKind) {
        return {
          kind: 'commit',
          projectId: only.projectId,
          projectName: only.name,
          followUp: 'media',
        };
      }
      return commitPickWithFollowUp(only, ex);
    }
    if (currentShortlist(s).length >= 2) {
      if (mediaKind) return { kind: 'clarify_project_pick' };
      const across = shortlistAnswerGoal(s, ex);
      if (across) return across;
      return { kind: 'clarify_project_pick' };
    }
  }

  // LOC-G01 belt: search + brief-ready must recommend, not commit on
  // hallucinated PROJECT_VECTORS identity (empty shortlist / off-shortlist pick).
  if (
    ex.speechAct === 'search' &&
    ready
  ) {
    return { kind: 'recommend' };
  }

  const pick = resolvePick(ex, currentShortlist(s), s);
  if (pick) return commitPickWithFollowUp(pick, ex);

  if (currentShortlist(s).length > 0) {
    const detailGoal = offeredDetailGoal(s, ex);
    if (detailGoal) return detailGoal;
  }

  // P2 multi-act: brief-ready + visit on empty board → shortlist first.
  // Embedder namedProjects must not invent a visit/compare board here.
  // Partial brief (e.g. "apartment" only) falls through to the probe ladder.
  if (ex.transition === 'want_visit' || ex.speechAct === 'visit_book') {
    if (ready && currentShortlist(s).length === 0 && !s.focus) {
      return { kind: 'recommend' };
    }
    if (!(ex.namedProjects?.length)) {
      if (ready) return { kind: 'recommend' };
      if (!ready && currentShortlist(s).length === 0 && !s.focus) {
        // Builder-allotted WA: show the book so they pick a project first.
        if (opts?.skipBrief) return { kind: 'recommend' };
        // fall through to probe / orient
      } else {
        return { kind: 'propose_visit' };
      }
    }
  }
  if (ex.objection) return { kind: 'objection', topic: ex.objectionTopic ?? 'custom' };

  if (ex.rejected && readyState) return { kind: 'ack_reject_recommend' };
  if (ex.wantsMore && readyState) return { kind: 'recommend' };
  // P2: search + media/facet without a pick → recommend board (not clarify).
  if (
    readyState &&
    ((ex.askTopics ?? []).some((t) => t === 'media' || t === 'price' || t === 'legal') ||
      ex.askTopic === 'media' ||
      ex.askTopic === 'price')
  ) {
    return { kind: 'recommend' };
  }
  if (readyState) return { kind: 'recommend' };

  // "Want details on any of these?" — a bare yes to the list's own fork. The
  // list is the question, so the shortlist is the answer: one match opens, two
  // or more earn the pick menu. Without this the yes fell through to the
  // below-threshold guard and came back "tell me a size or budget", asking for
  // the brief the buyer had just given.
  if (ex.affirm && !ex.decline && !ex.isQuestion && !s.focus) {
    const shortlist = currentShortlist(s);
    if (shortlist.length === 1) return commitPickWithFollowUp(shortlist[0]!, ex);
    if (shortlist.length >= 2) return { kind: 'clarify_project_pick' };
    // Nothing on the board and nothing outstanding: "yes" still means yes. The
    // only thing on offer was the book, so that is what yes agreed to.
    if (opts?.skipBrief) return { kind: 'recommend' };
  }

  // "I don't like this one, show me something else". Rejection and wanting more
  // both needed a complete brief to route, which an allotted book never asks
  // for — so on this line they fell to the clarify floor and the buyer got
  // asked for a size instead of being shown the rest of the book.
  if (opts?.skipBrief && (ex.rejected || ex.wantsMore) && !ready) {
    return ex.rejected ? { kind: 'ack_reject_recommend' } : { kind: 'recommend' };
  }

  // Below-threshold guard. Everything above failed to route this turn, so the
  // engine does NOT understand the ask. The remaining fallbacks (greet, orient)
  // have generative compose contracts — reaching them with a real question is
  // what produced "Hey there! 👋 Welcome to Naya Advisor" for "is my money safe
  // with this builder?", and a portfolio pitch plus an invented "great choice
  // going for an investment property" on the turn after. Ask instead of guess.
  //
  // Smalltalk still wins: "hi there" is understood, not a miss. A question we
  // DID route (askTopic/askTopics) never reaches here.
  // First-home / "not sure where to start" — discovery help, not clarify.
  // "are you a bot?", "do I pay commission?", "which is the cheapest?" — about
  // the line or the book, not a property. Resolved HERE, above the guard that
  // sends any unrouted question to clarify_intent: these end in a question mark
  // more often than not, so below that guard they were unreachable.
  // Property intent always wins: "I don't want to share my details, just tell me
  // the price" reads as a privacy question and IS a price question, and the
  // buyer's actual ask is the price. This module only ever gets the turns the
  // intent layer found nothing in.
  if (
    opts?.skipBrief &&
    !ex.askTopic &&
    !(ex.askTopics?.length) &&
    !(ex.namedProjects?.length)
  ) {
    const bookQ = resolveBookQuestion(buyerText ?? '');
    if (bookQ) return { kind: 'recommend', bookQuestion: bookQ };
  }

  if (isFirstHomeHelpAsk(ex)) {
    // Builder-allotted WA: "not sure where to start" opens the two-tap minimal
    // brief (size → budget) instead of dumping the book.
    if (opts?.skipBrief) {
      if (!mergedC.bhk?.trim() && !mergedC.propertyType?.trim()) return { kind: 'probe', slot: 'bhk' };
      if (mergedC.budgetMaxInr === undefined) return { kind: 'probe', slot: 'budget' };
      return { kind: 'recommend' };
    }
    if (!d.oriented) return { kind: 'orient' };
    if (firstMissingSlot(s) === undefined || d.ignoredProbes >= 3) return { kind: 'recommend' };
    return { kind: 'probe', slot: nextSlot(s) };
  }

  // A stated situation ("we have two small kids", "I work from home") — below
  // the minimal brief, which already owns "where do I start", and only when the
  // buyer brought no filter with it: "we are 7 people, need a big place" is a
  // size ask and belongs to search.
  if (
    opts?.skipBrief &&
    !ex.askTopic &&
    !(ex.askTopics?.length) &&
    !(ex.namedProjects?.length) &&
    !hasNarrowingConstraint(ex.constraints)
  ) {
    const situation = resolveSituation(buyerText ?? '');
    if (situation) return { kind: 'recommend', situation };
  }

  // "do you have Prestige Lakeside?", "anything in Jayanagar?" — nothing above
  // resolved it, and on a single-builder book that failure IS the answer.
  // Has to sit above the unrouted-question guard below, which would otherwise
  // ask the buyer to rephrase a question we understood perfectly well.
  if (
    opts?.skipBrief &&
    !(ex.namedProjects?.length) &&
    !hasNarrowingConstraint(ex.constraints) &&
    !ex.forceRecommendList &&
    ex.speechAct !== 'search'
  ) {
    const absent = asksForSomethingNotOnBook(buyerText ?? '');
    if (absent) return { kind: 'recommend', bookQuestion: absent };
  }

  if (
    ex.isQuestion &&
    !ex.smalltalk &&
    // "hello?" carries a question mark and no question. Clarifying a knock
    // reads as blame; turn 0 greets it, later turns re-offer the book.
    !isAttentionNudge(buyerText ?? '') &&
    !ex.askTopic &&
    !(ex.askTopics?.length) &&
    // "I can pay 60000 per month, what can I buy?" is a question that already
    // carries its own filter. Clarifying it asks the buyer to repeat what they
    // just said — the book can be cut and shown right now.
    !hasNarrowingConstraint(ex.constraints) &&
    !(ex.namedProjects?.length)
  ) {
    return { kind: 'clarify_intent' };
  }
  // Keyboard smash / non-place noise — sticky clarify, never portfolio orient.
  // (ask_next_step must also refuse noise — see shouldConsumeAskNextStep.)
  if (
    buyerText &&
    !opts?.skipBrief &&
    isNonPlaceUtterance(buyerText) &&
    !hasNarrowingConstraint(ex.constraints) &&
    !(ex.namedProjects?.length) &&
    ex.transition !== 'want_visit'
  ) {
    return { kind: 'clarify_intent' };
  }
  // Turn-0 greet only when there is nothing to route — never discard a facet,
  // named project, search brief, or first-home help ask.
  if (s.turnCount === 0 && !hasRoutableTurnZeroAsk(ex, s)) {
    return { kind: 'greet' };
  }
  if (opts?.skipBrief) {
    // "hi" / "ok" / noise / leftover chip labels re-offer the book. A real
    // statement the engine could not route gets ONE honest probe
    // (clarify_intent packs the three doors) — never the same dump twice.
    // Anything routable still recommends.
    const routable =
      hasNarrowingConstraint(ex.constraints) ||
      (ex.namedProjects?.length ?? 0) > 0 ||
      ex.forceRecommendList ||
      ex.speechAct === 'search';
    const text = buyerText?.trim() ?? '';
    if (
      routable ||
      ex.smalltalk ||
      !text ||
      isNonPlaceUtterance(text) ||
      isAdvisorBriefChipPhrase(text)
    ) {
      // A brief IS the question; the cut list answers it. Leading with a
      // book-level sentence here would answer something the buyer didn't ask.
      return { kind: 'recommend' };
    }
    // A recognised ask carrying no filter is still a question the book can
    // answer ("price?", "rera number first"). It used to fail `routable` — no
    // constraint, no project name — and got "tell me a size or budget", which
    // answers a question the buyer never asked. Exactly one topic, or the lead
    // would assert a confident answer to whichever one won the tie.
    const asked = ex.askTopic ? [ex.askTopic] : (ex.askTopics ?? []);
    if (asked.length === 1) return { kind: 'recommend', askedTopic: asked[0]! };
    // ONE honest probe, not two. Asking again after the buyer has already failed
    // to answer the same question means the question is not the problem — show
    // the book and let them point at something instead.
    if (s.rti?.lastGoalKind === 'clarify_intent') return { kind: 'recommend' };
    return { kind: 'clarify_intent' };
  }
  if (ex.smalltalk) return { kind: 'smalltalk' };
  if (!d.oriented) return { kind: 'orient' };
  if (firstMissingSlot(s) === undefined || d.ignoredProbes >= 3) return { kind: 'recommend' };
  return { kind: 'probe', slot: nextSlot(s) };
}

/** True when turn-0 content must not be swallowed by the welcome greet. */
export function hasRoutableTurnZeroAsk(ex: Extracted, s: ConversationState): boolean {
  if (ex.askTopic || (ex.askTopics?.length ?? 0) > 0) return true;
  if ((ex.namedProjects?.length ?? 0) > 0) return true;
  if (ex.forceRecommendList || ex.speechAct === 'search') return true;
  if (ex.transition === 'want_details' || ex.transition === 'want_visit') return true;
  if (hasNarrowingConstraint(s.constraints) || hasNarrowingConstraint(ex.constraints)) return true;
  if (isFirstHomeHelpAsk(ex)) return true;
  if (ex.isQuestion && !ex.smalltalk) return true;
  return false;
}

/** Open-ended first-home / help-me-start — stamped by extractFacts. */
export function isFirstHomeHelpAsk(ex: Extracted): boolean {
  return Boolean(ex.firstHomeHelp);
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
  // BHK only for apartment / unspecified end-use — not plantation/plot/villa/investment.
  if (
    c.purpose !== 'investment' &&
    propertyTypeNeedsBhk(c.propertyType) &&
    !c.bhk &&
    !asked.has('bhk')
  ) {
    return 'bhk';
  }
  return undefined;
}

function nextSlot(s: ConversationState): ProbeKind {
  return firstMissingSlot(s) ?? 'location';
}

/** Any constraint signal (preview, routable turn-0, reject filters). Not enough to list. */
export function hasNarrowingConstraint(c: Constraints): boolean {
  return Boolean(c.budgetMaxInr || c.bhk || c.location || c.propertyType);
}

/**
 * Apartment / unspecified end-use needs BHK. Explicit non-apartment types
 * (plantation / plot / villa / …) and investment do not.
 */
export function propertyTypeNeedsBhk(propertyType?: string): boolean {
  if (!propertyType?.trim()) return true;
  const s = propertyType.toLowerCase();
  if (s.includes('apartment') || s.includes('flat')) return true;
  if (
    s.includes('plantation') ||
    s.includes('planted') ||
    s.includes('estate') ||
    s.includes('villa') ||
    s.includes('plot') ||
    s.includes('land') ||
    s.includes('bungalow')
  ) {
    return false;
  }
  return true;
}

/**
 * Brief-ready for recommend / board.
 * - Apartment / unspecified: location + budget + (bhk, unless asked/waived or investment).
 * - Non-apartment (plantation/plot/villa/…): explicit propertyType is enough (no BHK);
 *   location+budget without type also works for typed-adjacent funnels.
 * Bare apartment / propertyType-less partials must NOT short-circuit (catalog-stress).
 */
export function isBriefReady(
  c: Constraints,
  opts?: { asked?: readonly string[] },
): boolean {
  if (c.purpose === 'investment') {
    return Boolean(c.location?.trim() && c.budgetMaxInr !== undefined);
  }
  if (!propertyTypeNeedsBhk(c.propertyType)) {
    if (c.propertyType?.trim()) return true;
    return Boolean(c.location?.trim() && c.budgetMaxInr !== undefined);
  }
  if (!c.location?.trim() || c.budgetMaxInr === undefined) return false;
  if (c.bhk) return true;
  if (opts?.asked?.includes('bhk')) return true;
  return false;
}

export function mergeConstraints(a: Constraints, b: Constraints): Constraints {
  return { ...a, ...b };
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
  const mediaKind = typeof ex.mediaAssetKind === 'string' ? ex.mediaAssetKind.trim() : '';
  const hasTopic =
    topics.length > 0 ||
    (ex.askTopic && ex.askTopic !== 'compare') ||
    ex.transition === 'want_details' ||
    !!mediaKind;
  if (!hasTopic) return null;

  const pick =
    resolvePick(ex, currentShortlist(s), s) ??
    recentBuyerNamedPick(s, currentShortlist(s)) ??
    (s.focus ? { projectId: s.focus.projectId, name: s.focus.projectName } : undefined) ??
    (currentShortlist(s).length === 1 ? currentShortlist(s)[0]! : undefined) ??
    (() => {
      const discussed = discussedList(s);
      return discussed.length ? discussed[discussed.length - 1] : undefined;
    })();
  // Facet ask ("Starting prices") with multi shortlist but no pick → answer the
  // facet for every shortlisted project (4q-fix3 kill #1: the clarify-pick
  // sinkhole ate EMI/legal/cost asks with "Which one should I open — 1) 2) 3)?").
  // Topics with no shortlist-wide lane still clarify; a constraint refine
  // without a named pick still re-searches (PIV-03).
  // Media asset asks (brochure / price_sheet) are per-project — never shortlist price.
  if (!pick) {
    const refine = ex.speechAct === 'search' && hasNarrowingConstraint(s.constraints);
    if (currentShortlist(s).length >= 2 && !refine) {
      if (mediaKind) return { kind: 'clarify_project_pick' };
      // shortlistAnswerGoal reads askTopic AND askTopics; the clarify fallback
      // keeps its original askTopics-only condition — nothing NEW clarifies.
      const across = shortlistAnswerGoal(s, ex);
      if (across) return across;
      if (topics.length > 0) return { kind: 'clarify_project_pick' };
    }
    return null;
  }

  if (mediaKind) {
    return {
      kind: 'commit',
      projectId: pick.projectId,
      projectName: pick.name,
      followUp: 'media',
    };
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
  const ids = currentShortlist(s).slice(0, 3).map((o) => o.projectId);
  if (ids.length < 2) return null;
  const { active, parked } = splitComposeTopics(asked);
  return {
    kind: 'shortlist_answer',
    topic: active[0] ?? asked[0]!,
    ...(active.length > 1 ? { topics: active } : {}),
    ...(parked.length ? { parkedTopics: parked } : {}),
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
  // Scan back across buyer turns. Facet follow-ups ("send the brochure") are not
  // picks — do not stop at the latest utterance when it has no project name.
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (!m || m.role !== 'buyer') continue;
    const t = m.text.toLowerCase();
    // Builder-agnostic: nameMentioned drops a leading brand token when present
    // (e.g. "Brigade Eldorado" → "eldorado"), not a hardcoded builder list.
    for (const o of offered) {
      if (nameMentioned(o.name, t) || t.includes(o.name.toLowerCase())) return o;
    }
  }
  return undefined;
}

export function commitPickWithFollowUp(
  pick: { projectId: string; name: string },
  ex: Extracted,
): TurnGoal {
  const topics = (ex.askTopics ?? []).filter((t) => t !== 'compare').slice(0, 3);
  const topic =
    topics[0] ??
    (ex.askTopic && ex.askTopic !== 'compare' ? ex.askTopic : undefined) ??
    (ex.transition === 'want_details' || ex.implicitProjectPick || ex.pickName || ex.pickOrdinal
      ? 'overview'
      : undefined);
  // Bare name pick ("Brigade Orchards") → overview follow-up even when the only
  // askTopic was an invented compare stamp that we filtered out above.
  const follow =
    topic ??
    ((ex.namedProjects?.length ?? 0) === 1 || ex.pickName || ex.pickOrdinal != null
      ? 'overview'
      : undefined);
  if (follow) {
    return {
      kind: 'commit',
      projectId: pick.projectId,
      projectName: pick.name,
      followUp: follow,
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
