/**
 * ConverseEngine — the turn kernel.
 * extract → merge → phase transition → goal → evidence → compose → verify → persist
 */
import * as discover from './phases/discover.js';
import * as focused from './phases/focused.js';
import * as visit from './phases/visit.js';
import { exitVisitPhase, isVisitFollowUpQuestion, shouldExitVisitForIntent } from './phases/visit.js';
import { isVisitDayUtterance } from './visit-slot.js';
import * as handoff from './phases/handoff.js';
import { buildTurnLogSnapshot } from '../observability/turn-log-snapshot.js';
import { extractTurnAuthority } from './extract-authority.js';
import { hydrateStateFromFeedForward, mapLedgerPrior } from './ledger-read.js';
import { extractDisclosedFacts, hasDisclosedRera, mergeDisclosedFacts } from './disclosed-facts.js';
import { buildLedgerWritePayload } from './ledger-write.js';
import type { ExtractProvenance, IngressSlotKey, TurnInputSource } from './ingress.js';
import { resolveInputSource } from './ingress.js';
import {
  detectTypeComparisonKnowledge,
  isConstraintRefinementTurn,
  isCostComponentAsk,
  isDetailAskTurn,
  isLocationBroadenTurn,
  isLocationCorrectionTurn,
  isMinimumBudgetForTypeQuestion,
  detectPropertyTypes,
  locationCategoriesAsked,
  locationEchoesProjectName,
  locationLooksPolluted,
  resolveCatalogNameHit,
  wantsCostBreakdown,
} from './facts.js';
import { buildJourneySignalPost, deskFactProvenance } from './journey-signals.js';
import { isFaqShapedAsk, resolveFaqQuestionKeys, taughtFaqKey } from './faq-keys.js';
import { buyerCuedOtherProject } from './project_switch.js';
import { resolveCompareProjectIds } from './compare_resolve.js';
import {
  isCompareAmongOfferedTurn,
  prepareCompareExtracted,
  shouldAllowBudgetGapNoFit,
} from './turn-intent/compare-intent.js';
import { matchesFromLastOffered } from './matches-from-offered.js';
import { advisorSearchPrefs, importanceFromConstraints } from './advisor-weights.js';
import { resolveFocusedSwitchGoal } from './project_switch.js';
import { driveLeg, haversineDriveMinutes } from './trip-logistics.js';
import { catalogFromProjectCoords, projectGeo } from './project-geo.js';
import {
  applyExtracted,
  applyVisitBooked,
  appendTranscript,
  clearLastOffered,
  commitTo,
  constraintsMateriallyChanged,
  incObjection,
  initState,
  isSameAsLast,
  markAsked,
  markOriented,
  recordDiscussed,
  recordOffered,
  releaseToDiscover,
  withNdConversation,
} from './state.js';
import { buildComposeRequest, componentsForAsk, fallbackReply, formatInr, minimumBudgetReply, typeComparisonReply } from './compose.js';
import { checkGrounding, stripBanned, stripComposerDirectives } from './grounding.js';
import { computeEmi, DEFAULT_RATE_PERCENT, DEFAULT_TENURE_YEARS } from './emi.js';
import { hydrateProjectDetail, prefetchProjects, projectIdsFromMatches } from './project-cache.js';
import { filterUnitsByBhk, resolveAvailabilityBhkFilter } from './unit-config.js';
import { planSearchRecovery, type RecoveryHint, type SearchRecoveryEnvelope, type AdvisorUiMode, type SuggestedAction } from './recovery-planner.js';
import {
  applyTurnIntentResult,
  buildTurnIntentInput,
  focusedUiMode,
  recoveryUiMode,
  shouldRunTurnIntent,
} from './turn-intent/classify.js';
import { buildRtiStateUpdate, excerptReply } from './turn-intent/pending-prompt.js';
import { extractRecoveryPatchFromText } from './turn-intent/extract-recovery-patch.js';
import { classifyTurnRouting } from './turn-routing/classify.js';
import { silDecision } from '../understanding/capture.js';
import { buildTurnRoutingInput, type TurnRoutingResult } from './turn-routing/types.js';
import type { PatchClearKey, TurnIntentChannel } from './turn-intent/types.js';
import { constraintsSnapshot } from './recovery-planner.js';
import type {
  CatalogEnvelope,
  ComposeRequest,
  ConversationState,
  EvidenceSet,
  Extracted,
  LocationCategoryKey,
  LocationEvidence,
  Match,
  ObjectionTopic,
  OfferedProject,
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
  /** Slots pre-filled by advisor UI this turn — extract skips re-parsing them. */
  ingressFilledSlots?: IngressSlotKey[];
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
  const inputSource = resolveInputSource(input.action_id);

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
      debug: withIngressDebug({ phase: state.phase, goal: { kind: 'smalltalk' }, tools: [], grounding: 'pass' }, inputSource),
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
      // P2b — gap-fill RTI / focus from ledger prior (live KV wins).
      state = hydrateStateFromFeedForward(state, mapLedgerPrior(boot.ledgerPrior));
      // P2c — merge ledger disclosed into session accum.
      if (state.feedForward?.disclosedFacts?.length) {
        state = {
          ...state,
          disclosedFacts: mergeDisclosedFacts(state.disclosedFacts, state.feedForward.disclosedFacts),
        };
      }
    }
  }

  const channel: TurnIntentChannel = input.channel ?? 'whatsapp';
  const ingressFilled = new Set<IngressSlotKey>(input.ingressFilledSlots ?? []);
  const uiModeHint = state.phase === 'focused' ? focusedUiMode(state) : recoveryUiMode(state);
  const clearedKeys = new Set<PatchClearKey>(input.preferenceClears ?? []);

  if (isMinimumBudgetForTypeQuestion(trimmedText) && shouldRunTurnIntent(state, input.action_id, trimmedText)) {
    const typeRaw = detectPropertyTypes(trimmedText) || state.constraints.propertyType;
    if (typeRaw) {
      const floor = await discover.cheapestMatchForPropertyType(
        (f) => searchWithFilters(deps, state.builderId, f),
        typeRaw,
      );
      if (floor) {
        const prePatch = extractRecoveryPatchFromText(trimmedText, recoveryUiMode(state));
        if (prePatch) {
          const preApplied = applyTurnIntentResult(state, prePatch, state.rti?.lastSuggestedActions ?? []);
          state = preApplied.state;
        }
        const typeLabel = discover.displayPropertyTypeLabel(typeRaw);
        const reply = minimumBudgetReply(typeLabel, floor, state.constraints.budgetMaxInr);
        const searchRecovery = await freshSearchRecovery(deps, state, channel, 'property_type');
        const cappedRecovery = capRecoveryForChannel(searchRecovery, channel);
        state = {
          ...state,
          turnCount: state.turnCount + 1,
          rti: {
            ...state.rti,
            lastSuggestedActions: searchRecovery.suggested_actions,
            lastReplyExcerpt: excerptReply(reply),
            lastUiMode: 'search_recovery',
            lastGoalKind: 'no_fit',
            lastEvidenceKind: 'property_type_gap',
            ...(cappedRecovery.suggested_actions.length
              ? {
                  pendingPrompt: {
                    kind: 'chip_menu',
                    chip_ids: cappedRecovery.suggested_actions.map((a) => a.id),
                    asked_at_turn: state.turnCount,
                  },
                }
              : {}),
          },
        };
        state = appendTranscript(state, trimmedText, reply, deps.clock.nowMs());
        await deps.store.save(state);
        await deps.crm.appendMessage(nd || input.convId, 'inbound', input.text).catch(() => {});
        await deps.crm.appendMessage(nd || input.convId, 'outbound', reply, { replyKey: 'type_floor' }).catch(() => {});
        return {
          reply,
          state,
          debug: withIngressDebug(
            { phase: state.phase, goal: { kind: 'no_fit' }, tools: ['search'], grounding: 'pass' },
            inputSource,
          ),
          searchRecovery: cappedRecovery,
          uiMode: 'search_recovery' as AdvisorUiMode,
          whatsappActions: whatsAppButtons(searchRecovery, channel),
        };
      }
    }
  }

  let recoveryChipTurn = false;
  let focusPivotTurn = false;
  let rtiFocusCommitted: { projectId: string; projectName: string } | undefined;
  let rtiSeedAskTopic: import('./types.js').AnswerTopic | undefined;

  if (deps.turnIntent && shouldRunTurnIntent(state, input.action_id, trimmedText)) {
    const intentInput = buildTurnIntentInput(state, trimmedText, channel, uiModeHint, input.action_id);
    const intent = await deps.turnIntent.classify(intentInput);
    const applied = applyTurnIntentResult(state, intent, intentInput.suggested_actions);
    state = applied.state;
    for (const k of applied.clearedKeys) clearedKeys.add(k);
    if (intent.kind === 'apply_recovery_patch') {
      recoveryChipTurn = true;
    }
    if (applied.seedAskTopic) {
      rtiSeedAskTopic = applied.seedAskTopic;
    }

    if (applied.focusCommitted) {
      rtiFocusCommitted = applied.focusCommitted;
    }

    if (applied.releasedFocus) {
      focusPivotTurn = true;
      if (nd) await deps.crm.releaseProject(nd).catch(() => {});
    }

    if (applied.probeReply) {
      let searchRecovery = storedSearchRecovery(state);
      if (!searchRecovery?.suggested_actions.length) {
        searchRecovery = await freshSearchRecovery(deps, state, channel);
      }
      const cappedRecovery = capRecoveryForChannel(searchRecovery, channel);
      const reply = applied.probeReply;
      state = {
        ...state,
        turnCount: state.turnCount + 1,
        rti: {
          ...state.rti,
          lastSuggestedActions: searchRecovery.suggested_actions,
          ...(cappedRecovery.suggested_actions.length
            ? {
                pendingPrompt: {
                  kind: 'chip_menu',
                  chip_ids: cappedRecovery.suggested_actions.map((a) => a.id),
                  asked_at_turn: state.turnCount,
                },
              }
            : {}),
          lastReplyExcerpt: excerptReply(reply),
          lastUiMode: 'search_recovery',
        },
      };
      state = appendTranscript(state, trimmedText, reply, deps.clock.nowMs());
      await deps.store.save(state);
      await deps.crm.appendMessage(nd || input.convId, 'inbound', input.text).catch(() => {});
      await deps.crm.appendMessage(nd || input.convId, 'outbound', reply, { replyKey: 'rti_probe' }).catch(() => {});
      const uiMode: AdvisorUiMode =
        searchRecovery.mode === 'preference_refine' ? 'preference_refine' : 'search_recovery';
      return {
        reply,
        state,
        debug: withIngressDebug(
          { phase: state.phase, goal: { kind: 'no_fit' }, tools: [], grounding: 'pass' },
          inputSource,
        ),
        searchRecovery: cappedRecovery,
        uiMode,
        whatsappActions: whatsAppButtons(searchRecovery, channel),
      };
    }
  }

  if (rtiFocusCommitted) {
    return completeRtiFocusCommit(state, rtiFocusCommitted, input, deps, nd, trimmedText);
  }

  const catalogForNlu = await deps.data.catalog(state.builderId).catch(() => null);
  const extractResult = await extractTurnAuthority(trimmedText, state, state.builderId, {
    llm: deps.llm,
    semantic: deps.semantic,
    microMarkets: catalogForNlu?.microMarkets ?? [],
    ...(deps.bamlExtract ? { bamlExtract: deps.bamlExtract, bamlMode: deps.bamlMode ?? 'off' } : {}),
  }, {
    inputSource,
    ingressFilledSlots: ingressFilled,
    actionId: input.action_id,
  });
  let ex = extractResult.extracted;
  const extractProvenance = extractResult.provenance;

  // Trade-off soft signals (priority / hub / schools / worries) are advisor-web
  // only. detectSoftPrefs still runs in facts for the location-pollution guard,
  // but WA must not persist those fields or fire Desk preference re-rank.
  if (channel !== 'advisor_web') {
    const hardConstraints = { ...ex.constraints };
    delete hardConstraints.priorityFocus;
    delete hardConstraints.commuteHub;
    delete hardConstraints.schoolsMentioned;
    delete hardConstraints.worries;
    ex = { ...ex, constraints: hardConstraints };
  }

  // P4-CTA: RTI seeded topic (e.g. price after offer_pricing → yes) wins over bare affirm.
  if (rtiSeedAskTopic) {
    ex = {
      ...ex,
      askTopic: rtiSeedAskTopic,
      askTopics: [rtiSeedAskTopic],
      affirm: undefined,
    };
  }

  if (isCompareAmongOfferedTurn(trimmedText) && state.discover.lastOffered.length >= 2) {
    if (state.phase === 'focused' || state.phase === 'handoff') {
      if (nd && state.focus) await deps.crm.releaseProject(nd).catch(() => {});
      state = releaseToDiscover(state);
    }
  }

  ex = prepareCompareExtracted(trimmedText, state, ex);
  // Named multi-project turns without the word "compare" still need compare IDs —
  // but not on a fresh search board (embedder names are not a shortlist).
  const freshSearchBoard =
    state.discover.lastOffered.length === 0 &&
    !state.focus &&
    (discover.hasNarrowingConstraint(state.constraints) ||
      discover.hasNarrowingConstraint(ex.constraints) ||
      Boolean(ex.speechAct === 'search'));
  if (
    !freshSearchBoard &&
    !(ex.compareProjectIds && ex.compareProjectIds.length >= 2) &&
    (ex.namedProjects?.length ?? 0) >= 2
  ) {
    ex = {
      ...ex,
      askTopic: ex.askTopic ?? 'compare',
      askTopics: ex.askTopics?.includes('compare')
        ? ex.askTopics
        : (['compare', ...(ex.askTopics ?? [])] as Extracted['askTopics']),
      compareProjectIds: ex.namedProjects!.slice(0, 3).map((p) => p.projectId),
    };
  }
  ex = {
    ...ex,
    compareProjectIds:
      ex.compareProjectIds && ex.compareProjectIds.length >= 2
        ? ex.compareProjectIds
        : resolveCompareProjectIds(trimmedText, ex, state),
  };
  if (recoveryChipTurn || focusPivotTurn) {
    ex = {
      ...ex,
      askTopic: undefined,
      askTopics: [],
      transition: 'none',
      isQuestion: false,
      budgetFitQuestion: undefined,
      budgetPickQuestion: undefined,
      forceRecommendList: true,
      ...(focusPivotTurn ? { wantsMore: true } : {}),
    };
  }
  // W2: location/budget/BHK correction must re-search, not stay on focused facet path.
  if (isLocationCorrectionTurn(trimmedText) || isConstraintRefinementTurn(trimmedText)) {
    ex = {
      ...ex,
      speechAct: 'search',
      forceRecommendList: true,
      askTopic: undefined,
      askTopics: [],
      transition: 'none',
    };
  }
  // S1 — POI ask about a known project ("schools near Brigade Eldorado?"):
  // the LLM extractor reads it as a search move; it's a location facet ask on
  // the focused project (or a named/just-discussed one — the discover facet
  // path commits it with followUp=location). Demote ONLY when the ask
  // introduces no new locality — "schools in Whitefield?" still searches.
  if (ex.speechAct === 'search' && locationCategoriesAsked(trimmedText).length > 0) {
    const anchorNames = [
      ...(state.phase === 'focused' && state.focus ? [state.focus.projectName] : []),
      ...(ex.namedProjects ?? []).map((p) => p.name),
      ...state.discover.lastOffered.map((o) => o.name),
      ...(state.discover.discussedProjects ?? []).map((p) => p.name),
    ].filter(Boolean);
    const noNewLocality =
      !ex.constraints.location || locationEchoesProjectName(ex.constraints.location, anchorNames);
    if (anchorNames.length > 0 && noNewLocality) {
      const named = ex.namedProjects?.length === 1 ? ex.namedProjects[0] : undefined;
      ex = {
        ...ex,
        speechAct: 'answer',
        askTopic: ex.askTopic ?? 'location',
        askTopics: ex.askTopics?.includes('location')
          ? ex.askTopics
          : (['location', ...(ex.askTopics ?? [])] as Extracted['askTopics']),
        forceRecommendList: false,
        wantsMore: false,
        transition: 'none',
        ...(named && state.phase !== 'focused' && !ex.pickName ? { pickName: named.name } : {}),
      };
    }
  }
  // S1 — "schools near Brigade Eldorado": a location capture that echoes the
  // focused (or just-offered) project's name is a project reference, not a
  // location move. Stripping it here keeps focus (no releaseToDiscover) and
  // keeps the constraint clean for later searches.
  if (ex.constraints.location) {
    const knownNames = [
      ...(state.focus?.projectName ? [state.focus.projectName] : []),
      ...state.discover.lastOffered.map((o) => o.name),
    ];
    if (knownNames.length) {
      const kept = ex.constraints.location
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
        .filter((l: string) => !locationEchoesProjectName(l, knownNames));
      const { location: _loc, ...restConstraints } = ex.constraints;
      ex = {
        ...ex,
        constraints: kept.length ? { ...restConstraints, location: kept.join(', ') } : restConstraints,
      };
    }
  }

  // AB-4 — focus type-freeze: while focused, a property-type word INSIDE a facet
  // question ("can I customize the villa?", "is there a corner plot premium?",
  // "schools near the villa project?") is describing the focused project, not a
  // request to re-search that type. detectPropertyTypes still fires on it, and the
  // fresh propertyType delta (plus wantsMore) flips the turn into a recommend and
  // drops focus — the buyer's facet question is answered with a project list.
  // Neutralise those re-search signals so the focused answer survives. A genuine
  // pivot ("show me villas instead") releases focus upstream (focusPivotTurn) or
  // arrives as see_others; an explicit refine verb ("actually, make it a villa")
  // trips isConstraintRefinementTurn. Both bypass this and still re-search.
  if (
    state.phase === 'focused' &&
    state.focus &&
    !focusPivotTurn &&
    ex.constraints.propertyType &&
    isDetailAskTurn(ex) &&
    !isConstraintRefinementTurn(trimmedText)
  ) {
    const { propertyType: _pt, ...restC } = ex.constraints;
    ex = {
      ...ex,
      constraints: restC,
      forceRecommendList: false,
      wantsMore: false,
      ...(ex.askTopic ? {} : { askTopic: (ex.askTopics ?? []).find((t) => t !== 'compare') }),
    };
  }

  // AB-8 — multi-intent: an LI-category intent ("…AND are there good schools?")
  // that detectTopics/BAML did not surface as a `location` topic. Add it once here,
  // at the FINAL ex (after regex + BAML merge), so the second atom reaches compose.
  // Only when another topic is already present — a lone "schools near X" keeps its
  // S1 focused-LI path. Location-family FAQ keys resolve from buyerText regardless.
  if (
    (ex.askTopics?.length ?? 0) >= 1 &&
    !ex.askTopics?.includes('location') &&
    locationCategoriesAsked(trimmedText).length > 0
  ) {
    ex = { ...ex, askTopics: [...(ex.askTopics ?? []), 'location'] };
  }

  const prevConstraints = state.constraints;
  const prevLoc = state.constraints.location;
  state = applyExtracted(state, ex, clearedKeys);

  // W2: constraint pivot invalidates stale shortlist — no catalog names; delta-driven.
  if (
    state.discover.lastOffered.length > 0 &&
    shouldInvalidateLastOffered(prevConstraints, state.constraints, trimmedText, ex)
  ) {
    state = clearLastOffered(state);
  }

  const routing = await classifyTurnRouting(deps.routingEnv, buildTurnRoutingInput(state, ex, trimmedText));
  // SIL Phase 0 — surface the semantic-layer verdict per turn in the debug
  // channel that survives the /chat route re-shape (LLD §3.3).
  if (extractProvenance && routing.bind) {
    extractProvenance.routing_bind = routing.bind;
  }
  state = {
    ...state,
    rti: {
      ...state.rti,
      lastRouting: routing,
    },
  };

  const locationBroaden =
    !isDetailAskTurn(ex) &&
    (isLocationBroadenTurn(trimmedText) ||
      isLocationCorrectionTurn(trimmedText) ||
      Boolean(state.constraints.location && state.constraints.location !== prevLoc));
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
      debug: withIngressDebug(
        { phase: 'handoff', goal: { kind: 'handoff' }, tools: ['deleteBuyerMemory'], grounding: 'pass' },
        inputSource,
      ),
    };
  }

  // AB-7 — a property-TYPE knowledge ask ("apartment or plot — what's the
  // difference?", "which is better for investment?") is definitional/advisory, not a
  // search. Answer with the generic type taxonomy instead of dumping a project list.
  // Not gated on phase — it's a valid question whether focused or discovering. But an
  // ask that ALSO names a place or budget ("compare apartments and plots in Whitefield",
  // "…under 1 Cr") wants a shortlist, not a generic taxonomy — let it fall to search
  // (review AB-7).
  const typeKnowledge =
    ex.constraints.location || ex.constraints.budgetMaxInr !== undefined
      ? null
      : detectTypeComparisonKnowledge(trimmedText);
  if (typeKnowledge) {
    const reply = typeComparisonReply(typeKnowledge.types, typeKnowledge.investment);
    state = { ...state, turnCount: state.turnCount + 1 };
    state = appendTranscript(state, trimmedText, reply, deps.clock.nowMs());
    await deps.store.save(state);
    if (nd) {
      await deps.crm.appendMessage(nd, 'inbound', input.text).catch(() => {});
      await deps.crm.appendMessage(nd, 'outbound', reply, { replyKey: 'type_knowledge' }).catch(() => {});
    }
    return {
      reply,
      state,
      debug: withIngressDebug(
        { phase: state.phase, goal: { kind: 'answer', topic: 'property_type', projectId: '' }, tools: ['knowledge'], grounding: 'pass' },
        inputSource,
        extractProvenance,
      ),
    };
  }

  if (
    state.phase === 'focused' &&
    (ex.transition === 'see_others' || (ex.wantsMore && !ex.askTopic && ex.transition !== 'want_details'))
  ) {
    if (nd) await deps.crm.releaseProject(nd).catch(() => {});
    state = releaseToDiscover(state);
  }
  // P2: search brief + visit with empty board → stay discover and recommend first.
  // Do not enter visit on embedder-named noise before a shortlist exists.
  // W8/holds: a hold ask ("hold a 2 bhk for me") must NEVER flip to the visit
  // phase — the real embedder classifies "hold" as want_visit, which stole the
  // turn from the hold gate on dev (unit tests missed it: the fake NLU doesn't
  // set that transition). holdIntent already excludes visit words, so holdAsk
  // is an unambiguous "hold, not visit".
  if (ex.transition === 'want_visit' && !ex.holdAsk) {
    const freshSearchBrief =
      (discover.hasNarrowingConstraint(state.constraints) ||
        discover.hasNarrowingConstraint(ex.constraints)) &&
      !state.focus &&
      state.discover.lastOffered.length === 0;
    if (!freshSearchBrief) {
      state = { ...state, phase: 'visit' };
    }
  }

  const visitDayTurn = isVisitDayUtterance(trimmedText);
  if (
    visitDayTurn &&
    state.phase !== 'visit' &&
    (state.visit?.projectId ||
      state.visit?.queued?.length ||
      state.rti?.lastGoalKind?.startsWith('visit_') ||
      state.focus)
  ) {
    state = { ...state, phase: 'visit' };
  }

  if (state.phase === 'visit' && shouldExitVisitForIntent(ex, trimmedText)) {
    state = exitVisitPhase(state);
  }

  if (
    (state.phase === 'discover' || state.phase === 'handoff') &&
    (ex.namedProjects?.length ?? 0) >= 1 &&
    state.discover.lastOffered.length >= 1 &&
    routing.routing === 'visit_schedule_stop'
  ) {
    state = { ...state, phase: 'visit' };
  }

  if (state.phase === 'visit' && isVisitFollowUpQuestion(trimmedText, ex)) {
    ex = { ...ex, pickName: undefined, implicitProjectPick: undefined, transition: 'none' };
  }

  const now = new Date(deps.clock.nowMs());
  let visitCtx: visit.VisitCtx | null = null;
  if (state.phase === 'visit') {
    let visitState = state.visit;
    const coordRows = await deps.data.projectCoords(state.builderId).catch(() => []);
    const projectGeoCatalog = catalogFromProjectCoords(coordRows);

    const originCandidate =
      visitState?.lastAsk === 'origin' &&
      !visitState.originText &&
      !visit.isVisitProjectSwitchUtterance(trimmedText, ex.namedProjects?.length ?? 0) &&
      !(ex.namedProjects?.length ?? 0)
        ? visit.normalizeOriginText(trimmedText)
        : visitState?.originText
          ? visit.normalizeOriginText(visitState.originText)
          : undefined;
    if (originCandidate && visitState?.originLat == null) {
      const geo = await deps.data.resolveGeo(originCandidate).catch(() => null);
      if (geo) {
        visitState = {
          ...(visitState ?? {}),
          originText: visitState?.originText
            ? visit.normalizeOriginText(visitState.originText)
            : originCandidate.trim(),
          originLat: geo.lat,
          originLng: geo.lng,
          originAsked: true,
        };
        state = { ...state, visit: visitState };
      }
    }

    visitCtx = {
      text: input.text,
      now,
      siteVisitHours:
        (await deps.data.builder(state.builderId).catch(() => null))?.siteVisitHours ??
        'Mon–Sun, 9am–7pm',
      originGeo:
        visitState?.originLat != null && visitState?.originLng != null
          ? { lat: visitState.originLat, lng: visitState.originLng }
          : null,
      projectGeoCatalog,
    };
    if (nd) {
      const booked = await deps.data.siteVisitsItinerary(nd).catch(() => []);
      const lastBooked = booked.filter((v) => v.confirmed && v.iso).at(-1);
      const activeId = state.visit?.projectId;
      let driveFromPriorMin: number | null = null;
      let driveSource: visit.VisitCtx['driveSource'] = 'none';
      if (lastBooked && activeId) {
        const fromGeo = projectGeo(lastBooked.projectId, projectGeoCatalog);
        const toGeo = projectGeo(activeId, projectGeoCatalog);
        if (fromGeo && toGeo) {
          const apiKey = deps.maps?.apiKey;
          if (apiKey) {
            const leg = await driveLeg(apiKey, fromGeo, toGeo);
            if (leg?.minutes != null) {
              driveFromPriorMin = leg.minutes;
              driveSource = 'distance_matrix';
            }
          }
          if (driveFromPriorMin == null) {
            driveFromPriorMin = haversineDriveMinutes(fromGeo, toGeo);
            driveSource = 'haversine';
          }
        }
      }
      visitCtx = { ...visitCtx, bookedVisits: booked, driveFromPriorMin, driveSource };
      state = {
        ...state,
        visit: state.visit
          ? { ...state.visit, driveFromPriorMin, driveSource }
          : state.visit,
        visitBookedCache: booked
          .filter((v) => v.confirmed)
          .map((v) => ({
            projectId: v.projectId,
            projectName: v.projectName,
            iso: v.iso,
            label: v.label,
          })),
      };
    }
  }
  // AB-6 / W8 — a project NAMED from a cold start ("is Brigade Oasis a plotted
  // development?", "what plot sizes does Desire Spaces have?") must commit to that
  // project, not re-search by the type word and dump an unrelated list. Resolve
  // against the FULL catalog (not just the empty shortlist). Gated to a detail/
  // interrogative ask so an area name in a pure search never false-commits, and
  // resolveCatalogNameHit requires a single unambiguous match.
  let goal: TurnGoal;
  // Run regardless of an embedder-resolved namedProjects: resolveCatalogNameHit is a
  // DETERMINISTIC text match against real catalog names, so it both (a) rescues a
  // cold name the embedder missed and (b) safely confirms one the embedder found on a
  // search-classified turn (which discover.decide would not commit). A hallucinated
  // embedder name that isn't in the text simply yields no hit and falls through.
  const coldNameEligible =
    state.phase === 'discover' &&
    !state.focus &&
    state.discover.lastOffered.length === 0 &&
    (ex.namedProjects?.length ?? 0) < 2 &&
    (ex.isQuestion || isDetailAskTurn(ex) || /^(?:is|are|does|do|what|which|how|can|tell me)\b/i.test(trimmedText));
  if (coldNameEligible) {
    const names = await deps.data.projectNames(state.builderId).catch(() => [] as Array<{ projectId: string; name: string }>);
    const hit = resolveCatalogNameHit(trimmedText, names);
    goal = hit ? discover.commitPickWithFollowUp(hit, ex) : await decideGoalAsync(state, ex, visitCtx, deps, trimmedText);
  } else {
    goal = await decideGoalAsync(state, ex, visitCtx, deps, trimmedText);
  }

  // W1 focus bind: answer goals must not silently drift to embedder-invented projects.
  if (
    goal.kind === 'answer' &&
    goal.topic !== 'compare' &&
    state.focus &&
    goal.projectId !== state.focus.projectId
  ) {
    const answerGoal = goal;
    const pool = [
      ...state.discover.lastOffered,
      ...(state.discover.discussedProjects ?? []),
      { projectId: state.focus.projectId, name: state.focus.projectName },
    ];
    const namedOk =
      (ex.namedProjects?.some((p) => p.projectId === answerGoal.projectId) ?? false) &&
      buyerCuedOtherProject(trimmedText, pool);
    if (!namedOk) {
      goal = { ...answerGoal, projectId: state.focus.projectId };
    }
  }

  let evidence: EvidenceSet = { tools: [] };
  if (goal.kind === 'hold_propose' && nd) {
    // W7 — pre-check live per-type availability (Desk #203 counts, KV-cached
    // context) BEFORE proposing: a sold-out type gets the waitlist offer up
    // front instead of propose→fail. Counts absent (pre-#203 payloads) →
    // fail open and keep the honest propose→409 path.
    const wantType = goal.unitType.toLowerCase().replace(/[^a-z0-9]/g, '');
    const detail = await deps.data
      .projectDetail(state.builderId, nd, goal.projectId)
      .catch(() => null);
    const cfg = detail?.configurations?.find(
      (u) => u.unitType.toLowerCase().replace(/[^a-z0-9]/g, '') === wantType,
    );
    if (cfg && cfg.holdableUnits === 0) {
      goal = {
        ...goal,
        copy: `Every *${goal.unitType}* at *${goal.projectName}* is on hold right now. Shall I put you on the waitlist? The next one that frees up is auto-held for you — reply yes to confirm.`,
        state: { ...goal.state, queue: true },
      };
    }
  }
  if (goal.kind === 'hold_booked') {
    // Place the hold NOW (evidence stage — commitProject precedent) so the
    // deterministic confirmation copy can reflect the real outcome: held
    // until <time>, queued on the waitlist, or the type just sold out. Desk
    // auto-picks the unit; the one-active-hold invariant lives in its DB.
    const wantQueue = state.hold?.queue === true;
    const res = nd
      ? await deps.data
          .placeHold(
            { ndConversationId: nd, builderId: state.builderId },
            {
              projectId: goal.projectId,
              unitType: goal.unitType,
              ...(state.buyerName ? { buyerName: state.buyerName } : {}),
              ...(wantQueue ? { queue: true } : {}),
              ttlMinutes: 24 * 60,
            },
          )
          .catch(() => ({ ok: false as const }))
      : { ok: false as const };
    goal = {
      ...goal,
      placed: res.ok,
      ...(res.ok && 'waiting' in res && res.waiting
        ? { queued: true, ...('position' in res && res.position ? { position: res.position } : {}) }
        : {}),
      ...(res.ok && 'expiresAt' in res && res.expiresAt
        ? { expiresLabel: holdExpiryLabel(res.expiresAt) }
        : {}),
    };
  } else if (goal.kind === 'commit' && nd) {
    await deps.crm.commitProject(nd, goal.projectId).catch(() => {});
    if (goal.followUp || goal.followUpTopics?.length) {
      state = commitTo(state, goal.projectId, goal.projectName);
      const answerGoal: Extract<TurnGoal, { kind: 'answer' }> = {
        kind: 'answer',
        topic: goal.followUp ?? goal.followUpTopics![0]!,
        projectId: goal.projectId,
        ...(goal.followUpTopics?.length ? { topics: goal.followUpTopics } : {}),
      };
      evidence = await fetchAnswer(answerGoal, state, ex, deps, nd, trimmedText);
      goal = answerGoal;
    }
  } else if (goal.kind === 'recommend' || goal.kind === 'ack_reject_recommend') {
    ({ goal, evidence } = await fetchRecommend(goal, state, ex, deps, trimmedText, channel));
  } else if (goal.kind === 'objection') {
    ({ goal, evidence } = await fetchObjection(goal, state, deps, nd));
  } else if (goal.kind === 'answer') {
    evidence = await fetchAnswer(goal, state, ex, deps, nd, trimmedText);
  } else if (goal.kind === 'visit_recall') {
    evidence = await fetchVisitRecall(state, deps, nd);
  } else {
    evidence = await fetchEvidence(goal, state, deps);
  }

  const alreadyShownSameSet = evidence.matches ? isSameAsLast(state, evidence.matches) : false;
  const ff = state.feedForward;
  const disclosedForCompose = [
    ...(ff?.disclosedFacts ?? []),
    ...(state.disclosedFacts ?? []),
  ];
  const req = buildComposeRequest(goal, evidence, {
    buyerName: state.buyerName,
    constraints: state.constraints,
    alreadyShownSameSet,
    builderName: friendlyBuilder(state.builderId),
    buyerText: input.text,
    ...(state.focus ? { focusProjectName: state.focus.projectName } : {}),
    returningBuyer: state.returningBuyer,
    ...(ff?.priorTopics?.length ? { priorTopics: ff.priorTopics } : {}),
    ...(ff?.priorReplyExcerpt ? { priorReplyExcerpt: ff.priorReplyExcerpt } : {}),
    ...(disclosedForCompose.length ? { disclosedFacts: disclosedForCompose } : {}),
  });

  const visitDeterministic =
    goal.kind === 'visit_ask' || goal.kind === 'visit_propose' || goal.kind === 'visit_booked';
  // Hold copy is a commitment ("held until 5:30 pm") — never LLM-paraphrased.
  const holdDeterministic = goal.kind === 'hold_propose' || goal.kind === 'hold_booked';
  const firstShortlistTurn =
    state.discover.lastOffered.length === 0 &&
    (goal.kind === 'recommend' || goal.kind === 'ack_reject_recommend') &&
    (evidence.matches?.length ?? 0) > 0;
  const clarifyPickDeterministic = goal.kind === 'clarify_project_pick';
  const compareDeterministic = goal.kind === 'answer' && goal.topic === 'compare';
  const multiAnswerDeterministic =
    goal.kind === 'answer' && (goal.topics?.length ?? 0) > 1;
  const locationDeterministic = goal.kind === 'answer' && goal.topic === 'location' && !!evidence.location;
  const mediaDeterministic = goal.kind === 'answer' && goal.topic === 'media' && !!evidence.media;
  // SA-3: availability always uses units evidence template (not LLM paraphrase).
  const availabilityDeterministic = goal.kind === 'answer' && goal.topic === 'availability';
  // P2c: legal uses focused facet templates (banks/EC/RERA skip) — not LLM paraphrase.
  const legalDeterministic = goal.kind === 'answer' && goal.topic === 'legal';
  const visitRecallDeterministic = goal.kind === 'visit_recall' && !!evidence.visits;
  const warmAckDeterministic = goal.kind === 'warm_ack';
  const propertyTypeDeterministic =
    goal.kind === 'answer' && goal.topic === 'property_type' && !!evidence.detail?.projectType;
  // Named commit / overview after switch — always say the project name (SW-01/02).
  const commitDeterministic = goal.kind === 'commit';
  const overviewDeterministic =
    goal.kind === 'answer' && goal.topic === 'overview' && !!evidence.detail;

  // no_fit is a hard honesty statement with a well-built template (constraint
  // gap, catalog floor, alternate project) — LLM paraphrase of it produced
  // literal prompt echoes on dev ("[real starting point]"). Lock it.
  const noFitDeterministic = goal.kind === 'no_fit';

  // Template-locked goals: commitments and structured facts that must never be
  // LLM-paraphrased — and (W3) must never be "varied" by the repeat guard.
  const templateLocked =
    noFitDeterministic ||
    visitDeterministic ||
    holdDeterministic ||
    firstShortlistTurn ||
    clarifyPickDeterministic ||
    compareDeterministic ||
    multiAnswerDeterministic ||
    locationDeterministic ||
    mediaDeterministic ||
    availabilityDeterministic ||
    legalDeterministic ||
    visitRecallDeterministic ||
    warmAckDeterministic ||
    propertyTypeDeterministic ||
    commitDeterministic ||
    overviewDeterministic;

  let draft: string;
  if (templateLocked) {
    draft = fallbackReply(req);
  } else {
    try {
      draft = (await deps.llm.compose(req)).trim();
      if (!draft) draft = fallbackReply(req);
    } catch {
      draft = fallbackReply(req);
    }
  }

  // W1+W3 share ONE bounded LLM retry per turn (review: no repair forest).
  let retryUsed = false;

  // AB-10 — a pure-directive draft strips to '' (nothing but the leaked
  // instruction). Never re-emit it: fall to the grounded template floor.
  const stripped = stripComposerDirectives(stripBanned(draft));
  let reply = stripped.trim() ? stripped : fallbackReply(req);
  let grounding: TurnDebug['grounding'] = 'pass';
  const g1 = checkGrounding(reply, evidence, input.text);
  // Placeholder-leak guard (dev: "[real starting point]" reached a buyer):
  // an LLM draft containing bracketed template-speak is treated exactly like
  // a grounding failure — one repair retry, then the template floor.
  const placeholderLeak =
    !templateLocked && /\[[a-z][^\]\n]{2,60}\]/i.test(reply);
  if (!g1.grounded || placeholderLeak) {
    // W1 — repair without killing the thread: feed the checker's exact
    // rejections back for ONE re-compose before the template floor. This is
    // the 49%-of-answer-turns problem measured in Week 0. Template-locked
    // goals never reach here (they never compose).
    let repaired = '';
    if (!templateLocked && !retryUsed) {
      retryUsed = true;
      try {
        repaired = stripBanned(
          (await deps.llm.compose({
            ...req,
            repair: {
              unbacked: [
                ...g1.unbacked,
                ...(placeholderLeak ? ['a bracketed placeholder like "[…]" instead of a real value'] : []),
              ],
            },
          })).trim(),
        );
      } catch { /* template floor below */ }
    }
    if (
      repaired &&
      checkGrounding(repaired, evidence, input.text).grounded &&
      !/\[[a-z][^\]\n]{2,60}\]/i.test(repaired) && // retry must not re-leak a placeholder
      !needsStructuredRepair(goal, evidence, repaired, disclosedForCompose, input.text)
    ) {
      reply = repaired;
      grounding = 'recomposed';
    } else {
      reply = fallbackReply(req); // the floor never moves
      grounding = 'repaired';
    }
  } else if (needsStructuredRepair(goal, evidence, reply, disclosedForCompose, input.text)) {
    // Structured repair is topic-shape enforcement — the template IS the
    // intended output; no retry.
    reply = fallbackReply(req);
    grounding = 'repaired';
  }
  if (!reply.trim()) reply = "Let me pull those details together and follow up shortly.";

  // W3 — repeat guard: never send the previous line verbatim. Shares the
  // single retry budget with W1 above; if the varied draft is empty/
  // ungrounded/still identical, fall to the template — and if even THAT
  // matches, keep it (deterministic content is allowed to repeat; only LLM
  // drafts are guarded).
  let repeat_guard: TurnDebug['repeat_guard'];
  if (!templateLocked && !retryUsed && state.lastReply && sameLine(reply, state.lastReply)) {
    retryUsed = true;
    let varied = '';
    try {
      varied = stripBanned(
        (await deps.llm.compose({
          ...req,
          vary: true,
          context: { ...req.context, priorReplyExcerpt: state.lastReply.slice(0, 220) },
        })).trim(),
      );
    } catch { /* fall through to template */ }
    if (
      varied &&
      !sameLine(varied, state.lastReply) &&
      checkGrounding(varied, evidence, input.text).grounded &&
      !needsStructuredRepair(goal, evidence, varied, disclosedForCompose, input.text)
    ) {
      reply = varied;
      repeat_guard = 'recomposed';
    } else {
      const floor = fallbackReply(req);
      repeat_guard = sameLine(floor, state.lastReply) ? 'still_identical' : 'template';
      if (repeat_guard === 'template') reply = floor;
    }
  }

  if (goal.kind === 'visit_booked') {
    const next = goal.nextQueuedStop ?? state.visit?.queued?.[0];
    if (next) {
      reply = `${reply.trim()}\n\nNext up — same day for *${next.projectName}*, or a different day?`;
    }
  }

  state = applyGoalToState(state, goal, evidence);
  // W2 — the hold-confirm window is one-shot for BOOKING: any turn that didn't
  // re-propose downgrades it (awaitingConfirm off), so a stray "yes" can never
  // book directly. The offer itself lingers for 6 turns — a bare affirm inside
  // that window RE-PROPOSES (explicit re-confirm), which is the recovery for
  // "hold it → (digression) → yes".
  if (goal.kind !== 'hold_propose' && state.hold?.awaitingConfirm) {
    state = {
      ...state,
      hold: { ...state.hold, awaitingConfirm: false, offeredAtTurn: state.turnCount },
    };
  }
  // W3 — remember the outbound line for the repeat guard.
  state = { ...state, lastReply: reply };
  if (evidence.detail && goal.kind === 'answer') {
    state = {
      ...state,
      projectCache: { ...(state.projectCache ?? {}), [goal.projectId]: evidence.detail },
    };
  }
  const newlyDisclosed = extractDisclosedFacts({ goal, evidence });
  if (newlyDisclosed.length) {
    state = {
      ...state,
      disclosedFacts: mergeDisclosedFacts(state.disclosedFacts, newlyDisclosed),
    };
  }
  // W5 — stage truth: climb Desk's funnel ladder as the conversation earns it.
  // engaged = focused AND (a facet answer OR a second focused turn);
  // qualified = focused AND budget AND (bhk OR property type). Write-once per
  // rung (stageWritten) and only_forward on Desk, so the bot can never
  // downgrade a lead an agent moved further. visit_booked/escalated stay
  // event-driven in syncFacts, unchanged.
  if (state.phase === 'focused') {
    state = { ...state, focusedTurns: (state.focusedTurns ?? 0) + 1 };
  }
  if (nd) {
    const rung = decideStageRung(state, goal);
    if (rung) {
      state = { ...state, stageWritten: rung };
      await deps.crm.setStage(nd, rung, { onlyForward: true }).catch(() => {});
    }
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
      previousRti: state.rti,
      focus: state.focus
        ? { projectId: state.focus.projectId, projectName: state.focus.projectName }
        : null,
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
  await syncTelemetry(deps, nd, input, goal, evidence, state, reply, {
    ex,
    extractProvenance,
    inputSource,
    grounding,
    routing,
  }).catch(() => {});

  const cappedRecovery = searchRecovery ? capRecoveryForChannel(searchRecovery, channel) : undefined;

  const debugOut = withIngressDebug(
    {
      phase: state.phase,
      goal,
      tools: evidence.tools,
      grounding,
      ...(repeat_guard ? { repeat_guard } : {}),
      last_offered_count: state.discover.lastOffered.length,
      last_offered_ids: state.discover.lastOffered.map((o) => o.projectId),
    },
    inputSource,
    extractProvenance,
  );
  deps.emitTurnLog?.(
    buildTurnLogSnapshot({
      turnInput: input,
      state,
      ex,
      goal,
      debug: debugOut,
      reply,
      evidence,
      buyerText: trimmedText,
    }),
  );

  return {
    reply,
    state,
    debug: debugOut,
    ...(evidence.compare?.matrix ? { compareMatrix: evidence.compare.matrix } : {}),
    ...(cappedRecovery ? { searchRecovery: cappedRecovery } : {}),
    uiMode,
    whatsappActions: whatsAppButtons(searchRecovery, channel),
  };
}

/** W3 — verbatim-repeat comparison: case/whitespace-insensitive. */
function sameLine(a: string, b: string | undefined): boolean {
  if (!b) return false;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

/** "today 5:30 pm" / "tomorrow 5:30 pm" / "14 Jul, 5:30 pm" — IST, for hold-confirm copy. */
function holdExpiryLabel(expiresAtMs: number): string {
  const tz = 'Asia/Kolkata';
  const time = new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(expiresAtMs);
  const dayKey = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(ms);
  const now = Date.now();
  if (dayKey(expiresAtMs) === dayKey(now)) return `today ${time}`;
  if (dayKey(expiresAtMs) === dayKey(now + 24 * 60 * 60 * 1000)) return `tomorrow ${time}`;
  const day = new Intl.DateTimeFormat('en-IN', { timeZone: tz, day: 'numeric', month: 'short' }).format(expiresAtMs);
  return `${day}, ${time}`;
}

/**
 * W5 — which funnel rung this conversation has EARNED this turn (null = no new
 * rung). qualified ⊃ engaged, so the higher rung is checked first; a buyer who
 * arrives with budget+BHK jumps straight to qualified (only_forward makes the
 * skipped 'engaged' write moot). Monotonic by construction — stageWritten only
 * moves up, and lateral states (escalated etc.) are Desk-side protected.
 */
function decideStageRung(
  s: ConversationState,
  goal: TurnGoal,
): 'engaged' | 'qualified' | null {
  if (!s.focus) return null;
  const qualified =
    !!s.constraints.budgetMaxInr && !!(s.constraints.bhk || s.constraints.propertyType);
  if (qualified && s.stageWritten !== 'qualified') return 'qualified';
  if (s.stageWritten) return null; // already engaged; qualified not yet earned
  if (goal.kind === 'answer' || (s.focusedTurns ?? 0) >= 2) return 'engaged';
  return null;
}

function decideGoal(
  s: ConversationState,
  ex: Extracted,
  visitCtx: visit.VisitCtx | null,
  text = '',
): TurnGoal {
  if (ex.recall) return { kind: 'visit_recall' };
  switch (s.phase) {
    case 'discover':
      return discover.decide(s, ex);
    case 'focused':
      // text feeds the deterministic hold-intent gate (visit-style regex).
      return focused.decide(s, ex, text);
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
  return decideGoal(s, ex, visitCtx, text);
}

async function fetchRecommend(
  base: TurnGoal,
  s: ConversationState,
  ex: Extracted,
  deps: EngineDeps,
  buyerText: string,
  channel: TurnIntentChannel = 'whatsapp',
): Promise<{ goal: TurnGoal; evidence: EvidenceSet }> {
  const relistShortlist = (): { goal: TurnGoal; evidence: EvidenceSet } | null => {
    const ms = matchesFromLastOffered(s);
    if (ms.length < 2) return null;
    return { goal: { kind: 'recommend' }, evidence: { tools: [], matches: ms } };
  };

  let filters = discover.searchFilters(s.constraints);
  // Trade-off Advisor: only the recommend path carries preference inputs.
  // Explicit in-state weights (chip answer this session) win Desk-side;
  // conversation_id lets the Desk fall back to stored BPE facts for a
  // returning buyer whose KV state expired. Catalog/facet/recovery-count
  // calls never set either (meaningless there). Advisor-web only — WA must
  // not re-rank on soft NL heuristics.
  if (s.ndConversationId) filters = { ...filters, conversationId: s.ndConversationId };
  if (channel === 'advisor_web') {
    const prefs = advisorSearchPrefs(s.constraints);
    if (prefs.preferenceWeights) filters = { ...filters, preferenceWeights: prefs.preferenceWeights };
    if (prefs.commuteHub) filters = { ...filters, commuteHub: prefs.commuteHub };
    if (prefs.budgetTargetInr) filters = { ...filters, budgetTargetInr: prefs.budgetTargetInr };
    if (prefs.askSizeSqft) filters = { ...filters, askSizeSqft: prefs.askSizeSqft };
  }
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
      ...(m.tradeoff_note ? { tradeoffNote: m.tradeoff_note } : {}),
      ...(m.dimension_fit ? { dimensionFit: m.dimension_fit } : {}),
      ...(m.dimension_gap ? { dimensionGap: m.dimension_gap } : {}),
    }))
    .filter((m) => !s.discover.rejectedProjectIds.includes(m.projectId))
    .filter((m) => (ex.wantsMore ? !offeredIds.has(m.projectId) : true));

  const matches = discover.filterSearchMatches(
    rawMatches,
    s.constraints,
    s.discover.rejectedProjectIds,
    { locationAliases: strictSearch.expandedLocations ?? [] },
  );

  if (matches.length === 0 && base.kind === 'recommend' && s.discover.lastOffered.length === 0) {
    const broadened = await broadenInitialShortlist(
      deps,
      s.builderId,
      filters,
      s.constraints,
      s.discover.rejectedProjectIds,
      [],
    );
    if (broadened.length > 0) {
      return { goal: base, evidence: { tools: ['search'], matches: broadened } };
    }
  }

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
    const relaxedConstraints = { ...s.constraints };
    delete relaxedConstraints.bhk;
    const relaxedMatches = discover.filterSearchMatches(
      withoutBhkRaw,
      relaxedConstraints,
      s.discover.rejectedProjectIds,
    );
    if (relaxedMatches.length > 0) {
      return { goal: base, evidence: { tools: ['search'], matches: relaxedMatches } };
    }
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
        hint: 'constraint',
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
      if (!shouldAllowBudgetGapNoFit(s, buyerText)) {
        const relist = relistShortlist();
        if (relist) return relist;
      }
      if (s.discover.lastOffered.length === 0) {
        const broadened = await broadenInitialShortlist(
          deps,
          s.builderId,
          filters,
          s.constraints,
          s.discover.rejectedProjectIds,
          [],
        );
        if (broadened.length >= 2) {
          return { goal: base, evidence: { tools: ['search'], matches: broadened } };
        }
      }
      const catalog = await deps.data.catalog(s.builderId).catch(() => emptyCatalog());
      const searchRecovery = await planSearchRecovery({
        searchCount: async (f) => (await searchWithFilters(deps, s.builderId, f)).matches.length,
        catalog,
        constraints: s.constraints,
        reason: budgetEv.noMatch?.reasoning ?? 'Budget too low for current filters',
        maxActions: 6,
        variant: 'zero_match',
        hint: 'budget',
      });
      return {
        goal: { kind: 'no_fit' },
        evidence: { ...budgetEv, searchRecovery },
      };
    }
  }

  if (scopedMatches.length === 0 && s.constraints.propertyType) {
    const { projectTypes: _pt, ...noTypeFilters } = filters;
    const broadType = await searchWithFilters(deps, s.builderId, noTypeFilters);
    const broadTypeRaw: Match[] = broadType.matches.map((m) => ({
      projectId: m.project_id,
      name: m.name,
      microMarket: m.micro_market,
      startingPriceInr: m.starting_price_inr,
      startingPriceDisplay: m.starting_price_display,
      matchReasons: m.match_reasons ?? [],
      projectType: m.project_type,
    }));
    const typeEv = discover.buildPropertyTypeNoFitEvidence(
      s.constraints,
      broadTypeRaw,
      s.discover.rejectedProjectIds,
    );
    if (typeEv) {
      const catalog = await deps.data.catalog(s.builderId).catch(() => emptyCatalog());
      const searchRecovery = await planSearchRecovery({
        searchCount: async (f) => (await searchWithFilters(deps, s.builderId, f)).matches.length,
        catalog,
        constraints: s.constraints,
        reason: typeEv.noMatch?.reasoning ?? 'Property type not available at this budget',
        maxActions: 6,
        variant: 'zero_match',
        hint: 'property_type',
      });
      return {
        goal: { kind: 'no_fit' },
        evidence: { ...typeEv, searchRecovery },
      };
    }
  }

  if (scopedMatches.length > 0) {
    let listed = scopedMatches;
    if (base.kind === 'recommend' && s.discover.lastOffered.length === 0 && listed.length < 3) {
      listed = await broadenInitialShortlist(deps, s.builderId, filters, s.constraints, s.discover.rejectedProjectIds, listed);
    }
    if (
      base.kind === 'recommend' &&
      !ex.wantsMore &&
      !ex.forceRecommendList &&
      isSameAsLast(s, listed)
    ) {
      const miss = s.discover.advancedOnce ? undefined : discover.firstMissingSlot(s);
      return {
        goal: { kind: 'advance', reason: 'same_set' },
        evidence: { tools: ['search'], matches: listed, ...(miss ? { nextSlot: miss } : {}) },
      };
    }
    return { goal: base, evidence: { tools: ['search'], matches: listed } };
  }

  const catalog = await deps.data.catalog(s.builderId).catch(() => emptyCatalog());
  // AB-3 — never interpolate a polluted/noise locality into the honest miss ("No
  // exact match for the"). The constraint gate rejects most upstream; this is the
  // final guard before the raw string reaches the buyer.
  const reasonLoc = locationLooksPolluted(s.constraints.location) ? undefined : s.constraints.location;
  const reasoning = `No exact match for ${[reasonLoc, s.constraints.propertyType].filter(Boolean).join(' ') || 'those filters'}`;
  const resolved = discover.resolveRecommend(
    base,
    scopedMatches,
    catalog,
    s.constraints,
    s.discover.rejectedProjectIds,
    reasoning,
  );

  if (resolved.goal.kind === 'no_fit') {
    if (!shouldAllowBudgetGapNoFit(s, buyerText)) {
      const relist = relistShortlist();
      if (relist) return relist;
    }
    const searchRecovery = await planSearchRecovery({
      searchCount: async (filters) =>
        (await searchWithFilters(deps, s.builderId, filters)).matches.length,
      catalog,
      constraints: s.constraints,
      reason: resolved.evidence.noMatch?.reasoning ?? reasoning,
      maxActions: 6,
      variant: 'zero_match',
      hint: recoveryHintFromEvidence(resolved.evidence),
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
): Promise<{
  matches: Array<{
    project_id: string;
    name: string;
    micro_market: string;
    starting_price_inr: number;
    starting_price_display: string;
    match_reasons?: string[];
    project_type?: string;
    tradeoff_note?: string;
    dimension_fit?: Array<{ dimension: string; score: number; weight: number; evidence: string; good: boolean }>;
    dimension_gap?: { dimension: string; weight: number; label: string };
  }>;
  expandedLocations?: string[];
  noMatchReasoning?: string;
}> {
  return deps.data.search(builderId, filters).catch(() => ({ matches: [] }));
}

function rawToMatches(
  rows: Array<{ project_id: string; name: string; micro_market: string; starting_price_inr: number; starting_price_display: string; match_reasons?: string[]; project_type?: string; tradeoff_note?: string; dimension_fit?: Array<{ dimension: string; score: number; weight: number; evidence: string; good: boolean }>; dimension_gap?: { dimension: string; weight: number; label: string } }>,
): Match[] {
  return rows.map((m) => ({
    projectId: m.project_id,
    name: m.name,
    microMarket: m.micro_market,
    startingPriceInr: m.starting_price_inr,
    startingPriceDisplay: m.starting_price_display,
    matchReasons: m.match_reasons ?? [],
    projectType: m.project_type,
    ...(m.tradeoff_note ? { tradeoffNote: m.tradeoff_note } : {}),
    ...(m.dimension_fit ? { dimensionFit: m.dimension_fit } : {}),
    ...(m.dimension_gap ? { dimensionGap: m.dimension_gap } : {}),
  }));
}

/** First shortlist after brief — relax BHK/type filters to surface up to 3 options. */
async function broadenInitialShortlist(
  deps: EngineDeps,
  builderId: string,
  filters: import('./types.js').SearchFilters,
  constraints: import('./types.js').Constraints,
  rejectedIds: readonly string[],
  current: Match[],
): Promise<Match[]> {
  const merged = [...current];
  const seen = new Set(merged.map((m) => m.projectId));
  const relaxPlans: import('./types.js').SearchFilters[] = [];
  if (filters.bhks) {
    const { bhks: _b, ...noBhk } = filters;
    relaxPlans.push(noBhk);
  }
  // AB-2 — NEVER relax projectTypes: a declared type is a hard filter. Padding a
  // "plotted in North Bangalore" shortlist with an apartment (Century Breeze) or a
  // "villa" list with a plantation actively misleads — the buyer reads all three
  // cards as what they asked for. Two honest typed cards beat three polluted ones;
  // zero typed matches falls through to the propertyTypeGap no_fit, which names
  // the gap and offers the closest other-type option with consent.
  for (const plan of relaxPlans) {
    const broad = await searchWithFilters(deps, builderId, plan);
    const ms = discover.filterSearchMatches(rawToMatches(broad.matches), constraints, rejectedIds);
    for (const m of ms) {
      if (seen.has(m.projectId)) continue;
      seen.add(m.projectId);
      merged.push(m);
      if (merged.length >= 3) return merged;
    }
  }
  return merged;
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
  buyerText?: string,
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
    const breakdownAsk = buyerText ? wantsCostBreakdown(buyerText) : false;
    if (breakdownAsk && unitType) {
      const landed = await deps.data.landedCost(s.builderId, nd, goal.projectId, unitType).catch(() => null);
      if (landed) {
        tools.push('landedCost');
        evidence = {
          ...evidence,
          tools: [...new Set(tools)],
          landedCost: landed,
        };
      }
    }
    if (!evidence.landedCost) {
      const pricing = await deps.data.pricing(s.builderId, nd, goal.projectId, unitType).catch(() => null);
      if (pricing) {
        tools.push('pricing');
        // AB-1 — a cost-component ask gets THE component(s), filtered at the
        // EVIDENCE level so both the LLM composer and the template floor see
        // only the asked rows ("club membership fee?" led with base price when
        // the full card reached the composer). No match → full card unchanged.
        const asked =
          buyerText && isCostComponentAsk(buyerText)
            ? componentsForAsk(buyerText, pricing.components)
            : [];
        const components = asked.length ? asked : pricing.components;
        evidence = {
          ...evidence,
          tools: [...new Set(tools)],
          pricing: { ...pricing, components, projectName: pricing.projectName || focusName },
        };
      }
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
      const mediaName =
        (s.focus?.projectId === goal.projectId ? focusName : '') ||
        s.discover.lastOffered.find((o) => o.projectId === goal.projectId)?.name ||
        focusName;
      evidence = {
        ...evidence,
        tools: [...new Set(tools)],
        // Requested `assetKind` first so an honest miss can name it ("floor plan");
        // a successful share carries its own asset_kind in `...media`, which wins.
        media: { assetKind, ...media, projectName: mediaName || focusName || 'this project' },
      };
    }
  }

  if (topics.includes('availability')) {
    const bhkFilter = resolveAvailabilityBhkFilter({
      buyerText,
      constraintBhk: s.constraints.bhk,
    });
    const toEvidenceUnits = (
      rows: Array<{ unitType: string; priceDisplay: string; sizeDisplay?: string; holdableUnits?: number }>,
    ) =>
      filterUnitsByBhk(rows, bhkFilter).map((c) => ({
        unitType: c.unitType,
        priceDisplay: c.priceDisplay,
        ...(c.sizeDisplay ? { sizeDisplay: c.sizeDisplay } : {}),
        // AB-1 — the live holdable count is the FACT an inventory ask needs;
        // dropping it here was why "is there any inventory left?" answered
        // with a config card list.
        ...(typeof c.holdableUnits === 'number' ? { holdableUnits: c.holdableUnits } : {}),
      }));

    const cachedConfigs = s.projectCache?.[goal.projectId]?.configurations;
    if (cachedConfigs?.length) {
      const units = toEvidenceUnits(cachedConfigs);
      if (units.length) {
        tools.push('listUnits');
        evidence = {
          ...evidence,
          tools: [...new Set(tools)],
          units,
        };
      }
    } else {
      const listed = await deps.data.listUnits(goal.projectId).catch(() => []);
      if (listed.length) {
        const units = toEvidenceUnits(listed);
        if (units.length) {
          tools.push('listUnits');
          evidence = {
            ...evidence,
            tools: [...new Set(tools)],
            units,
          };
        }
      }
    }
  }

  // Closed-beta: Desk FAQ corpus — rental_yield, possession, loan, amenities, …
  // Taught facet first (Understanding board): a ≥τ embed bind whose vector
  // carries a human-taught FAQ key pins that row ahead of topic hints.
  // lastRouting is re-stamped every turn before goal selection, so this is
  // always THIS turn's bind; text-bound keys win inside taughtFaqKey.
  const taughtKey = buyerText ? taughtFaqKey(s.rti?.lastRouting, buyerText) : undefined;
  const resolvedKeys = resolveFaqQuestionKeys(buyerText ?? '', topics);
  const faqKeys = taughtKey
    ? [taughtKey, ...resolvedKeys.filter((k) => k !== taughtKey)]
    : resolvedKeys;
  const faqHits: Array<{ questionKey: string; question: string; answer: string }> = [];
  for (const key of faqKeys) {
    const faq = await deps.data.faqLookup(goal.projectId, key).catch(() => null);
    if (faq?.answer) {
      faqHits.push({ questionKey: key, question: faq.question, answer: faq.answer });
    }
  }
  if (faqHits.length) {
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
        faqs: faqHits,
      },
    };
  } else if (faqKeys.length > 0 && buyerText && (isFaqShapedAsk(buyerText) || taughtKey)) {
    // taughtKey: a taught facet that MISSED (project has no such FAQ row) earns
    // the honest miss too — the bind read the ask's meaning (≥τ, human-taught),
    // so the overview card would be the exact wrong answer this lane kills.
    // Data-aware by construction: this branch runs only after the real lookup.
    // AB-1 — the cost sheet owns cost-component asks. "what are the parking
    // charges?" binds the `parking` FAQ key; when the project has no such FAQ
    // row but its pricing components DO carry the answer (Car Parking ₹5,00,000),
    // a faqMiss here made the composer decline a question it had the data for.
    const costSheetOwns =
      isCostComponentAsk(buyerText) && Boolean(evidence.pricing ?? evidence.landedCost);
    if (!costSheetOwns) {
      // Extractor bound a FAQ key but Desk has no row — honest miss, no overview invent.
      tools.push('faqMiss');
      evidence = {
        ...evidence,
        tools: [...new Set(tools)],
        faqMiss: { keys: faqKeys, ...(taughtKey ? { taught: true } : {}) },
      };
    }
  }

  const faqShapedHit = Boolean(buyerText && isFaqShapedAsk(buyerText) && faqHits.length > 0);
  const faqShapedMiss = Boolean(evidence.faqMiss?.keys.length);
  // S1 — LI-backed POI asks. Location-family FAQ keys and category mentions
  // pull structured LI evidence even on a FAQ hit (named POIs enrich the
  // approved copy) or a FAQ miss (LI answers instead of a dead-end unknown).
  // Only TEXT-bound FAQ keys count as asked categories — topic-hint keys
  // (generic "where is it?") must not gate evidence on metro/airport data.
  const askedCategories = locationCategoriesAsked(buyerText ?? '');
  const faqLocationCategories = (buyerText ? resolveFaqQuestionKeys(buyerText) : [])
    .map((k) => FAQ_KEY_LOCATION_CATEGORY[k])
    .filter((c): c is LocationCategoryKey => Boolean(c));
  const wantsLocation = topics.includes('location') || faqLocationCategories.length > 0;
  // AB-8b — a multi-atom legal ask ("is it RERA approved AND can I get a loan?")
  // resolves a loan FAQ hit, which used to suppress detail hydration (faqShapedHit).
  // The RERA/khata SNAPSHOT atom then had no data and rendered "on file with our
  // team" even though Desk carries the number. When the buyer named a snapshot atom
  // that no FAQ hit covers, hydrate the full detail so BOTH atoms answer (the loan
  // FAQ is preserved onto the hydrated detail below).
  const legalSnapshotFaqPresent = faqHits.some((f) =>
    /^(?:rera_status|rera_number|khata(?:_legal)?|legal_status)$/i.test(f.questionKey),
  );
  const legalSnapshotNeeded =
    topics.includes('legal') &&
    !legalSnapshotFaqPresent &&
    Boolean(buyerText) &&
    // Title-atom cues only — phrase-scoped so a bare "loan approval" can't trip it.
    /\b(?:rera|khata|title|encumbrance|\bec\b|clear\s+title|approval\s+status|plan\s+approval|legal\s+status|legal\s+details?)\b/i.test(
      buyerText ?? '',
    );
  const needsDetail =
    (!faqShapedHit &&
      !faqShapedMiss &&
      topics.some(
        (t) =>
          t === 'legal' ||
          t === 'overview' ||
          t === 'amenities' ||
          t === 'location' ||
          t === 'availability' ||
          t === 'property_type',
      )) ||
    legalSnapshotNeeded;
  if (needsDetail || wantsLocation) {
    let detail = await hydrateProjectDetail(deps, s, goal.projectId);
    if (detail && topics.includes('legal')) {
      detail = await enrichDetailLegal(deps, nd, detail);
    }
    if (detail && needsDetail) {
      tools.push('detail');
      // Detail replaces any topic-hint FAQ attach (original single-owner
      // behavior) — only text-bound faq-shaped asks keep their FAQ answer.
      // AB-8b — but a multi-atom legal ask (legalSnapshotNeeded) DOES carry a
      // real FAQ hit (the loan atom); preserve it onto the hydrated detail so
      // the snapshot answers RERA and the FAQ body answers loan.
      const priorFaqs = evidence.detail?.faqs;
      evidence = {
        ...evidence,
        tools: [...new Set(tools)],
        detail: priorFaqs?.length ? { ...detail, faqs: priorFaqs } : detail,
      };
    }
    if (detail && wantsLocation) {
      const leadCategories = [...new Set([...askedCategories, ...faqLocationCategories])];
      const location = buildLocationEvidence(detail, leadCategories);
      if (locationHasAskedData(location, leadCategories)) {
        tools.push('location');
        evidence = { ...evidence, tools: [...new Set(tools)], location };
        // The asked POI category is answerable from LI — the FAQ miss is no
        // longer a dead end (only when every missed key was location-family).
        if (
          evidence.faqMiss &&
          evidence.faqMiss.keys.every((k) => Boolean(FAQ_KEY_LOCATION_CATEGORY[k]))
        ) {
          const { faqMiss: _drop, ...rest } = evidence;
          evidence = rest;
        }
      }
    }
  }

  return evidence;
}

/** FAQ question_key → LI POI category it can be answered from (S1). */
const FAQ_KEY_LOCATION_CATEGORY: Record<string, LocationCategoryKey | undefined> = {
  nearby_schools: 'schools',
  nearby_hospitals: 'hospitals',
  metro_connectivity: 'metroStations',
  airport_distance: 'airports',
};

/** True when the evidence can actually answer what was asked (no empty snapshots). */
function locationHasAskedData(
  loc: LocationEvidence,
  asked: readonly LocationCategoryKey[],
): boolean {
  if (asked.length > 0) return asked.some((k) => (loc[k]?.length ?? 0) > 0);
  return Boolean(
    loc.connectivitySummary ||
      loc.microMarketOverview ||
      loc.nearbyPois?.length ||
      loc.driveTimes?.length ||
      loc.schools?.length ||
      loc.hospitals?.length ||
      loc.metroStations?.length ||
      loc.airports?.length,
  );
}

function buildLocationEvidence(
  detail: NonNullable<Awaited<ReturnType<EngineDeps['data']['projectDetail']>>>,
  askedCategories?: readonly LocationCategoryKey[],
): LocationEvidence {
  const loc = detail.location;
  return {
    projectName: detail.name,
    microMarket: detail.microMarket,
    ...(loc?.connectivitySummary ? { connectivitySummary: loc.connectivitySummary } : {}),
    ...(loc?.microMarketOverview ? { microMarketOverview: loc.microMarketOverview } : {}),
    ...(loc?.nearbyPois?.length ? { nearbyPois: loc.nearbyPois } : {}),
    ...(loc?.driveTimes?.length ? { driveTimes: loc.driveTimes } : {}),
    // S1 — structured POI categories pass through verbatim (Desk-verified).
    ...(loc?.schools?.length ? { schools: loc.schools } : {}),
    ...(loc?.hospitals?.length ? { hospitals: loc.hospitals } : {}),
    ...(loc?.metroStations?.length ? { metroStations: loc.metroStations } : {}),
    ...(loc?.airports?.length ? { airports: loc.airports } : {}),
    ...(loc?.itParks?.length ? { itParks: loc.itParks } : {}),
    ...(loc?.malls?.length ? { malls: loc.malls } : {}),
    ...(loc?.transitStations?.length ? { transitStations: loc.transitStations } : {}),
    ...(loc?.universities?.length ? { universities: loc.universities } : {}),
    ...(loc?.supermarkets?.length ? { supermarkets: loc.supermarkets } : {}),
    ...(loc?.parks?.length ? { parks: loc.parks } : {}),
    ...(loc?.upcomingInfra?.length ? { upcomingInfra: loc.upcomingInfra } : {}),
    ...(askedCategories?.length ? { askedCategories } : {}),
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
  if (goal.kind === 'clarify_project_pick') {
    const matches = matchesFromLastOffered(s).slice(0, 3);
    return { tools: ['lastOffered'], matches };
  }
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
  const discussed = s.discover.discussedProjects ?? [];
  if (discussed.length >= 2) return discussed.map((p) => p.projectId).slice(0, 3);
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
    case 'answer': {
      // Track projects the buyer actually engaged with (focus + compare pair).
      const discussed: OfferedProject[] = [];
      if (s.focus) discussed.push({ projectId: s.focus.projectId, name: s.focus.projectName });
      if (goal.topic === 'compare') {
        const matrixPs = ev.compare?.matrix?.projects;
        if (matrixPs?.length) {
          for (const p of matrixPs) discussed.push({ projectId: p.project_id, name: p.name });
        }
      } else if (goal.projectId) {
        const fromOffered = s.discover.lastOffered.find((o) => o.projectId === goal.projectId);
        const fromDiscussed = (s.discover.discussedProjects ?? []).find((o) => o.projectId === goal.projectId);
        const name = fromOffered?.name ?? fromDiscussed?.name ?? s.focus?.projectName;
        if (name) discussed.push({ projectId: goal.projectId, name });
      }
      return discussed.length ? recordDiscussed(s, discussed) : s;
    }
    case 'propose_visit':
      return { ...s, phase: 'visit' };
    case 'hold_propose':
      return { ...s, hold: goal.state };
    case 'hold_booked':
      return { ...s, hold: undefined };
    case 'visit_ask':
    case 'visit_propose':
      return { ...s, phase: 'visit', visit: goal.state };
    case 'visit_booked':
      return applyVisitBooked(
        s,
        goal.nextQueuedStop
          ? {
              projectId: goal.nextQueuedStop.projectId,
              projectName: goal.nextQueuedStop.projectName,
              ...(goal.nextQueuedStop.slotText ? { slotText: goal.nextQueuedStop.slotText } : {}),
            }
          : undefined,
      );
    case 'warm_ack':
      return { ...s, postVisitAckPending: false };
    case 'handoff':
      return { ...s, phase: 'handoff' };
    default:
      return s;
  }
}

function needsStructuredRepair(
  goal: TurnGoal,
  ev: EvidenceSet,
  reply: string,
  disclosedFacts?: ComposeRequest['context']['disclosedFacts'],
  buyerText?: string,
): boolean {
  if (goal.kind !== 'answer') return false;
  const topics = goal.topics?.length ? goal.topics : [goal.topic];
  const t = (buyerText ?? '').toLowerCase();
  if (topics.includes('legal') && ev.detail?.reraNumber && !/rera/i.test(reply)) {
    // P2c: facet follow-ups (banks/EC) or already-disclosed RERA must not force a RERA dump.
    const facetAsk =
      /\b(?:ec|encumbrance)\b/i.test(t) ||
      /\b(?:banks?|loans?|approv\w*|lenders?|financ(?:e|ing))\b/i.test(t);
    if (facetAsk || hasDisclosedRera(disclosedFacts, goal.projectId)) return false;
    return true;
  }
  // P3-D: banks / EC facet replies must mention the facet (not generic overview dump).
  if (topics.includes('legal')) {
    if (/\b(?:banks?|loans?|approv\w*|lenders?|financ(?:e|ing))\b/i.test(t) && ev.detail?.loanEligibility) {
      if (!/loan|bank|hdfc|icici|sbi|lender|financ/i.test(reply)) return true;
    }
    if (/\b(?:ec|encumbrance)\b/i.test(t) && ev.detail?.ecStatus) {
      if (!/\bec\b|encumbrance/i.test(reply)) return true;
    }
  }
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
  opts?: {
    ex?: Extracted;
    extractProvenance?: ExtractProvenance;
    inputSource?: TurnInputSource;
    grounding?: string;
    routing?: TurnRoutingResult;
  },
): Promise<void> {
  if (!nd) return;
  const buyerPhone = state.ndBuyerPhone ?? input.buyerPhone;
  const ledger = opts?.ex
    ? buildLedgerWritePayload({
        state,
        ex: opts.ex,
        goal,
        evidence,
        inputSource: opts.inputSource,
        extractProvenance: opts.extractProvenance,
        grounding: opts.grounding,
      })
    : null;

  // Each Desk write is isolated — a profile/obs failure must not skip journey
  // signals (dossier: Bot strategy present, Buyer profile + Journey empty).
  await deps.crm
    .appendTurnLedger({
      conversationId: nd,
      turnIndex: state.turnCount,
      builderId: state.builderId,
      buyerPhone,
      buyerText: input.text,
      reply,
      goal: goal.kind,
      tools: evidence.tools,
      offeredProjectIds: ledger?.offered_project_ids ?? evidence.matches?.map((m) => m.projectId),
      phase: state.phase,
      ...(ledger
        ? {
            snapshotIn: ledger.snapshot_in,
            resolvedIntent: ledger.resolved_intent,
            actionPlan: ledger.action_plan,
            verify: ledger.verify,
            composer: ledger.composer,
            toolRuns: ledger.tool_runs,
            disclosedFacts: ledger.disclosed_facts,
          }
        : {}),
    })
    .catch((err) => {
      console.error('[syncTelemetry] appendTurnLedger', nd, err);
    });

  await deps.crm
    .postJourneyTurnSnapshot(state.builderId, buyerPhone, nd, goal.kind, state.phase)
    .catch((err) => {
      console.error('[syncTelemetry] postJourneyTurnSnapshot', nd, err);
    });

  // Understanding Flywheel Wave A — feed the /operations/understanding board.
  // Wired only when UNDERSTANDING_CAPTURE is on; isolated like every other
  // Desk write so a capture failure never touches the buyer's turn.
  if (deps.crm.enqueueIntentReview) {
    // The routing verdict is threaded explicitly: buildRtiStateUpdate rebuilds
    // state.rti before this runs, so state.rti.lastRouting is already gone here.
    const sil = silDecision(opts?.routing ?? state.rti?.lastRouting);
    await deps.crm
      .enqueueIntentReview({
        builderId: state.builderId,
        conversationId: nd,
        buyerPhone: buyerPhone || 'unknown',
        turnIndex: state.turnCount,
        buyerText: input.text.slice(0, 2000),
        botReply: reply.slice(0, 4000),
        recentMessages: (state.discover.recentMessages ?? []).slice(-6).map((m) => ({
          role: m.role === 'buyer' ? ('user' as const) : ('bot' as const),
          text: m.text.slice(0, 500),
        })),
        silIntent: sil.intent,
        silScore: sil.score,
        silBindSource: sil.bindSource,
        speechAct: opts?.ex?.speechAct ?? '',
        language: '',
        projectFocus: state.focus?.projectId ?? '',
      })
      .catch((err) => {
        console.error('[syncTelemetry] enqueueIntentReview', nd, err);
      });
  }

  const observations: Array<{ fact_key: string; value: unknown; provenance: string }> = [];
  const prov = deskFactProvenance('regex');
  if (state.constraints.location) {
    observations.push({ fact_key: 'location_pref', value: state.constraints.location, provenance: prov });
  }
  if (state.constraints.budgetMaxInr) {
    observations.push({ fact_key: 'budget_inr', value: state.constraints.budgetMaxInr, provenance: prov });
  }
  if (state.constraints.bhk) {
    observations.push({ fact_key: 'bhk_preference', value: state.constraints.bhk, provenance: prov });
  }
  if (state.constraints.purpose) {
    observations.push({ fact_key: 'purpose', value: state.constraints.purpose, provenance: prov });
  }
  if (state.constraints.propertyType) {
    observations.push({ fact_key: 'property_interest', value: [state.constraints.propertyType], provenance: prov });
  }
  // Trade-off Advisor soft signals — mirror of advisor-weights.ts so the BPE
  // resolves the same ranking for a returning buyer (migration 0116 keys).
  // Advisor-web only (same gate as fetchRecommend).
  if ((input.channel ?? 'whatsapp') === 'advisor_web') {
    if (state.constraints.commuteHub) {
      observations.push({ fact_key: 'commute_hub', value: state.constraints.commuteHub, provenance: prov });
    }
    if (state.constraints.worries?.length) {
      observations.push({ fact_key: 'worries', value: state.constraints.worries, provenance: prov });
    }
    {
      const imp = importanceFromConstraints(state.constraints);
      if (imp.commute !== undefined) observations.push({ fact_key: 'commute_importance', value: imp.commute, provenance: prov });
      if (imp.schools !== undefined) observations.push({ fact_key: 'school_importance', value: imp.schools, provenance: prov });
      if (imp.budget !== undefined) observations.push({ fact_key: 'budget_importance', value: imp.budget, provenance: prov });
    if (imp.walkability !== undefined) observations.push({ fact_key: 'walkability_importance', value: imp.walkability, provenance: prov });
    if (imp.builder_trust !== undefined) observations.push({ fact_key: 'builder_trust_importance', value: imp.builder_trust, provenance: prov });
    if (imp.value !== undefined) observations.push({ fact_key: 'value_importance', value: imp.value, provenance: prov });
    }
  }
  if (state.focus) {
    observations.push({
      fact_key: 'focused_project',
      value: { project_id: state.focus.projectId, name: state.focus.projectName },
      provenance: prov,
    });
  }
  if (goal.kind === 'visit_booked') {
    observations.push({
      fact_key: 'visit_booked',
      value: { project_id: goal.projectId, label: goal.label, iso: goal.iso },
      provenance: prov,
    });
  }
  if (observations.length) {
    await deps.crm
      .postProfileObservations(state.builderId, buyerPhone, nd, observations)
      .catch((err) => {
        console.error(
          '[syncTelemetry] postProfileObservations',
          nd,
          buyerPhone,
          observations.map((o) => o.fact_key),
          err,
        );
      });
  }

  const journeyPost = buildJourneySignalPost(goal, state, evidence);
  await deps.crm
    .postJourneySignals(state.builderId, buyerPhone, nd, journeyPost.signals, {
      ...(journeyPost.shortlistAdd ? { shortlistAdd: journeyPost.shortlistAdd } : {}),
      ...(journeyPost.rejectedAdd ? { rejectedAdd: journeyPost.rejectedAdd } : {}),
    })
    .catch((err) => {
      console.error('[syncTelemetry] postJourneySignals', nd, err);
    });

  await deps.crm.mirrorMemory(nd).catch((err) => {
    console.error('[syncTelemetry] mirrorMemory', nd, err);
  });
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

async function completeRtiFocusCommit(
  state: ConversationState,
  focus: { projectId: string; projectName: string },
  input: EngineTurnInput,
  deps: EngineDeps,
  nd: string,
  buyerText: string,
): Promise<EngineTurnOutput> {
  const { projectId, projectName } = focus;
  if (nd) await deps.crm.commitProject(nd, projectId).catch(() => {});
  let s = await prefetchProjects(deps, state, [projectId]);
  const answerGoal: Extract<TurnGoal, { kind: 'answer' }> = {
    kind: 'answer',
    topic: 'overview',
    projectId,
  };
  const emptyEx = { constraints: s.constraints } as Extracted;
  const evidence = nd ? await fetchAnswer(answerGoal, s, emptyEx, deps, nd) : { tools: [] };
  const commitGoal: TurnGoal = { kind: 'commit', projectId, projectName, followUp: 'overview' };
  const req = buildComposeRequest(commitGoal, evidence, {
    buyerName: s.buyerName,
    constraints: s.constraints,
    alreadyShownSameSet: false,
    builderName: friendlyBuilder(s.builderId),
    buyerText,
    focusProjectName: projectName,
    returningBuyer: s.returningBuyer,
  });
  let reply = fallbackReply(req);
  try {
    const drafted = await deps.llm.compose(req);
    // AB-10 — keep the grounded floor if the draft strips to a pure directive.
    const cleaned = drafted.trim() ? stripComposerDirectives(stripBanned(drafted)) : '';
    if (cleaned.trim()) reply = cleaned;
  } catch {
    /* keep fallback */
  }

  s = { ...s, turnCount: s.turnCount + 1 };
  s = appendTranscript(s, buyerText, reply, deps.clock.nowMs());
  s = {
    ...s,
    rti: {
      ...s.rti,
      pendingPrompt: undefined,
      lastGoalKind: 'commit',
      lastUiMode: 'focused',
      lastReplyExcerpt: excerptReply(reply),
    },
  };

  await deps.store.save(s);
  await deps.store.logTurn({
    convId: s.convId,
    turnIndex: s.turnCount,
    buyerText,
    reply,
    phase: s.phase,
    goal: 'commit',
    grounding: 'pass',
  });
  await deps.crm.appendMessage(nd || input.convId, 'inbound', input.text).catch(() => {});
  await deps.crm.appendMessage(nd || input.convId, 'outbound', reply, { replyKey: 'rti_confirm' }).catch(() => {});

  return {
    reply,
    state: s,
    debug: withIngressDebug(
      { phase: s.phase, goal: { kind: 'commit', projectId, projectName }, tools: evidence.tools, grounding: 'pass' },
      resolveInputSource(input.action_id),
    ),
    uiMode: 'focused',
  };
}

function recoveryHintFromEvidence(ev: EvidenceSet): RecoveryHint {
  if (ev.propertyTypeGap) return 'property_type';
  if (ev.budgetGap) return 'budget';
  if (ev.constraintGap) return 'constraint';
  return 'general';
}

function recoveryHintFromState(state: ConversationState): RecoveryHint {
  const k = state.rti?.lastEvidenceKind;
  if (k === 'property_type_gap') return 'property_type';
  if (k === 'budget_gap') return 'budget';
  if (k === 'constraint_gap') return 'constraint';
  return 'general';
}

async function freshSearchRecovery(
  deps: EngineDeps,
  state: ConversationState,
  channel: TurnIntentChannel,
  hint?: RecoveryHint,
): Promise<SearchRecoveryEnvelope> {
  const catalog = await deps.data.catalog(state.builderId).catch(() => emptyCatalog());
  return planSearchRecovery({
    searchCount: async (f) => (await searchWithFilters(deps, state.builderId, f)).matches.length,
    catalog,
    constraints: state.constraints,
    reason: 'Adjust your search?',
    maxActions: channel === 'whatsapp' ? 3 : 6,
    variant: 'zero_match',
    hint: hint ?? recoveryHintFromState(state),
  });
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

/**
 * W2 — wipe lastOffered when search-shaping constraints moved and this turn is a re-search.
 * Not on pure facet asks (stay on current board / focus). No locality hardcode.
 */
function shouldInvalidateLastOffered(
  prev: ConversationState['constraints'],
  next: ConversationState['constraints'],
  text: string,
  ex: Extracted,
): boolean {
  // Explicit correction/refine phrasing always invalidates — even if extract missed a delta.
  if (isConstraintRefinementTurn(text) || isLocationCorrectionTurn(text)) return true;
  if (!constraintsMateriallyChanged(prev, next)) return false;
  if (ex.speechAct === 'search' || ex.forceRecommendList) return true;
  if (isDetailAskTurn(ex)) return false;
  return discover.hasNarrowingConstraint(next);
}

function withIngressDebug(
  base: TurnDebug,
  inputSource: TurnInputSource,
  extractProvenance?: ExtractProvenance,
): TurnDebug {
  return {
    ...base,
    input_source: inputSource,
    ...(extractProvenance ? { extract_provenance: extractProvenance } : {}),
    ...(extractProvenance?.speech_act ? { speech_act: extractProvenance.speech_act } : {}),
    ...(extractProvenance?.chip_path_ids?.length
      ? { chip_path_ids: extractProvenance.chip_path_ids }
      : {}),
  };
}
