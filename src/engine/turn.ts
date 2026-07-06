/**
 * ConverseEngine — the turn kernel.
 * extract → merge → phase transition → goal → evidence → compose → verify → persist
 */
import * as discover from './phases/discover.js';
import * as focused from './phases/focused.js';
import * as visit from './phases/visit.js';
import { exitVisitPhase, shouldExitVisitForIntent } from './phases/visit.js';
import * as handoff from './phases/handoff.js';
import { extractFacts, isLocationBroadenTurn } from './facts.js';
import { resolveCompareProjectIds } from './compare_resolve.js';
import { resolveFocusedSwitchGoal } from './project_switch.js';
import {
  applyExtracted,
  applyVisitBooked,
  appendTranscript,
  commitTo,
  incObjection,
  initState,
  isSameAsLast,
  markAsked,
  markOriented,
  recordOffered,
  releaseToDiscover,
  withNdConversation,
} from './state.js';
import { buildComposeRequest, fallbackReply, formatInr } from './compose.js';
import { checkGrounding, stripBanned } from './grounding.js';
import { computeEmi, DEFAULT_RATE_PERCENT, DEFAULT_TENURE_YEARS } from './emi.js';
import { hydrateProjectDetail, prefetchProjects, projectIdsFromMatches } from './project-cache.js';
import { planSearchRecovery, type SearchRecoveryEnvelope, type AdvisorUiMode, type SuggestedAction } from './recovery-planner.js';
import {
  applyTurnIntentResult,
  buildTurnIntentInput,
  shouldRunTurnIntent,
} from './turn-intent/classify.js';
import { buildRtiStateUpdate, excerptReply } from './turn-intent/pending-prompt.js';
import type { PatchClearKey, TurnIntentChannel } from './turn-intent/types.js';
import { constraintsSnapshot } from './recovery-planner.js';
import type {
  CatalogEnvelope,
  ConversationState,
  EvidenceSet,
  Extracted,
  Match,
  ObjectionTopic,
  TurnDebug,
  TurnGoal,
} from './types.js';
import type { EngineDeps } from './ports.js';

export interface EngineTurnInput {
  convId: string;
  builderId: string;
  text: string;
  buyerPhone: string;
  channel?: TurnIntentChannel;
  action_id?: string;
  preferenceClears?: PatchClearKey[];
}

export interface EngineTurnOutput {
  reply: string;
  state: ConversationState;
  debug: TurnDebug;
  compareMatrix?: import('./types.js').CompareMatrixPayload;
  searchRecovery?: SearchRecoveryEnvelope;
  uiMode?: AdvisorUiMode;
  whatsappActions?: SuggestedAction[];
}

export async function runEngineTurn(input: EngineTurnInput, deps: EngineDeps): Promise<EngineTurnOutput> {
  let state = (await deps.store.load(input.convId)) ?? initState(input.convId, input.builderId);

  const trimmedText = input.text.trim();
  if (!trimmedText) {
    if (state.postVisitAckPending) {
      return runEngineTurn({ ...input, text: 'thanks' }, deps);
    }
    const reply = "Send me a message when you're ready — happy to help with area, budget, or a project name.";
    state = { ...state, turnCount: state.turnCount + 1 };
    await deps.store.save(state);
    return {
      reply,
      state,
      debug: { phase: state.phase, goal: { kind: 'smalltalk' }, tools: [], grounding: 'pass' },
    };
  }

  if (!state.ndConversationId) {
    const lead = await deps.crm.ensureLead(input.builderId, input.buyerPhone).catch(() => null);
    if (lead) state = withNdConversation(state, lead.conversationId, input.buyerPhone);
  }
  const nd = state.ndConversationId ?? '';

  if (nd) {
    const boot = await deps.data.bootstrapContext(nd).catch(() => null);
    if (boot) {
      if (boot.returningBuyer && !state.returningBuyer) {
        state = {
          ...state,
          returningBuyer: boot.returningBuyer,
          ...(boot.returningBuyer.buyerName && !state.buyerName
            ? { buyerName: boot.returningBuyer.buyerName }
            : {}),
        };
      }
      if (boot.rejectedProjectIds.length) {
        const merged = [...new Set([...state.discover.rejectedProjectIds, ...boot.rejectedProjectIds])];
        state = { ...state, discover: { ...state.discover, rejectedProjectIds: merged } };
      }
      if (boot.recentMessages.length) {
        const existing = state.discover.recentMessages ?? [];
        const combined = [...boot.recentMessages, ...existing].slice(-20);
        state = { ...state, discover: { ...state.discover, recentMessages: combined } };
      }
    }
  }

  const channel: TurnIntentChannel = input.channel ?? 'whatsapp';
  const uiModeHint: AdvisorUiMode = state.rti?.lastUiMode ?? 'brief_collect';
  const clearedKeys = new Set<PatchClearKey>(input.preferenceClears ?? []);

  if (deps.turnIntent && shouldRunTurnIntent(uiModeHint, input.action_id)) {
    const intentInput = buildTurnIntentInput(state, trimmedText, channel, uiModeHint, input.action_id);
    const intent = await deps.turnIntent.classify(intentInput);
    const applied = applyTurnIntentResult(state, intent, intentInput.suggested_actions);
    state = applied.state;
    for (const k of applied.clearedKeys) clearedKeys.add(k);

    if (applied.probeReply) {
      const storedRecovery = storedSearchRecovery(state);
      const reply = applied.probeReply;
      state = {
        ...state,
        turnCount: state.turnCount + 1,
        rti: {
          ...state.rti,
          pendingPrompt: {
            kind: 'chip_menu',
            chip_ids: state.rti?.lastSuggestedActions?.map((a) => a.id),
            asked_at_turn: state.turnCount,
          },
          lastReplyExcerpt: excerptReply(reply),
        },
      };
      state = appendTranscript(state, trimmedText, reply, deps.clock.nowMs());
      await deps.store.save(state);
      await deps.crm.appendMessage(nd || input.convId, 'inbound', input.text).catch(() => {});
      await deps.crm.appendMessage(nd || input.convId, 'outbound', reply, { replyKey: 'rti_probe' }).catch(() => {});
      const uiMode: AdvisorUiMode = storedRecovery?.mode === 'preference_refine' ? 'preference_refine' : 'search_recovery';
      return {
        reply,
        state,
        debug: { phase: state.phase, goal: { kind: 'no_fit' }, tools: [], grounding: 'pass' },
        ...(storedRecovery ? { searchRecovery: capRecoveryForChannel(storedRecovery, channel) } : {}),
        uiMode,
        whatsappActions: whatsAppButtons(storedRecovery, channel),
      };
    }
  }

  let ex = await extractFacts(trimmedText, state, deps.llm);
  const catalogForNlu = await deps.data.catalog(state.builderId).catch(() => null);
  ex = await deps.semantic.enrich(trimmedText, state.builderId, ex, {
    phase: state.phase,
    microMarkets: catalogForNlu?.microMarkets ?? [],
  });
  ex = {
    ...ex,
    compareProjectIds: resolveCompareProjectIds(trimmedText, ex, state),
  };
  const prevLoc = state.constraints.location;
  state = applyExtracted(state, ex, clearedKeys);

  const locationBroaden =
    isLocationBroadenTurn(trimmedText) ||
    Boolean(state.constraints.location && state.constraints.location !== prevLoc);
  if (state.phase === 'focused' && locationBroaden && !state.postVisitAckPending) {
    if (nd) await deps.crm.releaseProject(nd).catch(() => {});
    state = releaseToDiscover(state);
  }

  if (ex.stop && nd) {
    await deps.crm.deleteBuyerMemory(nd).catch(() => {});
    const reply = "Understood — I've removed your details from our system. You won't hear from us again.";
    state = { ...state, phase: 'handoff', turnCount: state.turnCount + 1 };
    await deps.store.save(state);
    await deps.crm.appendMessage(nd, 'inbound', input.text).catch(() => {});
    await deps.crm.appendMessage(nd, 'outbound', reply, { replyKey: 'stop' }).catch(() => {});
    return {
      reply,
      state,
      debug: { phase: 'handoff', goal: { kind: 'handoff' }, tools: ['deleteBuyerMemory'], grounding: 'pass' },
    };
  }

  if (state.phase === 'focused' && (ex.transition === 'see_others' || (ex.wantsMore && !ex.askTopic))) {
    if (nd) await deps.crm.releaseProject(nd).catch(() => {});
    state = releaseToDiscover(state);
  }
  if (state.phase === 'focused' && ex.transition === 'want_visit') {
    state = { ...state, phase: 'visit' };
  }
  if (ex.transition === 'want_visit' && state.phase === 'discover' && state.focus) {
    state = { ...state, phase: 'visit' };
  }

  if (state.phase === 'visit' && shouldExitVisitForIntent(ex)) {
    state = exitVisitPhase(state);
  }

  const now = new Date(deps.clock.nowMs());
  let visitCtx =
    state.phase === 'visit'
      ? {
          text: input.text,
          now,
          siteVisitHours:
            (await deps.data.builder(state.builderId).catch(() => null))?.siteVisitHours ??
            'Mon–Sun, 9am–7pm',
        }
      : null;
  let goal = await decideGoalAsync(state, ex, visitCtx, deps, trimmedText);

  let evidence: EvidenceSet = { tools: [] };
  if (goal.kind === 'commit' && nd) {
    await deps.crm.commitProject(nd, goal.projectId).catch(() => {});
    if (goal.followUp || goal.followUpTopics?.length) {
      state = commitTo(state, goal.projectId, goal.projectName);
      const answerGoal: Extract<TurnGoal, { kind: 'answer' }> = {
        kind: 'answer',
        topic: goal.followUp ?? goal.followUpTopics![0]!,
        projectId: goal.projectId,
        ...(goal.followUpTopics?.length ? { topics: goal.followUpTopics } : {}),
      };
      evidence = await fetchAnswer(answerGoal, state, ex, deps, nd);
      goal = answerGoal;
    }
  } else if (goal.kind === 'recommend' || goal.kind === 'ack_reject_recommend') {
    ({ goal, evidence } = await fetchRecommend(goal, state, ex, deps));
  } else if (goal.kind === 'objection') {
    ({ goal, evidence } = await fetchObjection(goal, state, deps, nd));
  } else if (goal.kind === 'answer') {
    evidence = await fetchAnswer(goal, state, ex, deps, nd);
  } else if (goal.kind === 'visit_recall') {
    evidence = await fetchVisitRecall(state, deps, nd);
  } else {
    evidence = await fetchEvidence(goal, state, deps);
  }

  const alreadyShownSameSet = evidence.matches ? isSameAsLast(state, evidence.matches) : false;
  const req = buildComposeRequest(goal, evidence, {
    buyerName: state.buyerName,
    constraints: state.constraints,
    alreadyShownSameSet,
    builderName: friendlyBuilder(state.builderId),
    buyerText: input.text,
    ...(state.focus ? { focusProjectName: state.focus.projectName } : {}),
    returningBuyer: state.returningBuyer,
  });

  const visitDeterministic =
    goal.kind === 'visit_ask' || goal.kind === 'visit_propose' || goal.kind === 'visit_booked';
  const compareDeterministic = goal.kind === 'answer' && goal.topic === 'compare';
  const multiAnswerDeterministic =
    goal.kind === 'answer' && (goal.topics?.length ?? 0) > 1;
  const locationDeterministic = goal.kind === 'answer' && goal.topic === 'location' && !!evidence.location;
  const mediaDeterministic = goal.kind === 'answer' && goal.topic === 'media' && !!evidence.media;
  const visitRecallDeterministic = goal.kind === 'visit_recall' && !!evidence.visits;
  const warmAckDeterministic = goal.kind === 'warm_ack';
  const propertyTypeDeterministic =
    goal.kind === 'answer' && goal.topic === 'property_type' && !!evidence.detail?.projectType;

  let draft: string;
  if (
    visitDeterministic ||
    compareDeterministic ||
    multiAnswerDeterministic ||
    locationDeterministic ||
    mediaDeterministic ||
    visitRecallDeterministic ||
    warmAckDeterministic ||
    propertyTypeDeterministic
  ) {
    draft = fallbackReply(req);
  } else {
    try {
      draft = (await deps.llm.compose(req)).trim();
      if (!draft) draft = fallbackReply(req);
    } catch {
      draft = fallbackReply(req);
    }
  }

  let reply = stripBanned(draft);
  let grounding: TurnDebug['grounding'] = 'pass';
  if (!checkGrounding(reply, evidence, input.text).grounded) {
    reply = fallbackReply(req);
    grounding = 'repaired';
  } else if (needsStructuredRepair(goal, evidence, reply)) {
    reply = fallbackReply(req);
    grounding = 'repaired';
  }
  if (!reply.trim()) reply = "Let me pull those details together and follow up shortly.";

  state = applyGoalToState(state, goal, evidence);
  if (evidence.detail && goal.kind === 'answer') {
    state = {
      ...state,
      projectCache: { ...(state.projectCache ?? {}), [goal.projectId]: evidence.detail },
    };
  }
  if (nd) {
    if (goal.kind === 'commit') {
      state = await prefetchProjects(deps, state, [goal.projectId]);
    } else if (
      (goal.kind === 'recommend' || goal.kind === 'ack_reject_recommend') &&
      evidence.matches?.length
    ) {
      state = await prefetchProjects(deps, state, projectIdsFromMatches(evidence.matches));
    } else if (state.focus?.projectId && !state.projectCache?.[state.focus.projectId]) {
      state = await prefetchProjects(deps, state, [state.focus.projectId]);
    }
  }

  let searchRecovery = evidence.searchRecovery;
  if (
    !searchRecovery &&
    (goal.kind === 'ack_reject_recommend' ||
      goal.kind === 'advance' ||
      (goal.kind === 'recommend' && ex.wantsMore)) &&
    (evidence.matches?.length ?? 0) > 0
  ) {
    const catalog = await deps.data.catalog(state.builderId).catch(() => emptyCatalog());
    searchRecovery = await planSearchRecovery({
      searchCount: async (filters) =>
        (await searchWithFilters(deps, state.builderId, filters)).matches.length,
      catalog,
      constraints: state.constraints,
      reason: 'Want to adjust your search?',
      maxActions: channel === 'whatsapp' ? 3 : 4,
      variant: 'widen',
    });
  }

  state = { ...state, turnCount: state.turnCount + 1 };
  state = appendTranscript(state, input.text, reply, deps.clock.nowMs());

  const uiMode = deriveAdvisorUiMode(state, goal, evidence, ex, searchRecovery);
  state = {
    ...state,
    rti: buildRtiStateUpdate({
      goal,
      evidence,
      searchRecovery,
      reply,
      uiMode,
      turnCount: state.turnCount,
    }),
  };

  if (goal.kind === 'visit_booked' && nd && goal.iso) {
    await deps.data
      .recordVisit(
        { ndConversationId: nd, buyerPhone: state.ndBuyerPhone ?? input.buyerPhone, builderId: state.builderId },
        {
          projectId: goal.projectId,
          projectName: goal.projectName,
          iso: goal.iso,
          label: goal.label,
        },
      )
      .catch(() => false);
  }

  await deps.store.save(state);
  await deps.store.logTurn({
    convId: state.convId,
    turnIndex: state.turnCount,
    buyerText: input.text,
    reply,
    phase: state.phase,
    goal: goal.kind,
    grounding,
  });

  await deps.crm.appendMessage(nd || input.convId, 'inbound', input.text).catch(() => {});
  await deps.crm.appendMessage(nd || input.convId, 'outbound', reply, { replyKey: goal.kind }).catch(() => {});
  await syncFacts(deps, nd, ex, goal, state, evidence, input.text).catch(() => {});
  await syncTelemetry(deps, nd, input, goal, evidence, state, reply).catch(() => {});

  const cappedRecovery = searchRecovery ? capRecoveryForChannel(searchRecovery, channel) : undefined;

  return {
    reply,
    state,
    debug: { phase: state.phase, goal, tools: evidence.tools, grounding },
    ...(evidence.compare?.matrix ? { compareMatrix: evidence.compare.matrix } : {}),
    ...(cappedRecovery ? { searchRecovery: cappedRecovery } : {}),
    uiMode,
    whatsappActions: whatsAppButtons(searchRecovery, channel),
  };
}

function decideGoal(
  s: ConversationState,
  ex: Extracted,
  visitCtx: visit.VisitCtx | null,
): TurnGoal {
  if (ex.recall) return { kind: 'visit_recall' };
  switch (s.phase) {
    case 'discover':
      return discover.decide(s, ex);
    case 'focused':
      return focused.decide(s, ex);
    case 'visit':
      return visit.decide(s, ex, visitCtx!);
    case 'handoff':
      return handoff.decide(ex);
    default:
      return { kind: 'greet' };
  }
}

async function decideGoalAsync(
  s: ConversationState,
  ex: Extracted,
  visitCtx: visit.VisitCtx | null,
  deps: EngineDeps,
  text: string,
): Promise<TurnGoal> {
  if (s.phase === 'focused') {
    const switchGoal = await resolveFocusedSwitchGoal(text, ex, s, deps);
    if (switchGoal) return switchGoal;
  }
  return decideGoal(s, ex, visitCtx);
}

async function fetchRecommend(
  base: TurnGoal,
  s: ConversationState,
  ex: Extracted,
  deps: EngineDeps,
): Promise<{ goal: TurnGoal; evidence: EvidenceSet }> {
  let filters = discover.searchFilters(s.constraints);
  const strictSearch = await searchWithFilters(deps, s.builderId, filters);

  const offeredIds = new Set(s.discover.lastOffered.map((o) => o.projectId));

  const rawMatches: Match[] = strictSearch.matches
    .map((m) => ({
      projectId: m.project_id,
      name: m.name,
      microMarket: m.micro_market,
      startingPriceInr: m.starting_price_inr,
      startingPriceDisplay: m.starting_price_display,
      matchReasons: m.match_reasons ?? [],
      projectType: m.project_type,
    }))
    .filter((m) => !s.discover.rejectedProjectIds.includes(m.projectId))
    .filter((m) => (ex.wantsMore ? !offeredIds.has(m.projectId) : true));

  const matches = discover.filterSearchMatches(rawMatches, s.constraints, s.discover.rejectedProjectIds);

  let scopedMatches = matches;
  const budgetOnlyTurn = ex.constraints.budgetMaxInr !== undefined && !ex.constraints.location;
  if ((ex.budgetFitQuestion || budgetOnlyTurn) && s.constraints.location && scopedMatches.length > 0) {
    scopedMatches = scopedMatches.filter((m) =>
      discover.matchMicroMarket(m.microMarket, s.constraints.location!),
    );
  }

  if (scopedMatches.length === 0 && filters.bhks) {
    const { bhks: _b, ...relaxed } = filters;
    const withoutBhk = await searchWithFilters(deps, s.builderId, relaxed);
    const withoutBhkRaw: Match[] = withoutBhk.matches.map((m) => ({
      projectId: m.project_id,
      name: m.name,
      microMarket: m.micro_market,
      startingPriceInr: m.starting_price_inr,
      startingPriceDisplay: m.starting_price_display,
      matchReasons: m.match_reasons ?? [],
      projectType: m.project_type,
    }));
    const gapEv = discover.buildConstraintGapEvidence(
      s.constraints,
      withoutBhkRaw,
      s.discover.rejectedProjectIds,
    );
    if (gapEv) {
      const catalog = await deps.data.catalog(s.builderId).catch(() => emptyCatalog());
      const searchRecovery = await planSearchRecovery({
        searchCount: async (f) => (await searchWithFilters(deps, s.builderId, f)).matches.length,
        catalog,
        constraints: s.constraints,
        reason: gapEv.noMatch?.reasoning ?? 'Configuration not available at this budget',
        maxActions: 6,
        variant: 'zero_match',
      });
      return {
        goal: { kind: 'no_fit' },
        evidence: { ...gapEv, searchRecovery },
      };
    }
  }

  if (scopedMatches.length === 0 && s.constraints.budgetMaxInr) {
    const { budgetMaxInr: _max, budgetMinInr: _min, ...noBudgetFilters } = filters;
    const broad = await searchWithFilters(deps, s.builderId, noBudgetFilters);
    const broadRaw: Match[] = broad.matches.map((m) => ({
      projectId: m.project_id,
      name: m.name,
      microMarket: m.micro_market,
      startingPriceInr: m.starting_price_inr,
      startingPriceDisplay: m.starting_price_display,
      matchReasons: m.match_reasons ?? [],
      projectType: m.project_type,
    }));
    const budgetEv = discover.buildBudgetNoFitEvidence(
      s.constraints,
      broadRaw,
      s.discover.rejectedProjectIds,
    );
    if (budgetEv) {
      const catalog = await deps.data.catalog(s.builderId).catch(() => emptyCatalog());
      const searchRecovery = await planSearchRecovery({
        searchCount: async (f) => (await searchWithFilters(deps, s.builderId, f)).matches.length,
        catalog,
        constraints: s.constraints,
        reason: budgetEv.noMatch?.reasoning ?? 'Budget too low for current filters',
        maxActions: 6,
        variant: 'zero_match',
      });
      return {
        goal: { kind: 'no_fit' },
        evidence: { ...budgetEv, searchRecovery },
      };
    }
  }

  if (scopedMatches.length > 0) {
    if (base.kind === 'recommend' && !ex.wantsMore && isSameAsLast(s, scopedMatches)) {
      const miss = s.discover.advancedOnce ? undefined : discover.firstMissingSlot(s);
      return {
        goal: { kind: 'advance', reason: 'same_set' },
        evidence: { tools: ['search'], matches: scopedMatches, ...(miss ? { nextSlot: miss } : {}) },
      };
    }
    return { goal: base, evidence: { tools: ['search'], matches: scopedMatches } };
  }

  const catalog = await deps.data.catalog(s.builderId).catch(() => emptyCatalog());
  const reasoning = `No exact match for ${[s.constraints.location, s.constraints.propertyType].filter(Boolean).join(' ') || 'those filters'}`;
  const resolved = discover.resolveRecommend(
    base,
    scopedMatches,
    catalog,
    s.constraints,
    s.discover.rejectedProjectIds,
    reasoning,
  );

  if (resolved.goal.kind === 'no_fit') {
    const searchRecovery = await planSearchRecovery({
      searchCount: async (filters) =>
        (await searchWithFilters(deps, s.builderId, filters)).matches.length,
      catalog,
      constraints: s.constraints,
      reason: resolved.evidence.noMatch?.reasoning ?? reasoning,
      maxActions: 6,
      variant: 'zero_match',
    });
    return {
      goal: resolved.goal,
      evidence: { ...resolved.evidence, searchRecovery },
    };
  }

  return resolved;
}

async function searchWithFilters(
  deps: EngineDeps,
  builderId: string,
  filters: import('./types.js').SearchFilters,
): Promise<{ matches: Array<{ project_id: string; name: string; micro_market: string; starting_price_inr: number; starting_price_display: string; match_reasons?: string[]; project_type?: string }> }> {
  return deps.data.search(builderId, filters).catch(() => ({ matches: [] }));
}

async function fetchObjection(
  goal: Extract<TurnGoal, { kind: 'objection' }>,
  s: ConversationState,
  deps: EngineDeps,
  nd: string,
): Promise<{ goal: TurnGoal; evidence: EvidenceSet }> {
  const ctx = nd ? await deps.data.objectionContext(nd).catch(() => null) : null;
  const count = (s.objectionCount ?? 0) + 1;
  const match = ctx?.playbooks.find((p) => p.topic === goal.topic);
  const threshold = match?.escalateAfter ?? 3;
  if (count >= threshold) {
    return { goal: { kind: 'handoff' }, evidence: { tools: ['objectionContext'] } };
  }
  return {
    goal,
    evidence: {
      tools: ['objectionContext'],
      objection: {
        topic: goal.topic,
        acknowledged: ackFor(goal.topic),
        reframeAngles: match?.reframeAngles ?? [],
      },
    },
  };
}

async function fetchAnswer(
  goal: Extract<TurnGoal, { kind: 'answer' }>,
  s: ConversationState,
  ex: Extracted,
  deps: EngineDeps,
  nd: string,
): Promise<EvidenceSet> {
  if (!nd) return { tools: [] };
  const unitType = s.constraints.bhk;
  const focusName = s.focus?.projectName ?? '';
  const topics = goal.topics?.length ? goal.topics : [goal.topic];
  const tools: string[] = [];
  let evidence: EvidenceSet = { tools };

  if (goal.topic === 'compare' || topics.includes('compare')) {
    const ids =
      ex.compareProjectIds && ex.compareProjectIds.length >= 2
        ? ex.compareProjectIds
        : compareIds(s);
    if (ids.length < 2) return { tools: [] };
    const cmp = await deps.data.compare(nd, ids).catch(() => null);
    if (!cmp) return { tools: [] };
    return {
      tools: ['compare'],
      compare: {
        tableText: cmp.tableText,
        projects: cmp.projects as CompareEvidence['projects'],
        ...(cmp.matrix ? { matrix: cmp.matrix } : {}),
      },
    };
  }

  if (topics.includes('price')) {
    const pricing = await deps.data.pricing(s.builderId, nd, goal.projectId, unitType).catch(() => null);
    if (pricing) {
      tools.push('pricing');
      evidence = {
        ...evidence,
        tools,
        pricing: { ...pricing, projectName: pricing.projectName || focusName },
      };
    }
  }

  if (topics.includes('emi')) {
    const basis = await deps.data.priceBasis(s.builderId, nd, goal.projectId, unitType).catch(() => null);
    if (basis) {
      const emi = computeEmi(
        basis.priceInr,
        ex.emiRatePercent ?? DEFAULT_RATE_PERCENT,
        ex.emiTenureYears ?? DEFAULT_TENURE_YEARS,
      );
      if (emi) {
        tools.push('priceBasis', 'emi');
        evidence = { ...evidence, tools: [...new Set(tools)], emi };
      }
    }
  }

  if (topics.includes('media') || ex.mediaAssetKind) {
    const assetKind = ex.mediaAssetKind ?? 'brochure';
    const media = await deps.data.mediaShare(nd, goal.projectId, assetKind, unitType).catch(() => null);
    if (media) {
      tools.push('mediaShare');
      evidence = {
        ...evidence,
        tools: [...new Set(tools)],
        media: { projectName: focusName, ...media },
      };
    }
  }

  if (topics.includes('availability')) {
    const cachedConfigs = s.projectCache?.[goal.projectId]?.configurations;
    if (cachedConfigs?.length) {
      tools.push('listUnits');
      evidence = {
        ...evidence,
        tools: [...new Set(tools)],
        units: cachedConfigs.map((c) => ({ unitType: c.unitType, priceDisplay: c.priceDisplay })),
      };
    } else {
      const units = await deps.data.listUnits(goal.projectId).catch(() => []);
      if (units.length) {
        tools.push('listUnits');
        evidence = {
          ...evidence,
          tools: [...new Set(tools)],
          units: units.map((u) => ({ unitType: u.unitType, priceDisplay: u.priceDisplay })),
        };
      }
    }
  }

  if (topics.includes('amenities')) {
    const faq = await deps.data.faqLookup(goal.projectId, 'amenities').catch(() => null);
    if (faq) {
      tools.push('faqLookup');
      evidence = {
        ...evidence,
        tools: [...new Set(tools)],
        detail: {
          ...(evidence.detail ?? {
            projectId: goal.projectId,
            name: focusName,
            microMarket: '',
          }),
          faqs: [{ questionKey: 'amenities', question: faq.question, answer: faq.answer }],
        },
      };
    }
  }

  const needsDetail = topics.some((t) =>
    t === 'legal' ||
    t === 'overview' ||
    t === 'amenities' ||
    t === 'location' ||
    t === 'availability' ||
    t === 'property_type',
  );
  if (needsDetail) {
    let detail = await hydrateProjectDetail(deps, s, goal.projectId);
    if (detail && topics.includes('legal')) {
      detail = await enrichDetailLegal(deps, nd, detail);
    }
    if (detail) {
      tools.push('detail');
      evidence = { ...evidence, tools: [...new Set(tools)], detail };
    }
    if (topics.includes('location') && detail) {
      tools.push('location');
      evidence = {
        ...evidence,
        tools: [...new Set(tools)],
        location: buildLocationEvidence(detail),
      };
    }
  }

  return evidence;
}

function buildLocationEvidence(detail: NonNullable<Awaited<ReturnType<EngineDeps['data']['projectDetail']>>>) {
  const loc = detail.location;
  return {
    projectName: detail.name,
    microMarket: detail.microMarket,
    ...(loc?.connectivitySummary ? { connectivitySummary: loc.connectivitySummary } : {}),
    ...(loc?.microMarketOverview ? { microMarketOverview: loc.microMarketOverview } : {}),
    ...(loc?.nearbyPois?.length ? { nearbyPois: loc.nearbyPois } : {}),
    ...(loc?.driveTimes?.length ? { driveTimes: loc.driveTimes } : {}),
    ...(!loc?.connectivitySummary && !loc?.microMarketOverview && detail.summary
      ? { microMarketOverview: detail.summary }
      : {}),
  };
}

async function fetchVisitRecall(
  s: ConversationState,
  deps: EngineDeps,
  nd: string,
): Promise<EvidenceSet> {
  if (!nd) return { tools: [] };
  const visits = await deps.data.siteVisitsItinerary(nd).catch(() => []);
  const builder = await deps.data.builder(s.builderId).catch(() => null);
  return {
    tools: ['siteVisitsItinerary'],
    visits: {
      visits: visits.map((v) => ({
        projectName: v.projectName,
        label: v.label,
        confirmed: v.confirmed,
      })),
      siteVisitHours: builder?.siteVisitHours,
    },
  };
}

async function enrichDetailLegal(
  deps: EngineDeps,
  nd: string,
  detail: NonNullable<Awaited<ReturnType<EngineDeps['data']['projectDetail']>>>,
): Promise<NonNullable<Awaited<ReturnType<EngineDeps['data']['projectDetail']>>>> {
  if (detail.reraNumber?.trim()) return detail;
  const ctx = await deps.data.conversationContext(nd).catch(() => null);
  const rera = ctx?.project?.rera_number?.trim();
  if (rera) return { ...detail, reraNumber: rera };
  return detail;
}

async function fetchEvidence(goal: TurnGoal, s: ConversationState, deps: EngineDeps): Promise<EvidenceSet> {
  if (goal.kind === 'orient') {
    const catalog = await deps.data.catalog(s.builderId).catch(() => emptyCatalog());
    return { tools: ['catalog'], catalog };
  }
  if (goal.kind === 'probe' && goal.slot === 'location' && s.constraints.location) {
    const areas = await deps.data.geoAreasInRegion(s.constraints.location, s.builderId).catch(() => []);
    if (areas.length) {
      return {
        tools: ['geoAreasInRegion'],
        noMatch: { reasoning: `Areas we serve near ${s.constraints.location}`, nearby: areas.map((a) => a.name) },
      };
    }
  }
  return { tools: [] };
}

function compareIds(s: ConversationState): string[] {
  const ids = s.discover.lastOffered.map((o) => o.projectId);
  if (s.focus && !ids.includes(s.focus.projectId)) ids.unshift(s.focus.projectId);
  return ids.slice(0, 3);
}

function applyGoalToState(s: ConversationState, goal: TurnGoal, ev: EvidenceSet): ConversationState {
  switch (goal.kind) {
    case 'commit':
      return commitTo(s, goal.projectId, goal.projectName);
    case 'recommend':
    case 'ack_reject_recommend':
      return ev.matches?.length ? recordOffered(s, ev.matches) : s;
    case 'advance': {
      const r = ev.matches?.length ? recordOffered(s, ev.matches) : s;
      return { ...r, discover: { ...r.discover, advancedOnce: true } };
    }
    case 'no_fit':
      return s;
    case 'objection':
      return incObjection(s);
    case 'orient':
      return markOriented(s);
    case 'probe':
      return markAsked(s, goal.slot);
    case 'propose_visit':
      return { ...s, phase: 'visit' };
    case 'visit_ask':
    case 'visit_propose':
      return { ...s, phase: 'visit', visit: goal.state };
    case 'visit_booked':
      return applyVisitBooked(s);
    case 'warm_ack':
      return { ...s, postVisitAckPending: false };
    case 'handoff':
      return { ...s, phase: 'handoff' };
    default:
      return s;
  }
}

function needsStructuredRepair(goal: TurnGoal, ev: EvidenceSet, reply: string): boolean {
  if (goal.kind !== 'answer') return false;
  const topics = goal.topics?.length ? goal.topics : [goal.topic];
  if (topics.includes('legal') && ev.detail?.reraNumber && !/rera/i.test(reply)) return true;
  if (topics.includes('price') && ev.pricing) {
    const hasComponent = ev.pricing.components.some((c) => reply.includes(c.value));
    const hasStart = ev.pricing.startingDisplay ? reply.includes(ev.pricing.startingDisplay) : false;
    if (!hasComponent && !hasStart) return true;
  }
  if (goal.topic === 'compare' && ev.compare?.tableText && !ev.compare.projects.some((p) => p.name && reply.includes(p.name))) {
    return true;
  }
  if (topics.length === 1 && goal.topic === 'price' && ev.pricing) {
    const hasComponent = ev.pricing.components.some((c) => reply.includes(c.value));
    const hasStart = ev.pricing.startingDisplay ? reply.includes(ev.pricing.startingDisplay) : false;
    return !hasComponent && !hasStart;
  }
  return false;
}

async function syncFacts(
  deps: EngineDeps,
  nd: string,
  ex: Extracted,
  goal: TurnGoal,
  s: ConversationState,
  ev: EvidenceSet,
  buyerText: string,
): Promise<void> {
  if (!nd) return;
  const facts: Record<string, string | undefined> = {};
  if (ex.nameIntro) facts.buyer_name = ex.nameIntro;
  if (s.constraints.bhk) facts.bhk_preference = s.constraints.bhk;
  if (s.constraints.budgetMaxInr) facts.budget_inr = formatInr(s.constraints.budgetMaxInr);
  if (s.constraints.location) facts.location_pref = s.constraints.location;
  if (s.constraints.purpose) facts.purpose = s.constraints.purpose;
  if (goal.kind === 'visit_booked') facts.visit_date_pref = goal.label;
  if (Object.keys(facts).length) await deps.crm.updateFacts(nd, facts);

  if ((goal.kind === 'recommend' || goal.kind === 'ack_reject_recommend') && ev.matches?.length) {
    await deps.crm.syncShortlist(nd, ev.matches.map((m) => m.projectId));
    await deps.crm.syncMatching(nd, ev.matches.map((m) => m.projectId));
    await deps.crm.postChoiceEvent(
      s.builderId,
      s.ndBuyerPhone ?? '',
      nd,
      ev.matches.map((m) => ({ projectId: m.projectId, name: m.name })),
      s.constraints as Record<string, unknown>,
    );
  }
  if (ex.rejected) {
    await deps.crm.postChoiceResponse(nd, buyerText, 'rejected').catch(() => {});
    const rejectedId = s.discover.rejectedProjectIds.at(-1);
    if (rejectedId) {
      await deps.crm.postJourneySignals(s.builderId, s.ndBuyerPhone ?? '', nd, { rejected: true }, { rejectedAdd: [rejectedId] });
    }
  }
  if (goal.kind === 'answer' && s.focus) {
    const topic = goal.topics?.[0] ?? goal.topic;
    const factKind = answerFactKind(topic);
    if (factKind) await deps.crm.appendSharedFact(nd, factKind, s.focus.projectId, s.turnCount);
  }
  if (goal.kind === 'visit_booked') await deps.crm.setStage(nd, 'visit_booked');
  if (goal.kind === 'handoff') await deps.crm.setStage(nd, 'escalated');
}

function answerFactKind(topic: string): string | null {
  switch (topic) {
    case 'price':
      return 'pricing';
    case 'legal':
      return 'legal';
    case 'location':
      return 'location';
    case 'amenities':
      return 'amenities';
    case 'availability':
      return 'availability';
    case 'media':
      return 'brochure_link';
    default:
      return null;
  }
}

async function syncTelemetry(
  deps: EngineDeps,
  nd: string,
  input: EngineTurnInput,
  goal: TurnGoal,
  evidence: EvidenceSet,
  state: ConversationState,
  reply: string,
): Promise<void> {
  if (!nd) return;
  const buyerPhone = state.ndBuyerPhone ?? input.buyerPhone;
  await deps.crm.appendTurnLedger({
    conversationId: nd,
    turnIndex: state.turnCount,
    builderId: state.builderId,
    buyerPhone,
    buyerText: input.text,
    reply,
    goal: goal.kind,
    tools: evidence.tools,
    offeredProjectIds: evidence.matches?.map((m) => m.projectId),
    phase: state.phase,
  });

  await deps.crm.postJourneyTurnSnapshot(state.builderId, buyerPhone, nd, goal.kind, state.phase);

  const observations: Array<{ fact_key: string; value: unknown; provenance: string }> = [];
  if (state.constraints.location) observations.push({ fact_key: 'location_pref', value: state.constraints.location, provenance: 'extractor' });
  if (state.constraints.budgetMaxInr) observations.push({ fact_key: 'budget_inr', value: state.constraints.budgetMaxInr, provenance: 'extractor' });
  if (state.constraints.bhk) observations.push({ fact_key: 'bhk_preference', value: state.constraints.bhk, provenance: 'extractor' });
  if (state.constraints.purpose) observations.push({ fact_key: 'purpose', value: state.constraints.purpose, provenance: 'extractor' });
  if (observations.length) {
    await deps.crm.postProfileObservations(state.builderId, buyerPhone, nd, observations);
  }

  const signals: Record<string, unknown> = { phase: state.phase, goal: goal.kind };
  if (goal.kind === 'commit') signals.committed_project_id = goal.projectId;
  if (goal.kind === 'visit_booked') signals.visit_booked = true;
  if (goal.kind === 'handoff') signals.escalated = true;
  await deps.crm.postJourneySignals(state.builderId, buyerPhone, nd, signals);

  await deps.crm.mirrorMemory(nd);
}

function ackFor(topic: ObjectionTopic): string {
  switch (topic) {
    case 'price':
      return 'I hear you on the price';
    case 'location':
      return 'I get the location concern';
    case 'timeline':
      return 'I understand the timeline matters';
    case 'legal':
      return 'Totally fair to want the legal side clear';
    default:
      return 'I hear you';
  }
}

function friendlyBuilder(builderId: string): string {
  return builderId.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function emptyCatalog(): CatalogEnvelope {
  return { priceMinInr: 0, priceMaxInr: 0, projectTypes: [], microMarkets: [], total: 0, sample: [] };
}

export type { AdvisorUiMode } from './recovery-planner.js';

function deriveAdvisorUiMode(
  state: import('./types.js').ConversationState,
  goal: import('./types.js').TurnGoal,
  evidence: import('./types.js').EvidenceSet,
  ex: import('./types.js').Extracted,
  searchRecovery?: SearchRecoveryEnvelope,
): AdvisorUiMode {
  if (state.phase === 'focused') return 'focused';

  const matchCount = evidence.matches?.length ?? 0;
  const hasShortlist = state.discover.lastOffered.length > 0;

  if (goal.kind === 'no_fit' || searchRecovery?.mode === 'search_recovery') {
    return 'search_recovery';
  }
  if (
    searchRecovery?.mode === 'preference_refine' ||
    goal.kind === 'ack_reject_recommend' ||
    goal.kind === 'advance' ||
    (ex.wantsMore && hasShortlist)
  ) {
    return 'preference_refine';
  }
  if (matchCount > 0 || hasShortlist) return 'matches_hub';
  if (!state.discover.oriented || !discover.hasNarrowingConstraint(state.constraints)) {
    return 'brief_collect';
  }
  return 'search_recovery';
}

function storedSearchRecovery(state: ConversationState): SearchRecoveryEnvelope | undefined {
  const actions = state.rti?.lastSuggestedActions;
  if (!actions?.length) return undefined;
  return {
    mode: state.rti?.lastUiMode === 'preference_refine' ? 'preference_refine' : 'search_recovery',
    reason: 'Adjust your search?',
    constraints: constraintsSnapshot(state.constraints),
    suggested_actions: actions,
  };
}

function capRecoveryForChannel(
  recovery: SearchRecoveryEnvelope,
  channel: TurnIntentChannel,
): SearchRecoveryEnvelope {
  if (channel !== 'whatsapp') return recovery;
  return {
    ...recovery,
    suggested_actions: recovery.suggested_actions.slice(0, 3),
  };
}

function whatsAppButtons(
  recovery: SearchRecoveryEnvelope | undefined,
  channel: TurnIntentChannel,
): SuggestedAction[] | undefined {
  if (channel !== 'whatsapp' || !recovery?.suggested_actions.length) return undefined;
  return recovery.suggested_actions.slice(0, 3);
}

type CompareEvidence = import('./types.js').CompareEvidence;
