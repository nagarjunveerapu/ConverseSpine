/**
 * ConverseEngine — the turn kernel.
 * extract → merge → phase transition → goal → evidence → compose → verify → persist
 */
import * as discover from './phases/discover.js';
import * as focused from './phases/focused.js';
import * as visit from './phases/visit.js';
import {
  exitVisitPhase,
  hasResumableVisitDraft,
  isVisitFollowUpQuestion,
  shouldExitVisitForIntent,
  shouldResumeVisitDraft,
} from './phases/visit.js';
import { isVisitDayUtterance } from './visit-slot.js';
import { isDifferentDayPhrase, isSameDayPhrase } from './visit-itinerary.js';
import * as handoff from './phases/handoff.js';
import { buildTurnLogSnapshot } from '../observability/turn-log-snapshot.js';
import { extractTurnAuthority } from './extract-authority.js';
import { hydrateStateFromFeedForward, mapLedgerPrior } from './ledger-read.js';
import { extractDisclosedFacts, hasDisclosedRera, mergeDisclosedFacts } from './disclosed-facts.js';
import { buildLedgerWritePayload } from './ledger-write.js';
import { deriveShadowFailures } from './failure-shadow.js';
import { resolveDurableLocation } from './geography-authority.js';
import { searchWithAuthorityRelaxation } from './search-outcome.js';
import { searchLocalityWiden } from './locality-widen.js';
import { currentShortlist, discussedList, discourseEntities } from './entity-store.js';
import {
  collapseCoverageMarkets,
  coverageCityCoverBit,
  coverageCoverBit,
  coverageOrderOptsFrom,
  inventoryNoun,
  isOutsideServedInventory,
  matchServedMarket,
  orderCoverageMarkets,
  outsideServedReply,
} from './coverage-areas.js';
import { looksLikePlaceFramedAsk } from './place-frame.js';
import {
  answerRequirements,
  enforceAnswerContract,
  withAnswerRequirements,
} from './answer-contract.js';
import type { Failure } from './outcome.js';
import {
  contactScopeFailure,
  isExplicitDeleteIntent,
  isStandaloneStop,
  resolvePendingStop,
} from './optout-confirm.js';
import { speakFailure } from './speak-failure.js';
import { speakStickyClarify } from './clarify-outstanding.js';
import { holdsFocusAgainstRelease } from './turn-routing/focus-hold.js';
import { speakEducation } from './education.js';
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
  splitComposeTopics,
  wantsCostBreakdown,
} from './facts.js';
import { buildJourneySignalPost, deskFactProvenance } from './journey-signals.js';
import { excludeParkedFaqKeys, isFaqShapedAsk, resolveFaqQuestionKeys, taughtFaqKey } from './faq-keys.js';
import { buyerCuedOtherProject } from './project_switch.js';
import { resolveCompareProjectIds } from './compare_resolve.js';
import {
  isCompareAmongOfferedTurn,
  hasTeachCompareStamp,
  prepareCompareExtracted,
  shouldAllowBudgetGapNoFit,
} from './turn-intent/compare-intent.js';
import { matchesFromLastOffered } from './matches-from-offered.js';
import { advisorSearchPrefs, importanceFromConstraints } from './advisor-weights.js';
import { findNearbyTypeOffer } from './nearby-offer.js';
import { isAskNextStepText } from './ask-next-step-detect.js';
import { resolveAskNextStepGoal, shouldConsumeAskNextStep } from './ask-next-step.js';
import { isAlternateDeixis, resolveFocusedSwitchGoal } from './project_switch.js';
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
  hydrateLegacyDiscourse,
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
import {
  hydrateProjectDetail,
  prefetchProjects,
  projectIdsFromMatches,
  promoteDurableProjectDetail,
  seedProjectCacheFromL2,
  writeProjectCardFromDetail,
} from './project-cache.js';
import { mediaKindMissingFromInventory, normalizeMediaAssetKind } from './media-asset.js';
import { attachmentFromMediaEvidence, type MediaAttachment } from './media-attachment.js';
import { gateMarketIntel } from './market-intel.js';
import { mergeEvidencePatches } from './merge-evidence-patches.js';
import { filterUnitsByBhk, resolveAvailabilityBhkFilter } from './unit-config.js';
import { focusUnitTypeForProject, pickFocusUnit } from './focus-unit.js';
import {
  hybridPreferTemplate,
  llmRateExceeded,
  needsPaidLlmFloor,
} from './hybrid.js';
import { hasPriceObjectionCue } from './price-objection.js';
import { planSearchRecovery, type RecoveryHint, type SearchRecoveryEnvelope, type AdvisorUiMode, type SuggestedAction } from './recovery-planner.js';
import {
  applyTurnIntentResult,
  buildTurnIntentInput,
  focusedUiMode,
  recoveryUiMode,
  shouldRunTurnIntent,
} from './turn-intent/classify.js';
import { arbitrateFocusPivot, isImplausibleLocationCapture } from './turn-intent/pivot-arbiter.js';
import { isNonPlaceUtterance, isPlausiblePlaceLabel } from './placeability.js';
import { buildRtiStateUpdate, excerptReply } from './turn-intent/pending-prompt.js';
import { extractRecoveryPatchFromText } from './turn-intent/extract-recovery-patch.js';
import { mergeRoutingTopicsIntoExtract } from './turn-routing/answer-topics.js';
import { classifyTurnRouting } from './turn-routing/classify.js';
import {
  applyIntentAuthority,
  catalogAskOwns,
  shouldSurfaceUnknownIntent,
} from './turn-routing/intent-authority.js';
import { failureFromUnsupportedRouting } from './turn-routing/unsupported-outcome.js';
import { detectProtectedIdentityFilter } from './turn-routing/fair-housing.js';
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
  ProjectDetail,
  RelaxedDimension,
  TurnDebug,
  TurnGoal,
} from './types.js';
import type { DataResult, EngineDeps } from './ports.js';

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
  /** A channel writer rejected a value at the shared authority boundary. */
  ingressFailure?: Failure;
  /**
   * Brief-phase free text: run the full extraction funnel and merge constraints,
   * then STOP — no goal selection, search, or compose. The merged constraints
   * ride back out via the prefs_snapshot the mapper already builds. This keeps
   * the SPA's chip funnel the single control point (a shortlist can never jump
   * the brief-ready gate) while natural language still reaches the one language
   * authority. See handle-turn `brief_extract`.
   */
  briefExtract?: boolean;
  /**
   * Cloudflare `ctx.waitUntil` — defers the post-reply Desk/telemetry tail off
   * the buyer's critical path (Bridge Stage 2). Absent in CLI/eval, where the
   * tail is awaited instead (unchanged behaviour).
   */
  waitUntil?: (p: Promise<unknown>) => void;
}

export interface EngineTurnOutput {
  reply: string;
  state: ConversationState;
  debug: TurnDebug;
  compareMatrix?: import('./types.js').CompareMatrixPayload;
  searchRecovery?: SearchRecoveryEnvelope;
  uiMode?: AdvisorUiMode;
  whatsappActions?: SuggestedAction[];
  /** Structured media for Advisor cards / WhatsApp native send — never in prose. */
  mediaAttachments?: MediaAttachment[];
}

export async function runEngineTurn(input: EngineTurnInput, deps: EngineDeps): Promise<EngineTurnOutput> {
  const turnStartedMs = deps.clock.nowMs();
  if (input.waitUntil && !deps.waitUntil) {
    deps = { ...deps, waitUntil: input.waitUntil };
  }
  const catalogMemo = new Map<string, Awaited<ReturnType<EngineDeps['data']['catalog']>>>();
  const baseCatalog = deps.data.catalog.bind(deps.data);
  deps = {
    ...deps,
    data: {
      ...deps.data,
      catalog: async (builderId: string) => {
        const hit = catalogMemo.get(builderId);
        if (hit !== undefined) return hit;
        const row = await baseCatalog(builderId);
        catalogMemo.set(builderId, row);
        return row;
      },
    },
  };
  let state = hydrateLegacyDiscourse(
    (await deps.store.load(input.convId)) ?? initState(input.convId, input.builderId),
  );
  // L2 → conversation cache when focus is cold (survives KV lag / thin saves).
  state = await seedProjectCacheFromL2(deps, state);
  if (!deps.projectCardMemo) deps.projectCardMemo = new Map();
  const inputSource = resolveInputSource(input.action_id);
  let preExtractMs: number | undefined;
  let extractMs: number | undefined;
  /** Extract end → goalT0 (routing / catalog name / location / phase prep). */
  let midPreGoalMs: number | undefined;
  /** Desk projectNames / catalog-name resolve wall inside mid (0 when reused). */
  let midCatalogMs: number | undefined;
  /** resolveDurableLocation + outside-served Desk wall inside mid. */
  let midLocationMs: number | undefined;
  /** Visit/phase Desk prep wall inside mid (coords/geo/builder/itinerary). */
  let midPhasePrepMs: number | undefined;
  /** Awaited classifyTurnRouting wall inside mid_pre_goal (0 when early reuse). */
  let routingMs: number | undefined;
  let evidenceMs: number | undefined;
  let composeMs: number | undefined;
  let goalMs: number | undefined;
  let postComposeMs: number | undefined;
  let storeSaveMs: number | undefined;
  /** Sync CRM on the buyer path before waitUntil (ensureLead / setStage). */
  let crmPreMs = 0;
  let llmUsed = false;
  let llmShed = false;
  let composeTemplate = false;

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
    const crmT0 = deps.clock.nowMs();
    const lead = await deps.crm.ensureLead(input.builderId, input.buyerPhone).catch(() => null);
    crmPreMs += deps.clock.nowMs() - crmT0;
    if (lead) state = withNdConversation(state, lead.conversationId, input.buyerPhone);
  }
  const nd = state.ndConversationId ?? '';

  // Desk bootstrap is expensive — only on cold conversations (first turn).
  // Later turns use Spine state + L1–L4; CRM sync rides waitUntil.
  if (nd && state.turnCount === 0) {
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

  if (deps.failureSearch && input.ingressFailure) {
    const reply = speakFailure(input.ingressFailure);
    state = { ...state, turnCount: state.turnCount + 1 };
    await deps.store.save(state);
    await deps.crm
      .appendMessage(nd || input.convId, 'inbound', input.text)
      .catch(() => {});
    await deps.crm
      .appendMessage(nd || input.convId, 'outbound', reply, {
        replyKey: `failure:${input.ingressFailure.subject}`,
      })
      .catch(() => {});
    await appendEarlyFailureLedger({
      deps,
      nd: nd || input.convId,
      input,
      state,
      ex: { constraints: {} },
      extractProvenance: undefined,
      inputSource,
      reply,
      failure: input.ingressFailure,
    });
    return {
      reply,
      state,
      debug: withIngressDebug(
        {
          phase: state.phase,
          goal: { kind: 'clarify_intent' },
          tools: [],
          grounding: 'pass',
        },
        inputSource,
      ),
    };
  }

  const channel: TurnIntentChannel = input.channel ?? 'whatsapp';
  const durableConstraintsBeforeTurn = { ...state.constraints };
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
  // THE WIRE — carried out of the pre-extract block; `extractProvenance` does
  // not exist yet at the point the release is vetoed.
  let focusHeldReason: { intent: string; score: number; topic: string } | undefined;
  let rtiFocusCommitted: { projectId: string; projectName: string } | undefined;
  let rtiSeedAskTopic: import('./types.js').AnswerTopic | undefined;

  // THE WIRE (focus-hold.ts). `shouldRunTurnIntent` reaches
  // `isFocusedSearchPivot`, a REGEX, and that regex decides whether a focused
  // turn is the buyer pivoting away to search. Measured on dev:
  //
  //   isFocusedSearchPivot("when is possession")           true   kept 0/6
  //   isFocusedSearchPivot("what is the possession date")  false  kept 6/6
  //   isFocusedSearchPivot("has this area appreciated")    true   kept 0/6
  //
  // Same intent to the embedder (ask_delivery_timeline, 0.874 vs 0.880) and
  // opposite outcomes, because a phrasing-shaped regex — not the understanding
  // layer — is the authority on what the buyer meant. Everything downstream
  // (the LLM classifier, the release, the shortlist that then BECOMES the
  // subject) is consequence, which is why patching those seams did nothing.
  //
  // So: when the regex calls a focused turn a pivot, ask the embedder before
  // believing it. A >=tau_high answer-intent bind means the buyer asked ABOUT
  // this project. The pivot lane is then skipped entirely — which also REPLACES
  // an LLM call with one embed on those turns, rather than adding work.
  let runTurnIntent = Boolean(
    deps.turnIntent &&
      !state.stopConfirmPending &&
      shouldRunTurnIntent(state, input.action_id, trimmedText),
  );
  // Phase 0d / GO H — join extract ∥ routing on focused free-text.
  // UBM previously gated this on runTurnIntent; facet asks skip RTI so the
  // parallel never started and mid paid serial routing (~200–450ms) after
  // extract (~650ms). Same empty-Extracted routing inputs as UBM already used
  // (SIL_EMBED_FIRST is text+state first; post-join applyIntentAuthority +
  // mergeRoutingTopicsIntoExtract still see the full extract).
  // Reused later as the main extract / precomputedRouting (no double work).
  let earlyExtractBundle:
    | Awaited<ReturnType<typeof extractTurnAuthority>>
    | undefined;
  let earlyPrecomputedRouting: TurnRoutingResult | undefined;
  let pivotArbiterReason: string | undefined;
  /** Routing component wall from early Promise.all (overlapped under extract join). */
  let earlyRoutingComponentMs: number | undefined;
  /** Promise.all join wall = max(extract, routing). */
  let earlyJoinMs: number | undefined;
  /** Catalog row for this turn — early path + mid name resolve (avoid bare projectNames). */
  let catalogForTurn: Awaited<ReturnType<EngineDeps['data']['catalog']>> | null = null;

  const wantEarlyExtractRouting =
    !input.action_id &&
    state.phase === 'focused' &&
    !!deps.routingEnv &&
    !!(deps.understandingBeforeMutation || deps.failureSearch);

  if (wantEarlyExtractRouting) {
    // Attribute understand work to extract/routing — not pre_extract.
    preExtractMs = deps.clock.nowMs() - turnStartedMs;
    const priorConstraints = { ...state.constraints };
    catalogForTurn = await deps.data.catalog(state.builderId).catch(() => null);
    const earlyT0 = deps.clock.nowMs();
    const extractP = extractTurnAuthority(
      trimmedText,
      state,
      state.builderId,
      {
        llm: deps.llm,
        semantic: deps.semantic,
        microMarkets: catalogForTurn?.microMarkets ?? [],
        catalogNames: catalogForTurn?.projectNames ?? [],
        ...(deps.failureTools ? { failureTools: true } : {}),
        ...(deps.bamlExtract
          ? { bamlExtract: deps.bamlExtract, bamlMode: deps.bamlMode ?? 'off' }
          : {}),
        ...(deps.intentRecover
          ? {
              intentRecover: deps.intentRecover,
              intentRecoveryMode: deps.intentRecoveryMode ?? 'off',
            }
          : {}),
        ...(deps.topicUnion ? { topicUnion: true } : {}),
        ...(deps.waitUntil ? { waitUntil: deps.waitUntil } : {}),
      },
      {
        inputSource,
        ingressFilledSlots: ingressFilled,
        actionId: input.action_id,
      },
    );
    const routingP = classifyTurnRouting(
      deps.routingEnv,
      buildTurnRoutingInput(state, {} as Extracted, trimmedText, inputSource),
    )
      .then((r) => {
        earlyRoutingComponentMs = deps.clock.nowMs() - earlyT0;
        return r;
      })
      .catch(() => undefined);
    const [extractBundle, routingEarly] = await Promise.all([extractP, routingP]);
    earlyJoinMs = deps.clock.nowMs() - earlyT0;
    earlyExtractBundle = extractBundle;
    earlyPrecomputedRouting = routingEarly;
    // Pivot arbiter only when RTI might release focus (UBM). Latency parallel
    // still runs when runTurnIntent is false (common focused facet path).
    if (runTurnIntent && deps.understandingBeforeMutation) {
      const decision = arbitrateFocusPivot({
        text: trimmedText,
        priorConstraints,
        ex: extractBundle.extracted,
        routing: routingEarly,
        enabled: true,
      });
      pivotArbiterReason = decision.reason;
      if (decision.action === 'hold_focus') {
        runTurnIntent = false;
        const held = holdsFocusAgainstRelease(routingEarly, true);
        if (held.hold) focusHeldReason = held.reason;
      }
      // SIL compare_projects → askTopic compare: among-offered, not RTI pivot.
      if (hasTeachCompareStamp(extractBundle.extracted)) {
        runTurnIntent = false;
      }
    }
  } else if (
    runTurnIntent &&
    deps.routingInGoal &&
    deps.routingEnv &&
    !input.action_id &&
    state.phase === 'focused'
  ) {
    // Legacy THE WIRE (#159) — dig keeps ROUTING_IN_GOAL=false; path retained
    // for rollback. Prefer UNDERSTANDING_BEFORE_MUTATION when both set.
    const earlyRouting = await classifyTurnRouting(
      deps.routingEnv,
      buildTurnRoutingInput(state, {} as Extracted, trimmedText, inputSource),
    ).catch(() => undefined);
    const held = holdsFocusAgainstRelease(earlyRouting, true);
    if (held.hold) {
      runTurnIntent = false;
      focusHeldReason = held.reason;
    }
  }

  if (runTurnIntent && deps.turnIntent) {
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

    // Recovery-lane escape hatch: an ABSTAINED classification means neither
    // rules nor the classifier understood the turn — exactly the case the
    // full pipeline (embedder + extraction + goal machinery) exists for. Same
    // when the canned probe would repeat the previous reply verbatim (the
    // "same three chips again" defect, ten-buyers S08/S09). Fall through to
    // the main pipeline instead of early-returning the canned probe.
    const probeFallsThrough =
      Boolean(applied.probeReply) &&
      (intent.confidence === 'abstain' ||
        excerptReply(applied.probeReply ?? '') === state.rti?.lastReplyExcerpt);

    // Phase 2 — ask_next_step must reach decideGoalAsync (state-conditioned
    // consumer). A pending recovery/nearby chip menu must not swallow it into
    // the canned RTI probe (which debug-labels as no_fit).
    if (
      applied.probeReply &&
      !probeFallsThrough &&
      !isAskNextStepText(trimmedText)
    ) {
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

  // Itinerary anaphora ("same day …") is never a focus commit — always schedule.
  if (isSameDayPhrase(trimmedText) || isDifferentDayPhrase(trimmedText)) {
    rtiFocusCommitted = undefined;
    state = { ...state, phase: 'visit' };
  }
  if (rtiFocusCommitted) {
    return completeRtiFocusCommit(state, rtiFocusCommitted, input, deps, nd, trimmedText);
  }

  // Prefer catalog already loaded on the early extract∥routing path so mid
  // name-resolve and compare seeding do not pay a second Desk search.
  const catalogForNlu =
    catalogForTurn ??
    (await deps.data.catalog(state.builderId).catch(() => null));
  if (!catalogForTurn) catalogForTurn = catalogForNlu;
  const extractT0 = deps.clock.nowMs();
  if (preExtractMs === undefined) {
    preExtractMs = extractT0 - turnStartedMs;
  }
  const extractResult =
    earlyExtractBundle ??
    (await extractTurnAuthority(
      trimmedText,
      state,
      state.builderId,
      {
        llm: deps.llm,
        semantic: deps.semantic,
        microMarkets: catalogForNlu?.microMarkets ?? [],
        catalogNames: catalogForNlu?.projectNames ?? [],
        ...(deps.failureTools ? { failureTools: true } : {}),
        ...(deps.bamlExtract
          ? { bamlExtract: deps.bamlExtract, bamlMode: deps.bamlMode ?? 'off' }
          : {}),
        ...(deps.intentRecover
          ? {
              intentRecover: deps.intentRecover,
              intentRecoveryMode: deps.intentRecoveryMode ?? 'off',
            }
          : {}),
        ...(deps.topicUnion ? { topicUnion: true } : {}),
        ...(deps.waitUntil ? { waitUntil: deps.waitUntil } : {}),
      },
      {
        inputSource,
        ingressFilledSlots: ingressFilled,
        actionId: input.action_id,
      },
    ));
  // Early parallel: extract_ms = join wall (max); routing_ms = overlapped
  // component (not nested in mid — probe residual must not subtract twice).
  extractMs =
    earlyExtractBundle && earlyJoinMs !== undefined
      ? earlyJoinMs
      : deps.clock.nowMs() - extractT0;
  const midPreGoalT0 = deps.clock.nowMs();
  // Early reuse: stamp routing component for visibility; mid awaits add 0.
  let routingMsAcc =
    earlyPrecomputedRouting && earlyRoutingComponentMs !== undefined
      ? earlyRoutingComponentMs
      : 0;
  let ex: Extracted = extractResult.extracted;
  const extractProvenance = extractResult.provenance;
  // Soft visit-slot answer while focused (saturday + coming from) — bind visit
  // before discover clarify, even if recovery/embed missed.
  if (
    state.focus &&
    !(ex.transition && ex.transition !== 'none') &&
    /\b(?:saturday|sunday|monday|tuesday|wednesday|thursday|friday|weekend)\b/i.test(
      trimmedText,
    ) &&
    /\b(?:coming from|starting from|from)\b/i.test(trimmedText)
  ) {
    ex = { ...ex, transition: 'want_visit', speechAct: 'visit_book' };
    if (extractProvenance) {
      extractProvenance.fields.transition = extractProvenance.fields.transition ?? 'bridge';
    }
  }
  // Outstanding latch: after price disclosure / focused, evaluative cost cues → objection.
  if (state.focus && !ex.objection && hasPriceObjectionCue(trimmedText)) {
    ex = {
      ...ex,
      objection: true,
      objectionTopic: 'price',
      speechAct: ex.speechAct === 'unknown' || !ex.speechAct ? 'object' : ex.speechAct,
      askTopic: undefined,
      askTopics: undefined,
    };
    if (extractProvenance) {
      extractProvenance.fields.objection = 'bridge';
    }
  }
  if (focusHeldReason && extractProvenance) extractProvenance.focus_held = focusHeldReason;
  if (pivotArbiterReason && extractProvenance) {
    extractProvenance.pivot_arbiter = pivotArbiterReason;
  }

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

  // Compare-among-offered stays on the current phase. prepareCompareExtracted
  // seeds compare IDs from lastOffered; focused.decide answers the matrix.
  // (Old path released focus → discover recommend shortlist dump.)

  ex = prepareCompareExtracted(trimmedText, state, ex);
  // Named multi-project turns without the word "compare" still need compare IDs —
  // but not on a fresh search board (embedder names are not a shortlist).
  const freshSearchBoard =
    currentShortlist(state).length === 0 &&
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
        : resolveCompareProjectIds(
            trimmedText,
            ex,
            state,
            catalogForNlu?.projectNames ?? [],
          ),
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
      ...currentShortlist(state).map((o) => o.name),
      ...discussedList(state).map((p) => p.name),
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
      ...currentShortlist(state).map((o) => o.name),
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
  // 0d — "has this area appreciated" must not become constraints.location and
  // trip locationBroaden → releaseToDiscover (focus cliff unrelated to search).
  if (
    ex.constraints.location &&
    isImplausibleLocationCapture(ex.constraints.location, trimmedText)
  ) {
    const { location: _junkLoc, ...restConstraints } = ex.constraints;
    ex = { ...ex, constraints: restConstraints };
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
  // Amenity-only "park?" must not become location+amenities (LI parks category).
  {
    const liCats = locationCategoriesAsked(trimmedText);
    const amenityOnlyParks =
      !!ex.askTopics?.includes('amenities') &&
      liCats.length > 0 &&
      liCats.every((c) => c === 'parks');
    if (
      (ex.askTopics?.length ?? 0) >= 1 &&
      !ex.askTopics?.includes('location') &&
      liCats.length > 0 &&
      !amenityOnlyParks
    ) {
      ex = { ...ex, askTopics: [...(ex.askTopics ?? []), 'location'] };
    }
  }

  // Cold catalog name resolve BEFORE routing/unsupported — so "Brigade Eldorado
  // what's the price?" stamps namedProjects and declines definition→education.
  // Not gated on location (that wrongly skipped pure named+facet asks).
  // GO I — reuse catalog.projectNames when already in hand (same rows as
  // projectNames(); avoids a second uncached searchProjects on warm mid).
  let prevalidatedCatalogHit:
    | { projectId: string; name: string }
    | undefined;
  {
    const catalogT0 = deps.clock.nowMs();
    if (
      deps.failureSearch &&
      !state.stopConfirmPending &&
      !(ex.namedProjects?.length)
    ) {
      const names =
        catalogForTurn?.projectNames?.length
          ? catalogForTurn.projectNames
          : await deps.data
              .projectNames(state.builderId)
              .catch(() => [] as Array<{ projectId: string; name: string }>);
      prevalidatedCatalogHit =
        resolveCatalogNameHit(trimmedText, names) ?? undefined;
      if (prevalidatedCatalogHit) {
        ex = {
          ...ex,
          namedProjects: [prevalidatedCatalogHit],
        };
      }
    }
    midCatalogMs = deps.clock.nowMs() - catalogT0;
  }

  // Route the final extracted turn before geography persistence when Phase 3
  // is live. This does not mutate state; it lets semantic owners reject a
  // spurious location capture before the Desk is asked to validate it.
  let precomputedRouting: TurnRoutingResult | undefined = earlyPrecomputedRouting;
  let authorityClaimed = false;
  if (deps.failureSearch && !precomputedRouting) {
    const routingT0 = deps.clock.nowMs();
    precomputedRouting = await classifyTurnRouting(
      deps.routingEnv,
      buildTurnRoutingInput(state, ex, trimmedText, inputSource),
    );
    routingMsAcc += deps.clock.nowMs() - routingT0;
    if (deps.routingEnv?.SIL_EMBED_FIRST === 'true') {
      const claimed = applyIntentAuthority(ex, precomputedRouting, trimmedText);
      authorityClaimed = claimed.wrote.length > 0;
      if (claimed.wrote.length) {
        ex = claimed.ex;
        for (const slot of claimed.wrote) {
          if (extractProvenance) extractProvenance.fields[slot] = 'intent';
        }
      }
    }
  }
  if (ex.constraints.location) {
    const namedProjectEcho =
      ex.namedProjects?.some((project) =>
        locationEchoesProjectName(ex.constraints.location!, [project.name]),
      ) ?? false;
    if (
      namedProjectEcho ||
      state.stopConfirmPending ||
      ex.stop ||
      ex.wantsHuman ||
      precomputedRouting?.routing === 'unsupported'
    ) {
      const { location: _ignored, ...constraints } = ex.constraints;
      ex = { ...ex, constraints };
    }
  }

  let locationValidated = false;
  {
    const locationT0 = deps.clock.nowMs();
    if (deps.failureSearch) {
    const locationCandidate =
      ex.constraints.location ??
      (state.constraints.location !== durableConstraintsBeforeTurn.location
        ? state.constraints.location
        : undefined);
    if (locationCandidate) {
      const resolved = await resolveDurableLocation(locationCandidate, deps.data);
      if (!resolved.ok) {
        const locationOwnedByTurn =
          precomputedRouting?.routing === 'search_pivot' ||
          ex.speechAct === 'search' ||
          ingressFilled.has('location') ||
          Boolean(
            ex.constraints.bhk ||
              ex.constraints.propertyType ||
              ex.constraints.budgetMaxInr !== undefined ||
              ex.constraints.budgetMinInr !== undefined,
          );
        if (!locationOwnedByTurn) {
          if (ex.constraints.location) {
            const { location: _ignored, ...constraints } = ex.constraints;
            ex = { ...ex, constraints };
          }
          if (
            state.constraints.location !==
            durableConstraintsBeforeTurn.location
          ) {
            state = {
              ...state,
              constraints: {
                ...state.constraints,
                ...(durableConstraintsBeforeTurn.location
                  ? { location: durableConstraintsBeforeTurn.location }
                  : {}),
              },
            };
            if (!durableConstraintsBeforeTurn.location) {
              delete state.constraints.location;
            }
          }
        } else {
          // Desk did not resolve this place (registry/cache/geocode miss).
          // Served list = live catalog micro-markets — never a hardcoded metro list.
          // Soft-match → adopt. Else → outside coverage from that same catalog.
          const cat = await deps.data.catalog(state.builderId).catch(() => null);
          const markets = cat?.microMarkets ?? [];
          const served = matchServedMarket(locationCandidate, markets);
          if (served) {
            locationValidated = true;
            // Keep buyer phrasing when already declared (advisor chip / prior
            // declare). Soft-adopting a catalog micro-market ("Aerospace Park")
            // over "North Bangalore" polluted prefs/recall (ADVX-01).
            const keepDeclaredLabel =
              state.constraintAuthority?.location === 'declared' &&
              Boolean(state.constraints.location?.trim());
            const durableLabel = keepDeclaredLabel
              ? (state.constraints.location as string).trim()
              : served.name;
            if (ex.constraints.location) {
              ex = {
                ...ex,
                constraints: { ...ex.constraints, location: durableLabel },
              };
            }
            state = {
              ...state,
              constraints: { ...state.constraints, location: durableLabel },
              constraintAuthority: {
                ...(state.constraintAuthority ?? {}),
                // Score 3/2 → declared (hard). Score 1 (token/typo) → inferred
                // so Phase-3 relaxation can still release a weak adopt.
                location: keepDeclaredLabel ? 'declared' : served.authority,
              },
            };
          } else if (!looksLikePlaceFramedAsk(input.text)) {
            // Unresolved + not place-framed ("Buy, 70 lakh") — drop locality,
            // continue with the rest of the brief. Outside-served is for
            // explicit in/near asks, not a denylist of transaction verbs.
            if (ex.constraints.location) {
              const { location: _drop, ...constraints } = ex.constraints;
              ex = { ...ex, constraints };
            }
            state = {
              ...state,
              constraints: {
                ...state.constraints,
                ...(durableConstraintsBeforeTurn.location
                  ? { location: durableConstraintsBeforeTurn.location }
                  : {}),
              },
            };
            if (!durableConstraintsBeforeTurn.location) {
              delete state.constraints.location;
            }
          } else {
            const asked = locationCandidate.trim();
            const failure: Failure = {
              kind: 'no_match',
              stage: 'search',
              subject: 'area',
            };
            const [askGeo, coordRows] = await Promise.all([
              deps.data.resolveGeo(asked).catch(() => null),
              deps.data.projectCoords(state.builderId).catch(() => []),
            ]);
            const orderOpts = coverageOrderOptsFrom({
              ask: askGeo,
              projectCoords: coordRows,
            });
            const reply = outsideServedReply(asked, markets, {
              ...orderOpts,
              servedCities: cat?.servedCities ?? [],
              propertyType:
                ex.constraints.propertyType ?? state.constraints.propertyType,
              bhk: ex.constraints.bhk ?? state.constraints.bhk,
            });
            state = {
              ...state,
              constraints: {
                ...state.constraints,
                ...(durableConstraintsBeforeTurn.location
                  ? { location: durableConstraintsBeforeTurn.location }
                  : {}),
              },
              turnCount: state.turnCount + 1,
            };
            if (!durableConstraintsBeforeTurn.location) delete state.constraints.location;
            if (ex.constraints.location) {
              const { location: _drop, ...constraints } = ex.constraints;
              ex = { ...ex, constraints };
            }
            await deps.store.save(state);
            await deps.crm
              .appendMessage(nd || input.convId, 'inbound', input.text)
              .catch(() => {});
            await deps.crm
              .appendMessage(nd || input.convId, 'outbound', reply, {
                replyKey: 'failure:outside_served',
              })
              .catch(() => {});
            await appendEarlyFailureLedger({
              deps,
              nd: nd || input.convId,
              input,
              state,
              ex,
              extractProvenance,
              inputSource,
              reply,
              failure,
            });
            return {
              reply,
              state,
              debug: withIngressDebug(
                {
                  phase: state.phase,
                  goal: { kind: 'no_fit' },
                  tools: ['catalog'],
                  grounding: 'pass',
                },
                inputSource,
              ),
            };
          }
        }
      } else {
        // Stage 6 — Desk geocode can resolve Mumbai/Andheri while inventory is
        // Bangalore-only. Distance to nearest project pin beats "place exists".
        const askPoint =
          typeof resolved.value.lat === 'number' && typeof resolved.value.lng === 'number'
            ? { lat: resolved.value.lat, lng: resolved.value.lng }
            : null;
        const coordRows = await deps.data.projectCoords(state.builderId).catch(() => []);
        if (
          askPoint &&
          looksLikePlaceFramedAsk(input.text) &&
          isOutsideServedInventory(askPoint, coordRows)
        ) {
          const asked = locationCandidate.trim();
          const failure: Failure = {
            kind: 'no_match',
            stage: 'search',
            subject: 'area',
          };
          const cat = await deps.data.catalog(state.builderId).catch(() => null);
          const markets = cat?.microMarkets ?? [];
          const orderOpts = coverageOrderOptsFrom({
            ask: askPoint,
            projectCoords: coordRows,
          });
          const reply = outsideServedReply(asked, markets, {
            ...orderOpts,
            servedCities: cat?.servedCities ?? [],
            propertyType:
              ex.constraints.propertyType ?? state.constraints.propertyType,
            bhk: ex.constraints.bhk ?? state.constraints.bhk,
          });
          state = {
            ...state,
            constraints: {
              ...state.constraints,
              ...(durableConstraintsBeforeTurn.location
                ? { location: durableConstraintsBeforeTurn.location }
                : {}),
            },
            turnCount: state.turnCount + 1,
          };
          if (!durableConstraintsBeforeTurn.location) delete state.constraints.location;
          if (ex.constraints.location) {
            const { location: _drop, ...constraints } = ex.constraints;
            ex = { ...ex, constraints };
          }
          await deps.store.save(state);
          await deps.crm
            .appendMessage(nd || input.convId, 'inbound', input.text)
            .catch(() => {});
          await deps.crm
            .appendMessage(nd || input.convId, 'outbound', reply, {
              replyKey: 'failure:outside_served',
            })
            .catch(() => {});
          await appendEarlyFailureLedger({
            deps,
            nd: nd || input.convId,
            input,
            state,
            ex,
            extractProvenance,
            inputSource,
            reply,
            failure,
          });
          return {
            reply,
            state,
            debug: withIngressDebug(
              {
                phase: state.phase,
                goal: { kind: 'no_fit' },
                tools: ['catalog'],
                grounding: 'pass',
              },
              inputSource,
            ),
          };
        }

        locationValidated = true;
        // Validity gate only — keep the buyer/chip label. Desk maps regional
        // asks ("North Bangalore") onto coverage pin names ("Aerospace Park");
        // writing that into constraints polluted prefs_snapshot / recall.
        // Search still expands via Desk expanded_locations / geo.
        const durableLabel = locationCandidate.trim();
        if (ex.constraints.location) {
          ex = {
            ...ex,
            constraints: {
              ...ex.constraints,
              location: durableLabel,
            },
          };
        } else {
          state = {
            ...state,
            constraints: {
              ...state.constraints,
              location: durableLabel,
            },
            constraintAuthority: {
              ...(state.constraintAuthority ?? {}),
              location: 'declared',
            },
          };
        }
      }
    }
    }
    midLocationMs = deps.clock.nowMs() - locationT0;
  }

  const prevConstraints = state.constraints;
  const prevLoc = state.constraints.location;
  state = applyExtracted(state, ex, clearedKeys, {
    locationValidated,
    authority: {
      ...(ex.constraints.location ? { location: 'declared' as const } : {}),
      ...(ex.constraints.propertyType
        ? {
            propertyType:
              detectPropertyTypes(trimmedText) ||
              ingressFilled.has('propertyType')
                ? ('declared' as const)
                : ('inferred' as const),
          }
        : state.constraints.propertyType !==
            durableConstraintsBeforeTurn.propertyType
          ? { propertyType: 'declared' as const }
        : {}),
      ...(ex.constraints.bhk ||
      state.constraints.bhk !== durableConstraintsBeforeTurn.bhk
        ? { bhk: 'declared' as const }
        : {}),
      ...(ex.constraints.budgetMaxInr !== undefined ||
      ex.constraints.budgetMinInr !== undefined ||
      state.constraints.budgetMaxInr !==
        durableConstraintsBeforeTurn.budgetMaxInr ||
      state.constraints.budgetMinInr !==
        durableConstraintsBeforeTurn.budgetMinInr
        ? { budget: 'declared' as const }
        : {}),
    },
  });

  // W2: constraint pivot invalidates stale shortlist — no catalog names; delta-driven.
  if (
    currentShortlist(state).length > 0 &&
    shouldInvalidateLastOffered(prevConstraints, state.constraints, trimmedText, ex)
  ) {
    state = clearLastOffered(state);
  }

  // Brief-phase free text (SPA chip funnel still open): the extraction funnel has
  // run and the constraints are now merged into state — STOP here. No goal, no
  // search, no compose. The merged brief rides back out via the prefs_snapshot the
  // mapper builds from state.constraints; the SPA pre-fills its chips and its own
  // brief-ready gate still decides when the first real turn fires. turnCount is
  // left untouched so the post-brief first turn behaves exactly as today.
  if (input.briefExtract) {
    await deps.store.save(state);
    await deps.crm.appendMessage(nd || input.convId, 'inbound', input.text).catch(() => {});
    return {
      reply: '',
      state,
      debug: withIngressDebug(
        {
          phase: state.phase,
          goal: { kind: 'orient' },
          tools: [],
          grounding: 'pass',
          ...(extractProvenance ? { extract_provenance: extractProvenance } : {}),
        },
        inputSource,
      ),
    };
  }

  let routing: TurnRoutingResult;
  if (precomputedRouting) {
    routing = precomputedRouting;
  } else {
    const routingT0 = deps.clock.nowMs();
    routing = await classifyTurnRouting(
      deps.routingEnv,
      buildTurnRoutingInput(state, ex, trimmedText, inputSource),
    );
    routingMsAcc += deps.clock.nowMs() - routingT0;
  }
  // SIL Phase 0 — surface the semantic-layer verdict per turn in the debug
  // channel that survives the /chat route re-shape (LLD §3.3).
  if (extractProvenance && routing.bind) {
    extractProvenance.routing_bind = routing.bind;
  }

  // The intent verdict fills the meaning slots NOTHING else owns — see
  // turn-routing/intent-authority.ts for why that is a seam and not a second
  // authority. Placed here deliberately: after routing, and BEFORE the ex.stop
  // branch below, so an embedding-recognised opt-out reuses the existing
  // confirm-before-delete gate instead of inventing a second destructive path.
  if (deps.routingEnv?.SIL_EMBED_FIRST === 'true') {
    const claimed = applyIntentAuthority(ex, routing, trimmedText);
    authorityClaimed = authorityClaimed || claimed.wrote.length > 0;
    if (claimed.wrote.length) {
      ex = claimed.ex;
      // Stamp the slot, not a synthetic key, so the ledger's existing
      // provenance.fields tally shows the intent layer's real contribution.
      for (const slot of claimed.wrote) {
        if (extractProvenance) extractProvenance.fields[slot] = 'intent';
      }
    }
  }
  // Multi-intent Phase B — routing's answer_topics union into extract (set grows only).
  {
    const before = ex.askTopics?.length ?? (ex.askTopic ? 1 : 0);
    ex = mergeRoutingTopicsIntoExtract(ex, routing);
    const after = ex.askTopics?.length ?? (ex.askTopic ? 1 : 0);
    if (after > before && extractProvenance) {
      extractProvenance.fields.askTopics = extractProvenance.fields.askTopics ?? 'intent';
    }
  }
  // SIL compare_projects → answer_topic compare lands above; seed shortlist IDs
  // here (prepareCompare earlier only saw closed "compare" text cues).
  if (hasTeachCompareStamp(ex) || routing.routing === 'compare_offered') {
    ex = prepareCompareExtracted(trimmedText, state, {
      ...ex,
      askTopic: ex.askTopic ?? 'compare',
      askTopics: ex.askTopics?.includes('compare')
        ? ex.askTopics
        : (['compare', ...(ex.askTopics ?? [])] as Extracted['askTopics']),
    });
  }
  // Loan FactKey/FAQ owns the turn — never let a brochure embedder leave
  // askTopic=media (that shared the PDF for "can I get the loan?").
  // Wave 3 — keep media when the buyer also explicitly asked for photos/brochure.
  if (
    answerRequirements(trimmedText).includes('loan_eligibility') ||
    resolveFaqQuestionKeys(trimmedText).includes('loan_eligibility') ||
    resolveFaqQuestionKeys(trimmedText).includes('banks')
  ) {
    const wantsExplicitMedia =
      /\b(?:photos?|images?|pics?|gallery|brochure|floor\s*plans?|layout|video|pdf)\b/i.test(
        trimmedText,
      );
    const topics = (ex.askTopics?.length ? ex.askTopics : ex.askTopic ? [ex.askTopic] : []).filter(
      (t) => t !== 'media' || wantsExplicitMedia,
    );
    const withLegal = topics.includes('legal')
      ? topics
      : (['legal', ...topics] as NonNullable<Extracted['askTopics']>);
    const withMedia =
      wantsExplicitMedia && !withLegal.includes('media')
        ? ([...withLegal, 'media'] as NonNullable<Extracted['askTopics']>)
        : withLegal;
    // Focused loan + BHK/config — stay on answer multi; do not search-pivot.
    const keepFocusedInventory =
      !!state.focus &&
      /\b(?:\d+\s*bhk|configs?|configurations?|units?|inventory|what'?s\s+available)\b/i.test(
        trimmedText,
      );
    const withAvail =
      keepFocusedInventory && !withMedia.includes('availability')
        ? ([...withMedia, 'availability'] as NonNullable<Extracted['askTopics']>)
        : withMedia;
    const rest = wantsExplicitMedia
      ? ex
      : (() => {
          const { mediaAssetKind: _dropMedia, ...stripped } = ex;
          return stripped;
        })();
    ex = {
      ...rest,
      askTopic: 'legal',
      askTopics: withAvail,
      ...(keepFocusedInventory
        ? { speechAct: 'answer' as const, forceRecommendList: false, wantsMore: false }
        : {}),
    };
  }
  // Visit chooser / origin / day-time answers ("both", "1 and 2", "Whitefield")
  // often embedder-miss below_tau — never convert those into unknown_request
  // before visit.decide owns the turn.
  const visitSchedulingPending =
    state.phase === 'visit' &&
    !!state.visit?.lastAsk &&
    [
      'which_projects',
      'origin',
      'window',
      'day',
      'time',
      'split_day',
      'team_request',
      'same_day_choice',
      'stagger_propose',
      'project',
    ].includes(state.visit.lastAsk);

  if (
    deps.failureRouting &&
    !state.stopConfirmPending &&
    !visitSchedulingPending &&
    shouldSurfaceUnknownIntent(ex, routing, authorityClaimed, trimmedText)
  ) {
    routing = {
      routing: 'unsupported',
      confidence: 'abstain',
      policy: 'unknown',
      subject: 'unknown_request',
      ...(routing.embedder_intent_kind
        ? { embedder_intent_kind: routing.embedder_intent_kind }
        : {}),
      ...(routing.embedder_score !== undefined
        ? { embedder_score: routing.embedder_score }
        : {}),
      ...(routing.bind ? { bind: routing.bind } : {}),
    };
  }

  state = {
    ...state,
    rti: {
      ...state.rti,
      lastRouting: routing,
    },
  };

  // Fair-housing refusals always speak — even if FAILURE_ROUTING is off.
  // A miss here is complying with a discriminatory ask, not "no answer".
  const unsupportedFailure =
    (deps.failureRouting ? failureFromUnsupportedRouting(routing) : undefined) ??
    (detectProtectedIdentityFilter(trimmedText)
      ? ({
          kind: 'unsupported',
          stage: 'route',
          subject: 'protected_identity_filter',
          detail: { policy: 'prohibited', floor: 'keyword' },
        } satisfies Failure)
      : undefined);
  // unknown_request must not eclipse an outstanding visit scheduling ask
  if (
    unsupportedFailure &&
    visitSchedulingPending &&
    unsupportedFailure.subject === 'unknown_request'
  ) {
    // fall through to visit.decide
  } else if (unsupportedFailure) {
    // Education resolver lives ONLY inside Phase-2 definition ownership —
    // not a second early owner before geo/search.
    const definitionPolicy =
      unsupportedFailure.kind === 'unsupported' &&
      unsupportedFailure.detail &&
      typeof unsupportedFailure.detail === 'object' &&
      (unsupportedFailure.detail as { policy?: string }).policy === 'definition';

    let reply: string;
    let evidence: EvidenceSet = { tools: [], failure: unsupportedFailure };
    let goal: TurnGoal = { kind: 'clarify_intent' };
    let replyKey = `failure:${unsupportedFailure.subject}`;
    let failureForLedger: Failure = unsupportedFailure;

    if (definitionPolicy) {
      const edu = await deps.data
        .educationSearch(input.text, { jurisdiction: 'karnataka' })
        .catch(() => null);
      if (edu) {
        evidence = { tools: ['educationSearch'], education: edu };
        goal = {
          kind: 'answer',
          topic: 'education',
          projectId: state.focus?.projectId ?? '',
        };
        reply = speakEducation(edu);
        replyKey = `education:${edu.topicKey}`;
        failureForLedger = unsupportedFailure; // routed as definition; KB answered
      } else {
        await deps.data
          .enqueueEducationMiss({
            buyerText: input.text,
            conversationId: nd || input.convId,
            suggestedTopic: unsupportedFailure.subject,
            source: 'education_miss',
          })
          .catch(() => {});
        failureForLedger = {
          kind: 'no_data',
          stage: 'tool',
          subject: 'education_explainer',
          detail: {
            policy: 'definition',
            routed_subject: unsupportedFailure.subject,
          },
        };
        evidence = { tools: ['educationSearch'], failure: failureForLedger };
        reply = speakFailure(failureForLedger);
        replyKey = 'failure:education_explainer';
      }
    } else {
      const sticky =
        unsupportedFailure.subject === 'unknown_request'
          ? speakStickyClarify({
              phase: state.phase,
              visit: state.visit,
              focusName: state.focus?.projectName,
              priorTopics: state.feedForward?.priorTopics,
              constraints: state.constraints,
              channel,
            })
          : null;
      reply = sticky ?? speakFailure(unsupportedFailure);
    }

    state = { ...state, turnCount: state.turnCount + 1 };
    await deps.store.save(state);
    await deps.crm
      .appendMessage(nd || input.convId, 'inbound', input.text)
      .catch(() => {});
    await deps.crm
      .appendMessage(nd || input.convId, 'outbound', reply, {
        replyKey,
      })
      .catch(() => {});
    await appendEarlyFailureLedger({
      deps,
      nd: nd || input.convId,
      input,
      state,
      ex,
      extractProvenance,
      inputSource,
      reply,
      failure: failureForLedger,
      ...(evidence.education ? { evidence } : {}),
      goal,
    });
    return {
      reply,
      state,
      debug: withIngressDebug(
        {
          phase: state.phase,
          goal,
          tools: evidence.tools,
          grounding: 'pass',
        },
        inputSource,
      ),
    };
  }

  const locationBroaden =
    !isDetailAskTurn(ex) &&
    !(ex.askTopic === 'compare' || ex.askTopics?.includes('compare')) &&
    (isLocationBroadenTurn(trimmedText) ||
      isLocationCorrectionTurn(trimmedText) ||
      Boolean(state.constraints.location && state.constraints.location !== prevLoc));
  if (state.phase === 'focused' && locationBroaden && !state.postVisitAckPending) {
    if (nd) await deps.crm.releaseProject(nd).catch(() => {});
    state = releaseToDiscover(state);
  }

  // Opt-out resolution. A two-reading contact-scope question can never be
  // resolved by "yes": the buyer must choose keep-chat or delete-all.
  if (state.stopConfirmPending) {
    const mode =
      deps.failureTools
        ? state.stopConfirmMode ?? 'delete_confirm'
        : 'delete_confirm';
    const resolution = resolvePendingStop(mode, trimmedText);
    const {
      stopConfirmPending: _pendingStop,
      stopConfirmMode: _pendingMode,
      ...stateSansPending
    } = state;
    state = stateSansPending as typeof state;
    if (resolution === 'delete' && nd) {
      await deps.crm.deleteBuyerMemory(nd).catch(() => {});
      const reply = "Done — I've removed your details from our system. You won't hear from us again.";
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
    if (deps.failureTools && mode === 'contact_scope' && resolution === 'keep') {
      const reply =
        "Understood — I'll keep your property search and continue in this chat. I haven't deleted your details.";
      state = { ...state, turnCount: state.turnCount + 1 };
      await deps.store.save(state);
      await deps.crm.appendMessage(nd || input.convId, 'inbound', input.text).catch(() => {});
      await deps.crm
        .appendMessage(nd || input.convId, 'outbound', reply, { replyKey: 'stop_scope_keep' })
        .catch(() => {});
      return {
        reply,
        state,
        debug: withIngressDebug(
          { phase: state.phase, goal: { kind: 'handoff' }, tools: [], grounding: 'pass' },
          inputSource,
        ),
      };
    }
    if (deps.failureTools && mode === 'contact_scope' && resolution === 'ambiguous') {
      const failure = contactScopeFailure();
      const reply = speakFailure(failure, {
        readings: [
          'stop calling and keep chatting here',
          'stop all contact and delete your details',
        ],
      });
      state = {
        ...state,
        stopConfirmPending: true,
        stopConfirmMode: 'contact_scope',
        turnCount: state.turnCount + 1,
      };
      await deps.store.save(state);
      await deps.crm.appendMessage(nd || input.convId, 'inbound', input.text).catch(() => {});
      await deps.crm
        .appendMessage(nd || input.convId, 'outbound', reply, { replyKey: 'stop_scope' })
        .catch(() => {});
      await appendEarlyFailureLedger({
        deps,
        nd: nd || input.convId,
        input,
        state,
        ex,
        extractProvenance,
        inputSource,
        reply,
        failure,
      });
      return {
        reply,
        state,
        debug: withIngressDebug(
          { phase: state.phase, goal: { kind: 'handoff' }, tools: [], grounding: 'pass' },
          inputSource,
        ),
      };
    }
  }

  if (ex.stop && nd) {
    // Standalone SMS keyword is an unambiguous opt-out — act immediately. Anything
    // longer (a sentence mentioning contact/data) confirms before the destructive
    // delete: extraction can misread, and "removed your details" must never be false.
    const standaloneStop = isStandaloneStop(trimmedText);
    if (standaloneStop) {
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
    const scopeAmbiguous = deps.failureTools && !isExplicitDeleteIntent(trimmedText);
    const failure = scopeAmbiguous ? contactScopeFailure() : undefined;
    const reply = failure
      ? speakFailure(failure, {
          readings: [
            'stop calling and keep chatting here',
            'stop all contact and delete your details',
          ],
        })
      : 'Just to confirm — should I remove your details and stop messaging you? Reply "yes" and I\'ll delete everything.';
    state = {
      ...state,
      stopConfirmPending: true,
      ...(deps.failureTools
        ? { stopConfirmMode: scopeAmbiguous ? 'contact_scope' : 'delete_confirm' }
        : {}),
      turnCount: state.turnCount + 1,
    };
    await deps.store.save(state);
    await deps.crm.appendMessage(nd, 'inbound', input.text).catch(() => {});
    await deps.crm.appendMessage(nd, 'outbound', reply, { replyKey: 'stop_confirm' }).catch(() => {});
    if (failure) {
      await appendEarlyFailureLedger({
        deps,
        nd,
        input,
        state,
        ex,
        extractProvenance,
        inputSource,
        reply,
        failure,
      });
    }
    return {
      reply,
      state,
      debug: withIngressDebug(
        { phase: state.phase, goal: { kind: 'handoff' }, tools: [], grounding: 'pass' },
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
    // Empty board: stay in discover (recommend if brief-ready, else probe).
    // Do not enter visit on embedder visit noise before a shortlist/focus exists.
    const emptyBoard = !state.focus && currentShortlist(state).length === 0;
    if (!emptyBoard) {
      state = { ...state, phase: 'visit' };
    }
  }

  // Keep / re-enter visit when awaiting a day-window reply (morning/afternoon).
  // Otherwise "Morning around 11am" falls into discover → clarify_intent.
  if (
    state.phase !== 'visit' &&
    state.visit &&
    (state.visit.lastAsk === 'window' || Boolean(state.visit.pendingDayIso))
  ) {
    state = { ...state, phase: 'visit' };
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

  // Soft-exit keeps the visit draft — re-enter when buyer continues scheduling
  // (e.g. compare digression → "I'll come from Indiranagar").
  if (
    state.phase !== 'visit' &&
    shouldResumeVisitDraft(state.visit, trimmedText, ex, routing.embedder_intent_kind)
  ) {
    state = { ...state, phase: 'visit' };
  }
  // Named-project + same-day: rebuild draft from booked itinerary if digression wiped visit.
  if (
    (isSameDayPhrase(trimmedText) || isDifferentDayPhrase(trimmedText)) &&
    (ex.namedProjects?.length ?? 0) === 1 &&
    ((state.visitBookedCache?.length ?? 0) > 0 || !!state.visit?.projectId)
  ) {
    const n = ex.namedProjects![0]!;
    state = {
      ...state,
      phase: 'visit',
      visit: {
        ...(state.visit ?? {}),
        projectId: n.projectId,
        projectName: n.name,
        lastAsk:
          state.visit?.lastAsk === 'day' || isDifferentDayPhrase(trimmedText)
            ? 'day'
            : 'same_day_choice',
        originText: state.visit?.originText,
        originAsked: state.visit?.originAsked,
        tripOrdered: state.visit?.tripOrdered,
      },
    };
  }

  // Soft-exit when shouldExit says so. Stay via: teach itinerary kinds, or
  // closed chooser deixis (both/dono/sab/ordinals) while which_projects open.
  // Same-day phrase hold removed (V1) — dig must bind visit_same_day / visit_other_day.
  if (
    state.phase === 'visit' &&
    shouldExitVisitForIntent(ex, trimmedText, routing.embedder_intent_kind, state.visit)
  ) {
    state = exitVisitPhase(state);
  }

  if (
    (state.phase === 'discover' || state.phase === 'handoff') &&
    (ex.namedProjects?.length ?? 0) >= 1 &&
    currentShortlist(state).length >= 1 &&
    routing.routing === 'visit_schedule_stop'
  ) {
    state = { ...state, phase: 'visit' };
  }

  if (state.phase === 'visit' && isVisitFollowUpQuestion(trimmedText, ex)) {
    ex = { ...ex, pickName: undefined, implicitProjectPick: undefined, transition: 'none' };
  }

  const now = new Date(deps.clock.nowMs());
  let visitCtx: visit.VisitCtx | null = null;
  {
    const phasePrepT0 = deps.clock.nowMs();
    if (state.phase === 'visit') {
    let visitState = state.visit;
    const coordRows = await deps.data.projectCoords(state.builderId).catch(() => []);
    const projectGeoCatalog = catalogFromProjectCoords(coordRows);

    const rawOriginCandidate =
      visitState?.lastAsk === 'origin' &&
      !visitState.originText &&
      !visit.isVisitProjectSwitchUtterance(trimmedText, ex.namedProjects?.length ?? 0) &&
      !(ex.namedProjects?.length ?? 0)
        ? visit.normalizeOriginText(trimmedText)
        : undefined;
    const originCandidate =
      rawOriginCandidate && isPlausiblePlaceLabel(rawOriginCandidate)
        ? rawOriginCandidate
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
      embedderIntentKind: routing.embedder_intent_kind,
      embedActsOnly: deps.visitEmbedActsOnly === true,
      channel,
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
    midPhasePrepMs = deps.clock.nowMs() - phasePrepT0;
  }
  // AB-6 / W8 — a project NAMED from a cold start ("is Brigade Oasis a plotted
  // development?", "what plot sizes does Desire Spaces have?") must commit to that
  // project, not re-search by the type word and dump an unrelated list. Resolve
  // against the FULL catalog (not just the empty shortlist). Gated to a detail/
  // interrogative ask so an area name in a pure search never false-commits, and
  // resolveCatalogNameHit requires a single unambiguous match.
  let goal: TurnGoal;
  midPreGoalMs = deps.clock.nowMs() - midPreGoalT0;
  routingMs = routingMsAcc;
  const goalT0 = deps.clock.nowMs();
  // Run regardless of an embedder-resolved namedProjects: resolveCatalogNameHit is a
  // DETERMINISTIC text match against real catalog names, so it both (a) rescues a
  // cold name the embedder missed and (b) safely confirms one the embedder found on a
  // search-classified turn (which discover.decide would not commit). A hallucinated
  // embedder name that isn't in the text simply yields no hit and falls through.
  const coldNameEligible =
    state.phase === 'discover' &&
    !state.focus &&
    currentShortlist(state).length === 0 &&
    (ex.namedProjects?.length ?? 0) < 2 &&
    (ex.isQuestion || isDetailAskTurn(ex) || /^(?:is|are|does|do|what|which|how|can|tell me)\b/i.test(trimmedText));
  if (coldNameEligible) {
    const hit =
      prevalidatedCatalogHit ??
      resolveCatalogNameHit(
        trimmedText,
        catalogForTurn?.projectNames?.length
          ? catalogForTurn.projectNames
          : await deps.data
              .projectNames(state.builderId)
              .catch(() => [] as Array<{ projectId: string; name: string }>),
      );
    goal = hit
      ? discover.commitPickWithFollowUp(hit, ex)
      : await decideGoalAsync(state, ex, visitCtx, deps, trimmedText, channel);
  } else {
    goal = await decideGoalAsync(state, ex, visitCtx, deps, trimmedText, channel);
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
      ...currentShortlist(state),
      ...discussedList(state),
      { projectId: state.focus.projectId, name: state.focus.projectName },
    ];
    const namedOk =
      (ex.namedProjects?.some((p) => p.projectId === answerGoal.projectId) ?? false) &&
      buyerCuedOtherProject(trimmedText, pool);
    if (!namedOk) {
      goal = { ...answerGoal, projectId: state.focus.projectId };
    }
  }
  if (deps.failureAnswer && goal.kind === 'answer') {
    goal = withAnswerRequirements(goal, trimmedText);
  }
  goalMs = deps.clock.nowMs() - goalT0;

  let evidence: EvidenceSet = { tools: [] };
  let droppedLocation = false;
  const evidenceT0 = deps.clock.nowMs();
  if (goal.kind === 'hold_propose' && nd) {
    // W7 — pre-check live per-type availability (Desk #203 counts, KV-cached
    // context) BEFORE proposing: a sold-out type gets the waitlist offer up
    // front instead of propose→fail. Counts absent (pre-#203 payloads) →
    // fail open and keep the honest propose→409 path.
    const wantType = goal.unitType.toLowerCase().replace(/[^a-z0-9]/g, '');
    const detailRes = await deps.data
      .projectDetail(state.builderId, nd, goal.projectId)
      .catch(() => null);
    const detail = detailRes?.ok ? detailRes.value : null;
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
      const followTopics = goal.followUpTopics?.length
        ? goal.followUpTopics
        : goal.followUp
          ? [goal.followUp]
          : [];
      const { active, parked } = splitComposeTopics(followTopics);
      const rawAnswerGoal: Extract<TurnGoal, { kind: 'answer' }> = {
        kind: 'answer',
        topic: active[0] ?? goal.followUp ?? goal.followUpTopics![0]!,
        projectId: goal.projectId,
        ...(active.length > 1 ? { topics: active } : {}),
        ...(parked.length ? { parkedTopics: parked } : {}),
      };
      const answerGoal = deps.failureAnswer
        ? withAnswerRequirements(rawAnswerGoal, trimmedText)
        : rawAnswerGoal;
      evidence = await fetchAnswer(answerGoal, state, ex, deps, nd, trimmedText);
      goal = answerGoal;
    }
  } else if (goal.kind === 'recommend' || goal.kind === 'ack_reject_recommend') {
    const recFlags: { droppedLocation?: string } = {};
    ({ goal, evidence } = await fetchRecommend(goal, state, ex, deps, trimmedText, channel, recFlags));
    if (recFlags.droppedLocation) {
      droppedLocation = true;
      // The buyer named an area the Desk could not match, so the search above
      // fell back to an area-less one. Tell compose, or those fallback matches
      // get announced as "Here's what fits" for an area we never searched —
      // a buyer asking for Mumbai was being shown Devanahalli as a fit.
      // Dimension only, never the captured string: it may be dialogue noise,
      // and echoing noise back is the defect the purge below exists for.
      evidence = {
        ...evidence,
        relaxed: [...new Set<RelaxedDimension>([...(evidence.relaxed ?? []), 'area'])],
      };
    }
    if (recFlags.droppedLocation && state.constraints.location) {
      // Junk-locality purge (see fetchRecommend): persisting an unrecognized
      // capture is what made "No exact match for one week. ELEVEN" echo on
      // every later turn.
      const { location: _junkLoc, ...cleanConstraints } = state.constraints;
      state = { ...state, constraints: cleanConstraints };
    }
  } else if (goal.kind === 'objection') {
    ({ goal, evidence } = await fetchObjection(goal, state, deps, nd));
  } else if (goal.kind === 'answer') {
    evidence = await fetchAnswer(goal, state, ex, deps, nd, trimmedText);
  } else if (goal.kind === 'emi_calculate') {
    evidence = fetchEmiCalculation(ex);
  } else if (goal.kind === 'shortlist_answer') {
    evidence = await fetchShortlistAnswer(goal, state, ex, deps, nd);
  } else if (goal.kind === 'visit_recall') {
    evidence = await fetchVisitRecall(state, deps, nd);
  } else {
    evidence = await fetchEvidence(goal, state, deps);
  }
  evidenceMs = deps.clock.nowMs() - evidenceT0;
  // C9 resilience — a focused answer whose live Desk fetch flaked (a transient
  // conversationContext + getProject miss returns null detail) must NOT
  // false-decline facts the project HAS ("I don't have price on file" when it
  // does). Fall back to the full detail we already prefetched into projectCache,
  // so the buyer gets the real answer. A no_data decline stays honest only when
  // we actually looked — here we did, on a prior turn.
  if (
    goal.kind === 'answer' &&
    goal.projectId &&
    !evidence.detail &&
    state.projectCache?.[goal.projectId]
  ) {
    evidence = { ...evidence, detail: state.projectCache[goal.projectId] };
  }
  if (deps.failureAnswer && goal.kind === 'answer') {
    evidence = enforceAnswerContract(goal, evidence);
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
    channel,
    ...(state.focus ? { focusProjectName: state.focus.projectName } : {}),
    returningBuyer: state.returningBuyer,
    ...(ff?.priorTopics?.length ? { priorTopics: ff.priorTopics } : {}),
    ...(ff?.priorReplyExcerpt ? { priorReplyExcerpt: ff.priorReplyExcerpt } : {}),
    ...(disclosedForCompose.length ? { disclosedFacts: disclosedForCompose } : {}),
    // Stage 7 — named latch when Desk provides escalation_phone on builder/objection ctx.
    ...(evidence.escalationPhone?.trim()
      ? { handoffPhone: evidence.escalationPhone.trim(), handoffTeamName: friendlyBuilder(state.builderId) }
      : {}),
  });
  // Phase 3 no_fit may carry both a Failure (ledger) and rich compose evidence
  // (budgetGap / noMatch / …). Prefer the existing compose templates over the
  // generic speakFailure sentence so Whitefield nearest / empty-locality copy
  // stay one family — not a second "Nothing matches …" speaker.
  const terminalFailure =
    goal.kind === 'no_fit' &&
    (evidence.budgetGap ||
      evidence.noMatch ||
      evidence.constraintGap ||
      evidence.propertyTypeGap ||
      evidence.floor)
      ? undefined
      : evidence.failure;

  const visitDeterministic =
    goal.kind === 'visit_ask' || goal.kind === 'visit_propose' || goal.kind === 'visit_booked';
  // Hold copy is a commitment ("held until 5:30 pm") — never LLM-paraphrased.
  const holdDeterministic = goal.kind === 'hold_propose' || goal.kind === 'hold_booked';
  const firstShortlistTurn =
    currentShortlist(state).length === 0 &&
    (goal.kind === 'recommend' || goal.kind === 'ack_reject_recommend') &&
    (evidence.matches?.length ?? 0) > 0;
  // A4 — advisor board owns the catalog; never let LLM re-dump *Name* in market.
  const advisorRecommendDeterministic =
    channel === 'advisor_web' &&
    (goal.kind === 'recommend' || goal.kind === 'ack_reject_recommend') &&
    (evidence.matches?.length ?? 0) > 0;
  const clarifyPickDeterministic = goal.kind === 'clarify_project_pick';
  const clarifyDiscourseDeterministic = goal.kind === 'clarify_discourse';
  // Sticky / honest miss — never LLM into portfolio pitch.
  const clarifyIntentDeterministic = goal.kind === 'clarify_intent';
  // Shortlist-wide facet blocks are structured facts — template-locked like compare.
  const shortlistAnswerDeterministic = goal.kind === 'shortlist_answer';
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
  const ctaDeclineDeterministic = goal.kind === 'advance' && goal.reason === 'cta_decline';
  // Focused bare-ack advance must stay on visit/hold nudge — LLM was re-probing BHK.
  const focusedAdvanceDeterministic =
    goal.kind === 'advance' && goal.reason === 'same_set' && !!state.focus?.projectName;
  const recallConstraintsDeterministic = goal.kind === 'recall_constraints';
  // FAQ miss must stay on the honest-miss template — never LLM paraphrase into overview.
  const faqMissDeterministic =
    goal.kind === 'answer' && Boolean(evidence.faqMiss?.keys.length);
  const propertyTypeDeterministic =
    goal.kind === 'answer' && goal.topic === 'property_type' && !!evidence.detail?.projectType;
  // Named commit / overview after switch — always say the project name (SW-01/02).
  const commitDeterministic = goal.kind === 'commit';
  const overviewDeterministic =
    goal.kind === 'answer' &&
    goal.topic === 'overview' &&
    !!evidence.detail &&
    !evidence.faqMiss?.keys.length;
  const emiCalculateDeterministic = goal.kind === 'emi_calculate';

  // no_fit is a hard honesty statement with a well-built template (constraint
  // gap, catalog floor, alternate project) — LLM paraphrase of it produced
  // literal prompt echoes on dev ("[real starting point]"). Lock it.
  const noFitDeterministic = goal.kind === 'no_fit';
  // Empty-locality market widen must stay template-locked — LLM otherwise
  // lists project names (Eldorado) as if they were places.
  const localityWidenDeterministic = !!evidence.localityWiden?.asked;

  // Template-locked goals: commitments and structured facts that must never be
  // LLM-paraphrased — and (W3) must never be "varied" by the repeat guard.
  const templateLockedBase =
    !!terminalFailure ||
    noFitDeterministic ||
    localityWidenDeterministic ||
    visitDeterministic ||
    holdDeterministic ||
    firstShortlistTurn ||
    advisorRecommendDeterministic ||
    clarifyPickDeterministic ||
    clarifyDiscourseDeterministic ||
    clarifyIntentDeterministic ||
    shortlistAnswerDeterministic ||
    compareDeterministic ||
    multiAnswerDeterministic ||
    locationDeterministic ||
    mediaDeterministic ||
    availabilityDeterministic ||
    legalDeterministic ||
    visitRecallDeterministic ||
    recallConstraintsDeterministic ||
    warmAckDeterministic ||
    ctaDeclineDeterministic ||
    focusedAdvanceDeterministic ||
    faqMissDeterministic ||
    propertyTypeDeterministic ||
    commitDeterministic ||
    overviewDeterministic ||
    emiCalculateDeterministic;

  const hybridOn = deps.hybridMode === 'on';
  const rateTarget = deps.llmRateTarget ?? 0.2;
  const rateCapped = hybridOn && llmRateExceeded(state, rateTarget);
  const hybridTemplate =
    hybridOn &&
    (templateLockedBase ||
      hybridPreferTemplate(goal, evidence, ex) ||
      rateCapped ||
      !needsPaidLlmFloor(ex, goal));
  const templateLocked = templateLockedBase || hybridTemplate;

  const composeT0 = deps.clock.nowMs();
  let draft: string;
  if (terminalFailure) {
    composeTemplate = true;
    draft = speakFailure(terminalFailure, {
      ...(terminalFailure.subject === 'emi.principal'
        ? { subjectLabel: 'a loan amount (for example, ₹85 lakh)' }
        : {}),
      ...(state.focus?.projectName ? { projectName: state.focus.projectName } : {}),
      ...(terminalFailure.subject === 'budget' &&
      state.constraints.budgetMaxInr !== undefined
        ? { buyerValue: formatInr(state.constraints.budgetMaxInr) }
        : {}),
      alternatives: failureAlternatives(terminalFailure, evidence),
    });
  } else if (templateLocked) {
    composeTemplate = true;
    if (rateCapped) llmShed = true;
    draft = fallbackReply(req);
  } else {
    try {
      draft = (await deps.llm.compose(req)).trim();
      if (!draft) {
        draft = fallbackReply(req);
        composeTemplate = true;
        llmShed = true;
      } else {
        llmUsed = true;
      }
    } catch {
      draft = fallbackReply(req);
      composeTemplate = true;
      llmShed = true;
    }
  }
  composeMs = deps.clock.nowMs() - composeT0;
  // post_compose wall starts after the compose slice; closed just before store.save.
  const postComposeT0 = deps.clock.nowMs();

  // W1+W3 share ONE bounded LLM retry per turn — disabled under hybrid (≤1 paid call).
  let retryUsed = hybridOn;

  // AB-10 — a pure-directive draft strips to '' (nothing but the leaked
  // instruction). Never re-emit it: fall to the grounded template floor.
  const stripped = stripComposerDirectives(stripBanned(draft));
  let reply = stripped.trim() ? stripped : fallbackReply(req);
  let grounding: TurnDebug['grounding'] = 'pass';
  const g1 = terminalFailure
    ? { grounded: true, unbacked: [] }
    : checkGrounding(reply, evidence, input.text);
  // Placeholder-leak guard (dev: "[real starting point]" reached a buyer):
  // an LLM draft containing bracketed template-speak is treated exactly like
  // a grounding failure — one repair retry, then the template floor.
  const placeholderLeak =
    !templateLocked && /\[[a-z][^\]\n]{2,60}\]/i.test(reply);
  if (!g1.grounded || placeholderLeak) {
    // W1 — repair without killing the thread: feed the checker's exact
    // rejections back for ONE re-compose before the template floor. This is
    // the 49%-of-answer-turns problem measured in Week 0. Template-locked
    // goals never reach here (they never compose). Hybrid: no second paid call.
    let repaired = '';
    if (!templateLocked && !retryUsed && !hybridOn) {
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
        if (repaired) llmUsed = true;
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
      composeTemplate = true;
      if (hybridOn && llmUsed) llmShed = true;
    }
  } else if (
    !terminalFailure &&
    needsStructuredRepair(goal, evidence, reply, disclosedForCompose, input.text)
  ) {
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
  if (!hybridOn && !templateLocked && !retryUsed && state.lastReply && sameLine(reply, state.lastReply)) {
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
      if (varied) llmUsed = true;
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

  if (evidence.notices?.length) {
    const failureCopy = evidence.notices
      .map((failure) =>
        speakFailure(failure, {
          ...(state.focus?.projectName ? { projectName: state.focus.projectName } : {}),
          alternatives: failureAlternatives(failure, evidence),
        }),
      )
      .join(' ');
    reply = `${failureCopy} ${reply}`.trim();
  }

  if (goal.kind === 'visit_booked') {
    const next = goal.nextQueuedStop ?? state.visit?.queued?.[0];
    const pendingNames = (state.visit?.pendingTeamRequests ?? []).map((t) => t.projectName);
    if (next) {
      const hint = state.visit?.preferredDayHint;
      const nextLine =
        hint === 'next' || hint === 'other'
          ? `Next up — which day and time for *${next.projectName}*?`
          : `Next up — same day for *${next.projectName}*, or a different day?`;
      reply = `${reply.trim()}\n\n${nextLine}`;
    }
    // Force-same-day overflow may sit alongside a firm next stop — always surface pending.
    if (pendingNames.length > 0) {
      const pending = pendingNames.join(', ');
      reply = `${reply.trim()}\n\n*${pending}*: requested with the team (pending) — we'll confirm on WhatsApp, or say a different day for a firm slot.`;
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
  // Same one-shot for visit confirm (VIS-ADX-04): possession/price digression
  // must kill awaitingConfirm so a later bare "yes" cannot book the stale slot.
  // visit.decide re-proposes when proposedIso is still future.
  if (goal.kind !== 'visit_propose' && state.visit?.awaitingConfirm) {
    state = {
      ...state,
      visit: { ...state.visit, awaitingConfirm: false },
    };
  }
  // W3 — remember the outbound line for the repeat guard.
  state = { ...state, lastReply: reply };
  if (evidence.detail && goal.kind === 'answer') {
    // detail.faqs are "the FAQ answers matched to THIS question" and fetchAnswer
    // is their only writer (see the adapter's single-owner invariant). Durable
    // project facts belong in the cache; a question's answer does not. Caching
    // them made the NEXT turn replay the previous answer — "compare X and Y"
    // spoke the earlier legal reply verbatim, because compose pushes a present
    // faqs body into its chunks before it ever reaches the compare branch.
    const { faqs: _questionScoped, ...rawDurable } = evidence.detail;
    // Promote enriched identity-only shells (RERA/phases bolted on after a
    // focus-scoped miss) so they do not poison projectCache + block L2 forever.
    const durable = promoteDurableProjectDetail(rawDurable);
    state = {
      ...state,
      projectCache: { ...(state.projectCache ?? {}), [goal.projectId]: durable },
    };
    // Dual-write L2 for cross-isolate / next chat. Same-conv durability is
    // projectCache → awaited store.save below — do not waitUntil that save.
    // memoSet inside writeProjectCardFromDetail runs sync before the KV put.
    const l2Write = writeProjectCardFromDetail(deps, goal.projectId, durable).catch(
      () => {},
    );
    if (deps.waitUntil) deps.waitUntil(l2Write);
    else await l2Write;
  }
  const newlyDisclosed = extractDisclosedFacts({ goal, evidence });
  if (newlyDisclosed.length) {
    state = {
      ...state,
      disclosedFacts: mergeDisclosedFacts(state.disclosedFacts, newlyDisclosed),
    };
  }
  // Remember Ivory / unit the buyer just asked about (availability evidence).
  if (goal.kind === 'answer' && evidence.units?.length && goal.projectId) {
    const pinned = pickFocusUnit(
      goal.projectId,
      evidence.units,
      trimmedText,
      state.focusUnit,
    );
    if (pinned) state = { ...state, focusUnit: pinned };
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
      const crmT0 = deps.clock.nowMs();
      await deps.crm.setStage(nd, rung, { onlyForward: true }).catch(() => {});
      crmPreMs += deps.clock.nowMs() - crmT0;
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

  const failures =
    deps.failureLog || evidence.failure || evidence.notices?.length
    ? deriveShadowFailures({ goal, evidence, droppedLocation })
    : [];

  if (llmUsed) {
    state = { ...state, llmUsedCount: (state.llmUsedCount ?? 0) + 1 };
  }

  // store.save stays AWAITED — it is the KV state the next turn reads (store.load).
  const storeSaveT0 = deps.clock.nowMs();
  postComposeMs = storeSaveT0 - postComposeT0;
  await deps.store.save(state);
  storeSaveMs = deps.clock.nowMs() - storeSaveT0;

  // The post-reply tail (turn ledger, transcript append, CRM facts, telemetry)
  // is read by an agent later, NEVER by the next turn, and mutates no state the
  // response depends on (reply + state are already frozen above). So it rides
  // ctx.waitUntil off the buyer's critical path — Bridge Stage 2, ~1s. CLI/eval
  // pass no waitUntil, so there the tail is awaited exactly as before.
  const _tail = (async () => {
    await deps.store
      .logTurn({
        convId: state.convId,
        turnIndex: state.turnCount,
        buyerText: input.text,
        reply,
        phase: state.phase,
        goal: goal.kind,
        grounding,
      })
      .catch(() => {});
    await deps.crm.appendMessage(nd || input.convId, 'inbound', input.text).catch(() => {});
    await deps.crm.appendMessage(nd || input.convId, 'outbound', reply, { replyKey: goal.kind }).catch(() => {});
    await syncFacts(deps, nd, ex, goal, state, evidence, input.text).catch(() => {});
    await syncTelemetry(deps, nd, input, goal, evidence, state, reply, {
      ex,
      extractProvenance,
      inputSource,
      grounding,
      routing,
      failures,
    }).catch(() => {});
    // Catalog Onboarding Watching — live ask grade (Desk owns fulfill/Problem).
    // Never block the buyer on ledger I/O; transport errors stay watching.
    await reportCatalogWatchFromTurn({
      crm: deps.crm,
      builderId: state.builderId,
      projectId: state.focus?.projectId ?? '',
      conversationId: nd || input.convId,
      buyerText: trimmedText || input.text,
      reply,
      routingBind: (routing?.bind ?? extractProvenance?.routing_bind ?? null) as {
        top_kind?: string;
        facet?: string;
        bind_source?: string;
      } | null,
      faqMissKeys: evidence.faqMiss?.keys ?? [],
      faqHitCount: evidence.detail?.faqs?.length ?? 0,
      atomTruthPresent: Boolean(
        evidence.detail?.reraNumber?.trim()
          || evidence.detail?.khata?.trim()
          || evidence.detail?.possession?.trim()
          || evidence.detail?.loanEligibility?.trim()
          || (goal.kind === 'answer'
            && goal.requires?.includes('rera')
            && evidence.detail?.reraNumber?.trim()),
      ),
    }).catch(() => {});
  })();
  if (input.waitUntil) input.waitUntil(_tail);
  else await _tail;

  const cappedRecovery = searchRecovery ? capRecoveryForChannel(searchRecovery, channel) : undefined;

  const debugOut = withIngressDebug(
    {
      phase: state.phase,
      goal,
      tools: evidence.tools,
      grounding,
      ...(repeat_guard ? { repeat_guard } : {}),
      last_offered_count: currentShortlist(state).length,
      last_offered_ids: currentShortlist(state).map((o) => o.projectId),
      ...(evidence.nearbyOffer?.nearbyAreas.length
        ? {
            nearby_offer: {
              asked: evidence.nearbyOffer.asked,
              nearbyAreas: evidence.nearbyOffer.nearbyAreas,
              label: 'Also nearby estates',
            },
          }
        : {}),
      timings: {
        ...(preExtractMs !== undefined ? { pre_extract_ms: preExtractMs } : {}),
        ...(extractMs !== undefined ? { extract_ms: extractMs } : {}),
        ...(midPreGoalMs !== undefined ? { mid_pre_goal_ms: midPreGoalMs } : {}),
        ...(midCatalogMs !== undefined ? { mid_catalog_ms: midCatalogMs } : {}),
        ...(midLocationMs !== undefined ? { mid_location_ms: midLocationMs } : {}),
        ...(midPhasePrepMs !== undefined ? { mid_phase_prep_ms: midPhasePrepMs } : {}),
        ...(routingMs !== undefined ? { routing_ms: routingMs } : {}),
        ...(evidenceMs !== undefined ? { evidence_ms: evidenceMs } : {}),
        ...(composeMs !== undefined ? { compose_ms: composeMs } : {}),
        ...(goalMs !== undefined ? { goal_ms: goalMs } : {}),
        ...(postComposeMs !== undefined ? { post_compose_ms: postComposeMs } : {}),
        ...(storeSaveMs !== undefined ? { store_save_ms: storeSaveMs } : {}),
        ...(crmPreMs > 0 ? { crm_pre_ms: crmPreMs } : {}),
        total_ms: deps.clock.nowMs() - turnStartedMs,
      },
      ...(deps.cacheStats && Object.keys(deps.cacheStats).length
        ? { cache: { ...deps.cacheStats } }
        : {}),
      llm_used: llmUsed,
      ...(llmShed ? { llm_shed: true } : {}),
      ...(composeTemplate ? { compose_template: true } : {}),
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
      failures,
    }),
  );

  const mediaAttachments = evidence.media
    ? (() => {
        const a = attachmentFromMediaEvidence(evidence.media!);
        return a ? [a] : undefined;
      })()
    : undefined;

  return {
    reply,
    state,
    debug: debugOut,
    ...(evidence.compare?.matrix ? { compareMatrix: evidence.compare.matrix } : {}),
    ...(cappedRecovery ? { searchRecovery: cappedRecovery } : {}),
    uiMode,
    whatsappActions:
      whatsAppButtons(searchRecovery, channel) ??
      (channel === 'whatsapp' && evidence.nearbyOffer
        ? nearbyOfferSuggestedActions(evidence.nearbyOffer).slice(0, 2)
        : undefined),
    ...(mediaAttachments?.length ? { mediaAttachments } : {}),
  };
}

/** Honest-miss shapes (Desk teach_verify + compose templates). */
function replyLooksHonestMiss(reply: string): boolean {
  return /don.?t have (that|the|this) .{0,60}on file/i.test(reply)
    || /not (yet )?on file/i.test(reply);
}

/**
 * Grade a focused fact ask for Desk catalog_watch.
 * - faqMiss → truth empty → keep Watching (OS Fill book)
 * - honest miss with FAQ/atom present → Problem (Ops File defect)
 * - composed answer without honest miss → fulfill
 */
async function reportCatalogWatchFromTurn(args: {
  crm: EngineDeps['crm'];
  builderId: string;
  projectId: string;
  conversationId: string;
  buyerText: string;
  reply: string;
  routingBind: { top_kind?: string; facet?: string; bind_source?: string } | null;
  faqMissKeys: string[];
  faqHitCount: number;
  /** ProjectDetail / atom already carries the asked fact (RERA, possession, …). */
  atomTruthPresent?: boolean;
}): Promise<void> {
  if (!args.crm.reportCatalogWatchAsk) return;
  if (!args.projectId || !args.builderId) return;
  // Only grade when SIL/intent bind existed — smalltalk / visit churn is noise.
  if (!args.routingBind?.top_kind && !args.routingBind?.facet && args.faqMissKeys.length === 0
      && args.faqHitCount === 0 && !args.atomTruthPresent) {
    return;
  }

  const honestMiss = replyLooksHonestMiss(args.reply);
  // faqMiss keys ⇒ catalogue empty ONLY when no structured atom answers the ask.
  // Atom-present + faqMiss is a compose/Problem lane, not OS Fill book.
  const emptyTruth = args.faqMissKeys.length > 0 && !args.atomTruthPresent;
  const truthPresent = !emptyTruth;
  const answerOk = !honestMiss && truthPresent && args.reply.trim().length > 0;
  const facet = (args.routingBind?.facet || args.faqMissKeys[0] || '').trim();

  await args.crm.reportCatalogWatchAsk({
    builderId: args.builderId,
    projectId: args.projectId,
    conversationId: args.conversationId,
    phrase: args.buyerText.slice(0, 500),
    answerOk,
    truthPresent,
    ...(facet ? { slotId: facet, facetKey: facet } : {}),
    ...(args.routingBind?.top_kind ? { reviewedIntent: args.routingBind.top_kind } : {}),
    ...(!answerOk ? {
      failReason: honestMiss
        ? (emptyTruth ? 'honest_miss_empty_truth' : 'honest_miss_truth_present')
        : 'compose_not_ok',
    } : {}),
  });
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
  if (ex.recallConstraints) return { kind: 'recall_constraints' };
  if (ex.recall) return { kind: 'visit_recall' };
  // "Get me a person" outranks the phase, exactly as recall does. Someone
  // asking for grievance redressal, or reporting the third leak in their
  // bathroom, is not in a discovery conversation — and every phase selector
  // would otherwise fall through to search and answer with a project list.
  // One check, one owner: this slot is written only by the intent authority.
  // Soft escalate/callback must not outrank a catalog facet ask while focused
  // (or while focus still exists after a sticky handoff). True "talk to a
  // human" speech-acts still set wantsHuman without catalog ownership.
  if (ex.wantsHuman && !(s.focus && catalogAskOwns(ex, text))) {
    return { kind: 'handoff' };
  }
  switch (s.phase) {
    case 'discover':
      return discover.decide(s, ex, text);
    case 'focused':
      // text feeds the deterministic hold-intent gate (visit-style regex).
      return focused.decide(s, ex, text);
    case 'visit':
      return visit.decide(s, ex, visitCtx!);
    case 'handoff':
      // Catalog escape when focus lives — see phases/handoff.ts.
      return handoff.decide(s, ex, text);
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
  channel: TurnIntentChannel = 'whatsapp',
): Promise<TurnGoal> {
  if (ex.recallConstraints) return { kind: 'recall_constraints' };
  // Noise / smash — sticky clarify before ask_next_step / false brochure binds.
  // Ignore askTopics: embedder often nearest-neighbours get_brochure on smash.
  // When the hard brief is already filled, bare "ok" must advance — not re-probe.
  if (
    s.phase === 'discover' &&
    isNonPlaceUtterance(text) &&
    !discover.hasNarrowingConstraint(ex.constraints) &&
    !(ex.namedProjects?.length) &&
    ex.transition !== 'want_visit'
  ) {
    if (discover.hasNarrowingConstraint(s.constraints) && !discover.firstMissingSlot(s)) {
      return resolveAskNextStepGoal(s, channel);
    }
    return { kind: 'clarify_intent' };
  }
  // Phase 2c — ask_next_step is state-conditioned; consume before phase decide
  // so cold/board/focused/visit don't fall through to search/overview.
  if (shouldConsumeAskNextStep(s, ex, text)) {
    return resolveAskNextStepGoal(s, channel);
  }
  if (s.phase === 'focused') {
    const switchGoal = await resolveFocusedSwitchGoal(text, ex, s, deps);
    if (switchGoal) return switchGoal;
    // Alternate deixis with no unique target — clarify instead of recycling overview.
    if (s.focus && isAlternateDeixis(text)) {
      const focusId = s.focus.projectId;
      const others = discourseEntities(s).filter((e) => e.projectId !== focusId);
      if (others.length >= 2) {
        return {
          kind: 'clarify_discourse',
          reason: 'ambiguous_alternate',
          projectName: s.focus.projectName,
          alternateNames: others.map((e) => e.name).slice(0, 3),
        };
      }
      const reason = /\bgo\s+back\b/i.test(text) ? 'no_prior_focus' : 'no_alternate';
      return {
        kind: 'clarify_discourse',
        reason,
        projectName: s.focus.projectName,
      };
    }
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
  /** Out-flags for the single caller: a junk locality dropped here must also
   *  be purged from PERSISTED state, or it echoes on every later turn. */
  out?: { droppedLocation?: string },
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
  // Soft-rank: full prefs on advisor-web; WA only when the buyer explicitly
  // weighs value/investment (CRM Phase 4) — never re-rank WA on soft NL heuristics.
  const prefs = advisorSearchPrefs(s.constraints);
  if (channel === 'advisor_web') {
    if (prefs.preferenceWeights) filters = { ...filters, preferenceWeights: prefs.preferenceWeights };
    if (prefs.commuteHub) filters = { ...filters, commuteHub: prefs.commuteHub };
    if (prefs.budgetTargetInr) filters = { ...filters, budgetTargetInr: prefs.budgetTargetInr };
    if (prefs.askSizeSqft) filters = { ...filters, askSizeSqft: prefs.askSizeSqft };
  } else if (
    (s.constraints.purpose === 'investment' || s.constraints.valueMentioned) &&
    prefs.preferenceWeights?.value
  ) {
    filters = {
      ...filters,
      preferenceWeights: { value: prefs.preferenceWeights.value },
    };
  }
  let strictSearch = await searchWithFilters(deps, s.builderId, filters);

  if (deps.failureSearch && strictSearch.matches.length === 0) {
    const outcome = await searchWithAuthorityRelaxation({
      filters,
      constraints: s.constraints,
      authority: s.constraintAuthority,
      rejectedProjectIds: s.discover.rejectedProjectIds,
      search: async (candidateFilters) => {
        const result = await searchWithFilters(deps, s.builderId, candidateFilters);
        return {
          matches: rawToMatches(result.matches),
          ...(result.recognizedLocations
            ? { recognizedLocations: result.recognizedLocations }
            : {}),
        };
      },
    });
    if (outcome.ok) {
      return {
        goal: base,
        evidence: {
          tools: ['search'],
          matches: outcome.value.matches,
          relaxed: outcome.value.relaxed,
        },
      };
    }

    const failure = outcome.failure;
    if (failure.subject === 'budget' && failure.nearest && s.constraints.budgetMaxInr) {
      return {
        goal: { kind: 'no_fit' },
        evidence: {
          tools: ['search'],
          failure,
          budgetGap: {
            budgetDisplay: formatInr(s.constraints.budgetMaxInr),
            ...(s.constraints.location ? { location: s.constraints.location } : {}),
            closestName: failure.nearest.name,
            closestDisplay: failure.nearest.display,
            closestProjectId: failure.nearest.projectId,
          },
        },
      };
    }
    if (failure.subject === 'area') {
      const loc = s.constraints.location?.trim() || 'that area';
      // Locality intelligence: nearby / in-city inventory with disclosed widen.
      // Ladder still returned area no_match (no silent release); this is recovery.
      const cat = await deps.data.catalog(s.builderId).catch(() => null);
      const catalogMarkets = cat?.microMarkets ?? [];
      const widen = await searchLocalityWiden({
        asked: loc,
        builderId: s.builderId,
        filters,
        rejectedProjectIds: s.discover.rejectedProjectIds,
        catalogMarkets,
        ports: {
          geoAreasInRegion: (region, builderId) =>
            deps.data.geoAreasInRegion(region, builderId),
          resolveGeo: (text) => deps.data.resolveGeo(text),
          projectCoords: (builderId) => deps.data.projectCoords(builderId),
          search: async (builderId, candidateFilters) => {
            const result = await searchWithFilters(deps, builderId, candidateFilters);
            const { location: _loc, ...constraintsSansArea } = s.constraints;
            return {
              matches: discover.filterSearchMatches(
                rawToMatches(result.matches ?? []),
                constraintsSansArea,
                s.discover.rejectedProjectIds,
              ),
            };
          },
        },
      });

      if (widen?.matches.length) {
        // Market labels only in localityWiden — compose must not speak project names as places.
        return {
          goal: base.kind === 'recommend' || base.kind === 'ack_reject_recommend' ? base : { kind: 'recommend' },
          evidence: {
            tools: ['search', 'geoAreasInRegion'],
            matches: widen.matches,
            relaxed: ['area'],
            localityWiden: {
              asked: loc,
              nearbyAreas: widen.nearbyAreas,
            },
          },
        };
      }

      // Outside served geography (or LI miss) — city inventory, no project dump.
      const [askGeo, coordRows] = await Promise.all([
        deps.data.resolveGeo(loc).catch(() => null),
        deps.data.projectCoords(s.builderId).catch(() => []),
      ]);
      const orderOpts = coverageOrderOptsFrom({
        ask: askGeo,
        projectCoords: coordRows,
      });
      const coverage = collapseCoverageMarkets(
        orderCoverageMarkets(catalogMarkets, orderOpts),
      );
      const propType = s.constraints.propertyType;
      const bhk = s.constraints.bhk;
      const cityBit = coverageCityCoverBit(cat?.servedCities ?? [], propType, bhk);
      const coverBit = cityBit ?? coverageCoverBit(catalogMarkets, orderOpts);
      return {
        goal: { kind: 'no_fit' },
        evidence: {
          tools: ['search'],
          failure,
          noMatch: {
            reasoning: `I don't have ${inventoryNoun(propType, bhk)} in *${loc}* — ${coverBit}`,
            nearby: coverage,
          },
        },
      };
    }

    return {
      goal: base,
      evidence: {
        tools: ['search'],
        failure,
      },
    };
  }

  // Provisional locality — the Desk is the locality authority (area registry +
  // catalog identity + geocoder). Zero matches AND none of the sent locations
  // recognized means the captured "place" is dialogue noise ("boarding a
  // flight", "next option"), not an uncovered locality: drop it from this
  // search and flag it for the state purge, then re-search the rest of the
  // brief. A RECOGNIZED place with zero matches keeps the honest no_fit path
  // (echoing "Mysuru" back is honest; echoing noise back is the defect).
  if (
    filters.locations &&
    strictSearch.matches.length === 0 &&
    strictSearch.recognizedLocations !== undefined &&
    strictSearch.recognizedLocations.length === 0
  ) {
    if (out) out.droppedLocation = filters.locations;
    const { locations: _junkLoc, ...withoutLocation } = filters;
    filters = withoutLocation;
    if (s.constraints.location) {
      const { location: _sLoc, ...cleanConstraints } = s.constraints;
      s = { ...s, constraints: cleanConstraints };
    }
    strictSearch = await searchWithFilters(deps, s.builderId, filters);
  }

  const offeredIds = new Set(currentShortlist(s).map((o) => o.projectId));

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

  if (matches.length === 0 && base.kind === 'recommend' && currentShortlist(s).length === 0) {
    const broadened = await broadenInitialShortlist(
      deps,
      s.builderId,
      filters,
      s.constraints,
      s.discover.rejectedProjectIds,
      [],
    );
    if (broadened.matches.length > 0) {
      return {
        goal: base,
        evidence: {
          tools: ['search'],
          matches: broadened.matches,
          ...(broadened.relaxed.length ? { relaxed: broadened.relaxed } : {}),
        },
      };
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
      // The buyer's configuration found nothing, so this list came from a
      // search with the size filter removed — say so rather than call it a fit.
      return { goal: base, evidence: { tools: ['search'], matches: relaxedMatches, relaxed: ['size'] } };
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
      if (currentShortlist(s).length === 0) {
        const broadened = await broadenInitialShortlist(
          deps,
          s.builderId,
          filters,
          s.constraints,
          s.discover.rejectedProjectIds,
          [],
        );
        if (broadened.matches.length >= 2) {
          return {
            goal: base,
            evidence: {
              tools: ['search'],
              matches: broadened.matches,
              // Reached via the budget gap — the budget itself is the thing we
              // could not honour, plus whatever broadening gave up on top.
              relaxed: [...new Set<RelaxedDimension>(['budget', ...broadened.relaxed])],
            },
          };
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

  // "Show me others" with nothing new in the asked place — offer same-type nearby
  // before propertyType/budget no_fit loops the same singleton.
  if (
    scopedMatches.length === 0 &&
    (ex.wantsMore || ex.rejected || base.kind === 'ack_reject_recommend') &&
    s.constraints.location?.trim() &&
    (s.constraints.propertyType || filters.projectTypes)
  ) {
    const asked = s.constraints.location.trim();
    const excludeIds = new Set([
      ...currentShortlist(s).map((o) => o.projectId),
      ...s.discover.rejectedProjectIds,
      ...(s.focus?.projectId ? [s.focus.projectId] : []),
    ]);
    const offer = await findNearbyTypeOffer({
      asked,
      builderId: s.builderId,
      filters,
      constraints: s.constraints,
      excludeIds,
      search: async (builderId, candidateFilters) => {
        const result = await searchWithFilters(deps, builderId, candidateFilters);
        const { location: _loc, ...sansArea } = s.constraints;
        return {
          matches: discover.filterSearchMatches(
            rawToMatches(result.matches ?? []),
            sansArea,
            s.discover.rejectedProjectIds,
          ),
        };
      },
    });
    if (offer?.previewMatches.length) {
      const exactFitName = currentShortlist(s)[0]?.name ?? s.focus?.projectName;
      return {
        goal: { kind: 'recommend' },
        evidence: {
          tools: ['search'],
          matches: offer.previewMatches,
          relaxed: ['area'],
          localityWiden: {
            asked,
            nearbyAreas: offer.nearbyAreas,
            ...(exactFitName ? { exactFitName } : {}),
          },
        },
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
    // Padding a short-but-real shortlist up to three (RTI-D+). Anything the
    // padding gave up rides along so compose never calls the padded entries a fit.
    let padRelaxed: RelaxedDimension[] = [];
    if (base.kind === 'recommend' && currentShortlist(s).length === 0 && listed.length < 3) {
      const padded = await broadenInitialShortlist(deps, s.builderId, filters, s.constraints, s.discover.rejectedProjectIds, listed);
      listed = padded.matches;
      padRelaxed = padded.relaxed;
    }
    // Thin exact board + location on brief → soft nearby offer (opt-in; not padded in).
    const nearbyOfferEv = await maybeNearbyOfferEvidence({
      listed,
      s,
      filters,
      deps,
      excludeIds: new Set([
        ...listed.map((m) => m.projectId),
        ...currentShortlist(s).map((o) => o.projectId),
        ...s.discover.rejectedProjectIds,
      ]),
    });
    if (
      base.kind === 'recommend' &&
      !ex.wantsMore &&
      !ex.forceRecommendList &&
      isSameAsLast(s, listed)
    ) {
      const miss = s.discover.advancedOnce ? undefined : discover.firstMissingSlot(s);
      return {
        goal: { kind: 'advance', reason: 'same_set' },
        evidence: {
          tools: ['search'],
          matches: listed,
          ...(miss ? { nextSlot: miss } : {}),
          ...(padRelaxed.length ? { relaxed: padRelaxed } : {}),
          ...(nearbyOfferEv ?? {}),
        },
      };
    }
    return {
      goal: base,
      evidence: {
        tools: ['search'],
        matches: listed,
        ...(padRelaxed.length ? { relaxed: padRelaxed } : {}),
        ...(nearbyOfferEv ?? {}),
      },
    };
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
  recognizedLocations?: string[];
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

/** Soft nearby CTA when the exact board is thin (1 card) and type+area are set. */
async function maybeNearbyOfferEvidence(input: {
  listed: Match[];
  s: ConversationState;
  filters: import('./types.js').SearchFilters;
  deps: EngineDeps;
  excludeIds: Set<string>;
}): Promise<{ nearbyOffer: NonNullable<EvidenceSet['nearbyOffer']> } | undefined> {
  const { listed, s, filters, deps, excludeIds } = input;
  const asked = s.constraints.location?.trim();
  if (!asked || listed.length !== 1) return undefined;
  if (!filters.projectTypes && !s.constraints.propertyType) return undefined;
  const offer = await findNearbyTypeOffer({
    asked,
    builderId: s.builderId,
    filters,
    constraints: s.constraints,
    excludeIds,
    search: async (builderId, candidateFilters) => {
      const result = await searchWithFilters(deps, builderId, candidateFilters);
      const { location: _loc, ...sansArea } = s.constraints;
      return {
        matches: discover.filterSearchMatches(
          rawToMatches(result.matches ?? []),
          sansArea,
          s.discover.rejectedProjectIds,
        ),
      };
    },
  });
  if (!offer) return undefined;
  return {
    nearbyOffer: {
      asked: offer.asked,
      nearbyAreas: offer.nearbyAreas,
      previewNames: offer.previewNames,
    },
  };
}

function nearbyOfferSuggestedActions(
  nearbyOffer: NonNullable<EvidenceSet['nearbyOffer']>,
): SuggestedAction[] {
  const places = nearbyOffer.nearbyAreas.slice(0, 2).join(' / ') || 'nearby areas';
  return [
    {
      id: 'nearby_offer:widen',
      label: 'Also nearby estates',
      patch: { location: nearbyOffer.nearbyAreas.join(', ') },
      user_line: 'Show me those nearby estates too',
      expected_matches: nearbyOffer.previewNames?.length ?? 2,
    },
    {
      id: 'nearby_offer:open',
      label: `Try ${places.split(' / ')[0] ?? 'nearby'}`,
      patch: { location: nearbyOffer.nearbyAreas[0] },
      user_line: `Show me projects in ${nearbyOffer.nearbyAreas[0]}`,
      expected_matches: 1,
    },
  ];
}

/** First shortlist after brief — relax BHK/type filters to surface up to 3 options. */
async function broadenInitialShortlist(
  deps: EngineDeps,
  builderId: string,
  filters: import('./types.js').SearchFilters,
  constraints: import('./types.js').Constraints,
  rejectedIds: readonly string[],
  current: Match[],
): Promise<{ matches: Match[]; relaxed: RelaxedDimension[] }> {
  const merged = [...current];
  const seen = new Set(merged.map((m) => m.projectId));
  // What we actually gave up to fill the list — reported back so compose can
  // disclose it. Recorded only when a relaxed project really ENTERS the list,
  // so an untouched shortlist never claims a relaxation that didn't happen.
  const relaxed: RelaxedDimension[] = [];
  const relaxPlans: Array<{
    plan: import('./types.js').SearchFilters;
    gaveUp: RelaxedDimension;
  }> = [];
  if (filters.bhks) {
    const { bhks: _b, ...noBhk } = filters;
    relaxPlans.push({ plan: noBhk, gaveUp: 'size' });
  }
  // AB-2 — NEVER relax projectTypes: a declared type is a hard filter. Padding a
  // "plotted in North Bangalore" shortlist with an apartment (Century Breeze) or a
  // "villa" list with a plantation actively misleads — the buyer reads all three
  // cards as what they asked for. Two honest typed cards beat three polluted ones;
  // zero typed matches falls through to the propertyTypeGap no_fit, which names
  // the gap and offers the closest other-type option with consent.
  for (const { plan, gaveUp } of relaxPlans) {
    const broad = await searchWithFilters(deps, builderId, plan);
    const ms = discover.filterSearchMatches(rawToMatches(broad.matches), constraints, rejectedIds);
    for (const m of ms) {
      if (seen.has(m.projectId)) continue;
      seen.add(m.projectId);
      merged.push(m);
      if (!relaxed.includes(gaveUp)) relaxed.push(gaveUp);
      if (merged.length >= 3) return { matches: merged, relaxed };
    }
  }
  return { matches: merged, relaxed };
}

async function fetchObjection(
  goal: Extract<TurnGoal, { kind: 'objection' }>,
  s: ConversationState,
  deps: EngineDeps,
  nd: string,
): Promise<{ goal: TurnGoal; evidence: EvidenceSet }> {
  const ctx = nd ? await deps.data.objectionContext(nd).catch(() => null) : null;
  const count = (s.objectionCount ?? 0) + 1;
  // Stage 7 — Desk topics may be "pricing"/"budget" while extract maps "price".
  const match = ctx?.playbooks.find((p) => {
    const t = (p.topic ?? '').toLowerCase();
    const want = (goal.topic ?? '').toLowerCase();
    return t === want || t.includes(want) || want.includes(t);
  });
  const threshold = match?.escalateAfter ?? 3;
  const phone = ctx?.escalationPhone?.trim();
  if (count >= threshold) {
    return {
      goal: { kind: 'handoff' },
      evidence: {
        tools: ['objectionContext'],
        ...(phone ? { escalationPhone: phone } : {}),
      },
    };
  }
  if (!(match?.reframeAngles?.length)) {
    // Quality-factory Stage 7: no playbook → honest escalate (named latch when
    // Desk has escalation_phone). Never invent reframe angles from the model.
    return {
      goal: { kind: 'handoff' },
      evidence: {
        tools: ['objectionContext'],
        ...(phone ? { escalationPhone: phone } : {}),
      },
    };
  }
  return {
    goal,
    evidence: {
      tools: ['objectionContext'],
      ...(phone ? { escalationPhone: phone } : {}),
      objection: {
        topic: goal.topic,
        acknowledged: ackFor(goal.topic),
        reframeAngles: match?.reframeAngles ?? [],
      },
    },
  };
}

/**
 * 4q kill #1 — shortlist-wide facet answer (the clarify-pick sinkhole). A facet
 * asked over the whole shortlist ("what emi will I pay", "which have proper
 * khata") is answered per project from EXISTING authorities — the Desk compare
 * matrix for price/config/location/type rows, projectDetail for the legal
 * snapshot, priceBasis + computeEmi for EMI. A project with no value renders an
 * honest "not on file"; no facts at all → honest miss, never a bare pick-menu.
 */
function fetchEmiCalculation(ex: Extracted): EvidenceSet {
  const outcome = computeEmi({
    ...(ex.emiPrincipalInr !== undefined ? { principalInr: ex.emiPrincipalInr } : {}),
    ...(ex.emiRatePercent !== undefined ? { ratePercent: ex.emiRatePercent } : {}),
    ...(ex.emiTenureYears !== undefined ? { tenureYears: ex.emiTenureYears } : {}),
  });
  return outcome.ok
    ? { tools: ['emi'], emi: { ...outcome.value, discloseInputs: true } }
    : { tools: [], failure: outcome.failure };
}

const SHORTLIST_MATRIX_ROWS: Partial<Record<import('./types.js').AnswerTopic, readonly string[]>> = {
  price: ['starting_price'],
  availability: ['configurations', 'possession'],
  location: ['location'],
  property_type: ['project_type'],
};

async function fetchShortlistAnswer(
  goal: Extract<TurnGoal, { kind: 'shortlist_answer' }>,
  s: ConversationState,
  ex: Extracted,
  deps: EngineDeps,
  nd: string,
): Promise<EvidenceSet> {
  const matches = matchesFromLastOffered(s)
    .filter((m) => goal.projectIds.includes(m.projectId))
    .slice(0, 3);
  const base: EvidenceSet = { tools: ['lastOffered'], matches };
  if (!nd || matches.length < 2) return base;

  const topics = goal.topics?.length ? goal.topics : [goal.topic];
  const tools = new Set<string>(['lastOffered']);
  const facets: import('./types.js').ShortlistFacetEvidence['facets'] = [];

  if (topics.some((t) => SHORTLIST_MATRIX_ROWS[t])) {
    const cmp = await deps.data.compare(nd, matches.map((m) => m.projectId)).catch(() => null);
    const matrix = cmp?.matrix;
    if (matrix) {
      tools.add('compare');
      for (const t of topics) {
        for (const key of SHORTLIST_MATRIX_ROWS[t] ?? []) {
          const row = matrix.rows.find((r) => r.key === key);
          if (!row) continue;
          facets.push({
            topic: t,
            label: row.label,
            perProject: matrix.projects.map((p, i) => ({
              projectId: p.project_id,
              name: p.name,
              value: cleanShortlistFacetValue(row.values[i]),
            })),
          });
        }
      }
    }
  }

  if (topics.includes('legal')) {
    const details = await Promise.all(
      matches.map((m) => deps.data.projectDetail(s.builderId, nd, m.projectId).catch(() => null)),
    );
    tools.add('projectDetail');
    facets.push({
      topic: 'legal',
      label: 'Legal & approvals',
      perProject: matches.map((m, i) => {
        const d = details[i]?.ok ? details[i]!.value : null;
        const parts = [
          d?.reraNumber?.trim() ? `RERA ${d.reraNumber.trim()}` : '',
          d?.khata?.trim() ?? '',
          d?.ecStatus?.trim() ? `EC: ${d.ecStatus.trim()}` : '',
          d?.naStatus?.trim() ? `NA: ${d.naStatus.trim()}` : '',
        ].filter(Boolean);
        return { projectId: m.projectId, name: m.name, value: parts.join(' · ') };
      }),
    });
  }

  if (topics.includes('emi')) {
    const rate = ex.emiRatePercent ?? DEFAULT_RATE_PERCENT;
    const years = ex.emiTenureYears ?? DEFAULT_TENURE_YEARS;
    const bases = await Promise.all(
      matches.map((m) =>
        deps.data.priceBasis(s.builderId, nd, m.projectId, s.constraints.bhk).catch(() => null),
      ),
    );
    tools.add('priceBasis');
    facets.push({
      topic: 'emi',
      label: `Approx. EMI (80% loan, ${years} yrs @ ${rate}%)`,
      perProject: matches.map((m, i) => {
        // Unit-type basis first; the shortlist's own starting price as the
        // honest fallback (s01: no BHK on the brief → priceBasis missed and
        // the whole EMI block silently vanished). basisFormatted names the
        // basis either way, so the figure is never presented as unit-exact.
        const basisInr =
          (bases[i]?.ok ? bases[i]!.value.priceInr : 0) ||
          (m.startingPriceInr > 0 ? m.startingPriceInr : 0);
        const outcome = computeEmi({
          ...(basisInr > 0 ? { projectPriceInr: basisInr } : {}),
          ratePercent: rate,
          tenureYears: years,
        });
        const emi = outcome.ok ? outcome.value : null;
        return {
          projectId: m.projectId,
          name: m.name,
          value: emi
            ? deps.failureTools
              ? `${emi.emiFormatted}/mo on ${emi.principalFormatted} principal (${emi.basisFormatted} project price)`
              : `${emi.emiFormatted}/mo on ${emi.basisFormatted}`
            : '',
        };
      }),
    });
  }

  return {
    ...base,
    tools: [...tools],
    ...(facets.length ? { shortlistFacet: { facets } } : {}),
  };
}

/** Desk renders missing matrix cells as an em-dash — normalize to honest-empty. */
function cleanShortlistFacetValue(v: string | undefined): string {
  const t = (v ?? '').trim();
  return t === '—' ? '' : t;
}

function failureAlternatives(
  failure: Failure,
  evidence: EvidenceSet,
): string[] {
  if (
    failure.subject === 'carpet_area' ||
    failure.subject === 'built_up_area'
  ) {
    return [
      ...(evidence.units?.length ? ['the published configuration sizes'] : []),
      ...(evidence.pricing || evidence.landedCost ? ['the cost sheet'] : []),
    ];
  }
  if (failure.subject === 'flood_zone') {
    return [
      ...(evidence.detail?.reraNumber ? ['the RERA status'] : []),
      ...(evidence.detail?.ecStatus ? ['the title and encumbrance status'] : []),
    ];
  }
  return [];
}

async function gatherPriceEvidencePatch(args: {
  deps: EngineDeps;
  s: ConversationState;
  nd: string;
  projectId: string;
  unitType: string | undefined;
  focusName: string;
  buyerText?: string;
}): Promise<EvidenceSet> {
  const { deps, s, nd, projectId, unitType, focusName, buyerText } = args;
  let evidence: EvidenceSet = { tools: [] };
  const breakdownAsk = buyerText ? wantsCostBreakdown(buyerText) : false;
  if (breakdownAsk && unitType) {
    const landedRes = await deps.data
      .landedCost(s.builderId, nd, projectId, unitType)
      .catch((): DataResult<never> => ({ ok: false, reason: 'transport', latency_ms: 0 }));
    evidence = stampToolRun(evidence, 'landedCost', landedRes);
    if (landedRes.ok) {
      evidence = { ...evidence, landedCost: landedRes.value };
    }
  }
  if (!evidence.landedCost) {
    const pricingRes = await deps.data
      .pricing(s.builderId, nd, projectId, unitType)
      .catch((): DataResult<never> => ({ ok: false, reason: 'transport', latency_ms: 0 }));
    evidence = stampToolRun(evidence, 'pricing', pricingRes);
    if (pricingRes.ok) {
      const pricing = pricingRes.value;
      const asked =
        buyerText && isCostComponentAsk(buyerText)
          ? componentsForAsk(buyerText, pricing.components)
          : [];
      const components = asked.length ? asked : pricing.components;
      evidence = {
        ...evidence,
        pricing: { ...pricing, components, projectName: pricing.projectName || focusName },
      };
    }
  }
  return evidence;
}

async function gatherEmiEvidencePatch(args: {
  deps: EngineDeps;
  s: ConversationState;
  nd: string;
  projectId: string;
  unitType: string | undefined;
  ex: Extracted;
}): Promise<EvidenceSet> {
  const { deps, s, nd, projectId, unitType, ex } = args;
  let evidence: EvidenceSet = { tools: [] };
  const basisRes = await deps.data
    .priceBasis(s.builderId, nd, projectId, unitType)
    .catch((): DataResult<never> => ({ ok: false, reason: 'transport', latency_ms: 0 }));
  evidence = stampToolRun(evidence, 'priceBasis', basisRes);
  const basis = basisRes.ok ? basisRes.value : null;
  const outcome = computeEmi({
    ...(basis ? { projectPriceInr: basis.priceInr } : {}),
    ratePercent: ex.emiRatePercent ?? DEFAULT_RATE_PERCENT,
    tenureYears: ex.emiTenureYears ?? DEFAULT_TENURE_YEARS,
  });
  if (outcome.ok) {
    evidence = {
      ...evidence,
      tools: [...new Set([...evidence.tools, 'emi'])],
      emi: {
        ...outcome.value,
        ...(deps.failureTools ? { discloseInputs: true } : {}),
      },
    };
  } else if (deps.failureTools) {
    evidence = { ...evidence, failure: outcome.failure };
  }
  return evidence;
}

async function gatherMediaEvidencePatch(args: {
  deps: EngineDeps;
  s: ConversationState;
  nd: string;
  projectId: string;
  unitType: string | undefined;
  focusName: string;
  buyerText?: string;
  mediaAssetKind?: string;
}): Promise<EvidenceSet> {
  const { deps, s, nd, projectId, unitType, focusName, buyerText, mediaAssetKind } = args;
  let evidence: EvidenceSet = { tools: [] };
  // Loan asks must never fetch/share a brochure — unless the buyer also
  // explicitly co-asked for photos/brochure (Wave 3 media+loan).
  const loanOwnsMedia =
    (answerRequirements(buyerText ?? '').includes('loan_eligibility') ||
      resolveFaqQuestionKeys(buyerText ?? '').includes('loan_eligibility') ||
      resolveFaqQuestionKeys(buyerText ?? '').includes('banks')) &&
    !/\b(?:photos?|images?|pics?|gallery|brochure|floor\s*plans?|layout|video|pdf)\b/i.test(
      buyerText ?? '',
    );
  if (loanOwnsMedia) return evidence;

  const rawKind = mediaAssetKind ?? 'brochure';
  const assetKind = normalizeMediaAssetKind(rawKind) ?? rawKind;
  const mediaName =
    (s.focus?.projectId === projectId ? focusName : '') ||
    currentShortlist(s).find((o) => o.projectId === projectId)?.name ||
    focusName;
  const projectName = mediaName || focusName || 'this project';
  const cachedKinds = s.projectCache?.[projectId]?.mediaKinds;
  let inventoryKinds = cachedKinds;
  if (inventoryKinds === undefined) {
    const hydratedMedia = await hydrateProjectDetail(deps, s, projectId).catch(() => null);
    if (hydratedMedia?.fetch) {
      evidence = stampToolRun(evidence, 'detail', hydratedMedia.fetch);
    }
    if (hydratedMedia?.detail) {
      inventoryKinds = hydratedMedia.detail.mediaKinds;
      evidence = { ...evidence, detail: hydratedMedia.detail };
    }
  }
  if (mediaKindMissingFromInventory(assetKind, inventoryKinds)) {
    return {
      ...evidence,
      tools: [...new Set([...evidence.tools, 'mediaShare'])],
      media: {
        assetKind,
        allowed: false,
        reason: 'no_matching_asset',
        projectName,
      },
    };
  }
  const phaseId = evidence.detail?.phases?.[0]?.phaseId;
  const media = await deps.data
    .mediaShare(nd, projectId, assetKind, unitType, phaseId)
    .catch(() => null);
  if (media) {
    return {
      ...evidence,
      tools: [...new Set([...evidence.tools, 'mediaShare'])],
      media: { assetKind, ...media, projectName },
    };
  }
  return {
    ...evidence,
    tools: [...new Set([...evidence.tools, 'mediaShare'])],
    media: {
      assetKind,
      allowed: false,
      reason: 'share_unavailable',
      projectName,
    },
  };
}

async function gatherAvailabilityEvidencePatch(args: {
  deps: EngineDeps;
  s: ConversationState;
  nd: string;
  projectId: string;
  focusName: string;
  buyerText?: string;
  skipShowcaseMedia: boolean;
}): Promise<EvidenceSet> {
  const { deps, s, nd, projectId, focusName, buyerText, skipShowcaseMedia } = args;
  let evidence: EvidenceSet = { tools: [] };
  const bhkFilter = resolveAvailabilityBhkFilter({
    buyerText,
    constraintBhk: s.constraints.bhk,
  });
  const toEvidenceUnits = (
    rows: Array<{
      unitType: string;
      priceDisplay: string;
      sizeDisplay?: string;
      holdableUnits?: number;
    }>,
  ) =>
    filterUnitsByBhk(rows, bhkFilter).map((c) => ({
      unitType: c.unitType,
      priceDisplay: c.priceDisplay,
      ...(c.sizeDisplay ? { sizeDisplay: c.sizeDisplay } : {}),
      ...(typeof c.holdableUnits === 'number' ? { holdableUnits: c.holdableUnits } : {}),
    }));

  const cachedConfigs = s.projectCache?.[projectId]?.configurations;
  if (cachedConfigs?.length) {
    const units = toEvidenceUnits(cachedConfigs);
    if (units.length) {
      evidence = {
        ...evidence,
        tools: [...new Set([...evidence.tools, 'listUnits'])],
        units,
      };
    }
  } else {
    const listed = await deps.data.listUnits(projectId).catch(() => []);
    if (listed.length) {
      const units = toEvidenceUnits(listed);
      if (units.length) {
        evidence = {
          ...evidence,
          tools: [...new Set([...evidence.tools, 'listUnits'])],
          units,
        };
      }
    }
  }

  // Unit-typed showcase media — never race an explicit media ask (caller sets skip).
  if (evidence.units?.length && bhkFilter && !skipShowcaseMedia && !evidence.media) {
    const mediaName =
      (s.focus?.projectId === projectId ? focusName : '') ||
      currentShortlist(s).find((o) => o.projectId === projectId)?.name ||
      focusName;
    const projectName = mediaName || focusName || 'this project';
    for (const kind of ['site_image', 'floor_plan'] as const) {
      const phaseId = evidence.detail?.phases?.[0]?.phaseId;
      const media = await deps.data
        .mediaShare(nd, projectId, kind, bhkFilter, phaseId)
        .catch(() => null);
      if (media?.allowed && media.cdnUrl) {
        evidence = {
          ...evidence,
          tools: [...new Set([...evidence.tools, 'mediaShare'])],
          media: { assetKind: kind, ...media, projectName },
        };
        break;
      }
    }
  }
  return evidence;
}

async function gatherFaqEvidencePatch(args: {
  deps: EngineDeps;
  s: ConversationState;
  projectId: string;
  focusName: string;
  buyerText?: string;
  faqKeys: string[];
  taughtKey?: string;
}): Promise<EvidenceSet> {
  const { deps, s, projectId, focusName, buyerText, faqKeys, taughtKey } = args;
  let evidence: EvidenceSet = { tools: [] };
  const faqHits: Array<{ questionKey: string; question: string; answer: string }> = [];
  // CRM activation / C1: yield + appreciation are owned by gated market intel.
  const faqBlockedForIntel = new Set(['rental_yield', 'resale_value']);
  const keysToFetch = faqKeys.filter(
    (key) => !(deps.failureAnswer && faqBlockedForIntel.has(key)),
  );
  const faqResults = await Promise.all(
    keysToFetch.map(async (key) => {
      const faqRes = await deps.data
        .faqLookup(projectId, key)
        .catch((): DataResult<never> => ({ ok: false, reason: 'transport', latency_ms: 0 }));
      return { key, faqRes };
    }),
  );
  // Preserve key order (serial semantics) when attaching hits / stamping latency.
  for (const { key, faqRes } of faqResults) {
    evidence = stampToolRun(evidence, 'faqLookup', faqRes);
    if (faqRes.ok && faqRes.value.answer) {
      faqHits.push({
        questionKey: key,
        question: faqRes.value.question,
        answer: faqRes.value.answer,
      });
    }
  }
  if (faqHits.length) {
    const stubName =
      (s.focus?.projectId === projectId ? focusName : '') ||
      currentShortlist(s).find((o) => o.projectId === projectId)?.name ||
      'this project';
    evidence = {
      ...evidence,
      detail: {
        projectId,
        name: stubName,
        microMarket: '',
        faqs: faqHits,
      },
    };
  } else if (faqKeys.length > 0 && buyerText && (isFaqShapedAsk(buyerText) || taughtKey)) {
    // Cost-sheet ownership is applied after parallel merge (needs pricing).
    evidence = {
      ...evidence,
      tools: [...new Set([...evidence.tools, 'faqMiss'])],
      faqMiss: { keys: faqKeys, ...(taughtKey ? { taught: true } : {}) },
    };
  }
  return evidence;
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
  // Prefer pinned Ivory/config from prior availability answer, then turn-local BHK.
  const unitType =
    focusUnitTypeForProject(s.focusUnit, goal.projectId) ??
    resolveAvailabilityBhkFilter({
      buyerText,
      constraintBhk: s.constraints.bhk,
    }) ??
    s.constraints.bhk;
  const focusName = s.focus?.projectName ?? '';
  const topics = goal.topics?.length ? goal.topics : [goal.topic];
  let tools: string[] = [];
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

  // Independent Desk topic tools — run in parallel; merge in fixed order so
  // Promise settlement order cannot change EvidenceSet field winners.
  // Closed-beta FAQ prep (keys) is pure; lookups fan out inside the FAQ patch.
  const taughtKey = buyerText ? taughtFaqKey(s.rti?.lastRouting, buyerText) : undefined;
  const primaryTopic = topics[0] ?? goal.topic;
  const structuredPrimary =
    primaryTopic === 'availability' || primaryTopic === 'price';
  const textBoundFaq = Boolean(buyerText && isFaqShapedAsk(buyerText));
  const faqTopicHints = structuredPrimary && !taughtKey && !textBoundFaq ? [] : topics;
  const resolvedKeys = excludeParkedFaqKeys(
    resolveFaqQuestionKeys(buyerText ?? '', faqTopicHints),
    goal.parkedTopics,
  );
  const faqKeys = taughtKey
    ? excludeParkedFaqKeys(
        [taughtKey, ...resolvedKeys.filter((k) => k !== taughtKey)],
        goal.parkedTopics,
      )
    : resolvedKeys;

  const wantPrice = topics.includes('price');
  const wantEmi = topics.includes('emi');
  const wantMedia = topics.includes('media') || Boolean(ex.mediaAssetKind);
  const wantAvail = topics.includes('availability');

  const [pricePatch, emiPatch, mediaPatch, availPatch, faqPatch] = await Promise.all([
    wantPrice
      ? gatherPriceEvidencePatch({
          deps,
          s,
          nd,
          projectId: goal.projectId,
          unitType,
          focusName,
          buyerText,
        })
      : Promise.resolve({ tools: [] } satisfies EvidenceSet),
    wantEmi
      ? gatherEmiEvidencePatch({
          deps,
          s,
          nd,
          projectId: goal.projectId,
          unitType,
          ex,
        })
      : Promise.resolve({ tools: [] } satisfies EvidenceSet),
    wantMedia
      ? gatherMediaEvidencePatch({
          deps,
          s,
          nd,
          projectId: goal.projectId,
          unitType,
          focusName,
          buyerText,
          mediaAssetKind: ex.mediaAssetKind,
        })
      : Promise.resolve({ tools: [] } satisfies EvidenceSet),
    wantAvail
      ? gatherAvailabilityEvidencePatch({
          deps,
          s,
          nd,
          projectId: goal.projectId,
          focusName,
          buyerText,
          // Explicit media ask owns media — availability showcase must not race it.
          skipShowcaseMedia: wantMedia,
        })
      : Promise.resolve({ tools: [] } satisfies EvidenceSet),
    gatherFaqEvidencePatch({
      deps,
      s,
      projectId: goal.projectId,
      focusName,
      buyerText,
      faqKeys,
      taughtKey,
    }),
  ]);

  evidence = mergeEvidencePatches(
    { tools: [] },
    [pricePatch, emiPatch, mediaPatch, availPatch, { ...faqPatch, detail: undefined }],
  );
  // Preserve hydrated detail from media/avail; only attach FAQ rows (serial semantics).
  if (faqPatch.detail?.faqs?.length) {
    const stubName =
      (s.focus?.projectId === goal.projectId ? focusName : '') ||
      currentShortlist(s).find((o) => o.projectId === goal.projectId)?.name ||
      'this project';
    evidence = {
      ...evidence,
      detail: {
        ...(evidence.detail ?? {
          projectId: goal.projectId,
          name: stubName,
          microMarket: '',
        }),
        faqs: faqPatch.detail.faqs,
      },
    };
  }
  // FAQ miss for cost-component asks is deferred until pricing is merged.
  if (
    faqPatch.faqMiss &&
    buyerText &&
    isCostComponentAsk(buyerText) &&
    Boolean(evidence.pricing ?? evidence.landedCost)
  ) {
    const { faqMiss: _dropCostMiss, ...rest } = evidence;
    evidence = {
      ...rest,
      tools: (rest.tools ?? []).filter((t) => t !== 'faqMiss'),
    };
  }
  tools = evidence.tools;

  const faqHits = evidence.detail?.faqs ?? [];
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
  // CRM advisory atoms live on ProjectDetail — hydrate whenever the contract
  // requires them, even if topic routing landed elsewhere.
  // Do not gate on failureAnswer — we need Desk intel on the detail even when
  // the contract speaker is off; otherwise yield always declines.
  const advisoryDetailNeeded = Boolean(
    goal.requires?.some(
      (k) =>
        k === 'rental_yield' ||
        k === 'appreciation' ||
        k === 'growth_drivers' ||
        k === 'operator_model' ||
        k === 'visit_logistics',
    ),
  );
  // Loan LTV lives on ProjectDetail.loanEligibility — a FAQ miss for
  // loan_eligibility used to suppress detail hydrate and answer "not on file"
  // even when Desk carries the LTV string (Advisor dig: "can I get the loan?").
  const loanEligibilityNeeded = Boolean(
    goal.kind === 'answer' &&
      (goal.requires?.includes('loan_eligibility') ||
        evidence.faqMiss?.keys.some((k) => /loan|banks/i.test(k)) ||
        (buyerText && answerRequirements(buyerText).includes('loan_eligibility'))),
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
    legalSnapshotNeeded ||
    advisoryDetailNeeded ||
    loanEligibilityNeeded;
  if (needsDetail || wantsLocation) {
    // Overview-focused cache often omits loanEligibility / marketIntel; bust it
    // when the buyer asks so we re-fetch Desk detail (not a sticky miss).
    let hydrateState = s;
    const cachedDetail = s.projectCache?.[goal.projectId];
    const bustLoan = loanEligibilityNeeded && cachedDetail && !cachedDetail.loanEligibility;
    const bustIntel =
      advisoryDetailNeeded &&
      cachedDetail &&
      !cachedDetail.marketIntel &&
      !cachedDetail.investment?.expectedRoi;
    // Loan / market-intel gaps: re-fetch Desk. Location asks keep the card and
    // overlay LI via locationIntel below — do NOT wipe projectCache (that forced
    // a full projectDetail RTT on every schools/metro packed turn).
    if ((bustLoan || bustIntel) && s.projectCache?.[goal.projectId]) {
      const { [goal.projectId]: _stale, ...restCache } = s.projectCache;
      hydrateState = { ...s, projectCache: restCache };
      deps.projectCardMemo?.delete(goal.projectId);
    }
    const hydrated = await hydrateProjectDetail(deps, hydrateState, goal.projectId);
    if (hydrated.fetch) {
      evidence = stampToolRun(evidence, 'detail', hydrated.fetch);
      tools = evidence.tools;
    }
    let detail = hydrated.detail;
    // LI POIs via dedicated engine door — do not rely on context/projectDetail merge.
    if (wantsLocation && detail) {
      const li = await deps.data.locationIntel(goal.projectId).catch(() => undefined);
      if (li) detail = { ...detail, location: { ...detail.location, ...li } };
    }
    if (detail && topics.includes('legal')) {
      detail = await enrichDetailLegal(deps, nd, detail);
    }
    if (detail && needsDetail) {
      // Detail replaces any topic-hint FAQ attach (original single-owner
      // behavior) — only text-bound faq-shaped asks keep their FAQ answer.
      // AB-8b — but a multi-atom legal ask (legalSnapshotNeeded) DOES carry a
      // real FAQ hit (the loan atom); preserve it onto the hydrated detail so
      // the snapshot answers RERA and the FAQ body answers loan.
      const priorFaqs = evidence.detail?.faqs;
      let nextDetail = priorFaqs?.length ? { ...detail, faqs: priorFaqs } : detail;
      // Advisory atoms: if the hydrated/cached detail still lacks rent bands /
      // ROI, fetch corridor intel by micro_market directly (Desk GET
      // /api/market-intel?q=…). Covers sticky overview cache + nested miss.
      if (
        advisoryDetailNeeded &&
        !nextDetail.marketIntel?.rentBands?.length &&
        !nextDetail.investment?.expectedRoi?.trim()
      ) {
        // Focus/identity-only cards often omit microMarket — borrow from the
        // shortlist hit so corridor intel can still resolve (Eldorado yield).
        const mm = (
          nextDetail.microMarket ||
          currentShortlist(s).find((o) => o.projectId === goal.projectId)?.microMarket ||
          discussedList(s).find((o) => o.projectId === goal.projectId)?.microMarket ||
          ''
        ).trim();
        if (mm) {
          const raw = await deps.data.marketIntel(mm).catch(() => null);
          const gated = gateMarketIntel(raw ?? undefined);
          if (gated) {
            tools.push('marketIntel');
            nextDetail = {
              ...nextDetail,
              ...(nextDetail.microMarket ? {} : { microMarket: mm }),
              marketIntel: gated,
            };
          }
        }
      }
      // Desk often stores LTV as a pricing "Loan LTV" info row, not
      // projects.loan_eligibility — lift it when the buyer asked about loan.
      if (loanEligibilityNeeded && !nextDetail.loanEligibility) {
        const pricingRes = await deps.data
          .pricing(s.builderId, nd, goal.projectId, unitType)
          .catch((): DataResult<never> => ({ ok: false, reason: 'transport', latency_ms: 0 }));
        evidence = stampToolRun(evidence, 'pricing', pricingRes);
        tools = evidence.tools;
        const pricing = pricingRes.ok ? pricingRes.value : null;
        const ltv = pricing?.components?.find((c) => /loan\s*ltv|ltv/i.test(c.label));
        if (ltv?.value && pricing) {
          nextDetail = { ...nextDetail, loanEligibility: ltv.value };
          evidence = {
            ...evidence,
            pricing: { ...pricing, projectName: pricing.projectName || focusName },
          };
        }
      }
      evidence = {
        ...evidence,
        tools: [...new Set(tools)],
        detail: nextDetail,
      };
      // Loan LTV on detail answers the ask — drop loan/banks FAQ miss so compose
      // does not refuse to mention loan terms that are already on evidence.
      if (nextDetail.loanEligibility && evidence.faqMiss?.keys.length) {
        const left = evidence.faqMiss.keys.filter((k) => !/loan|banks/i.test(k));
        if (left.length === 0) {
          const { faqMiss: _dropLoanMiss, ...rest } = evidence;
          evidence = rest;
        } else {
          evidence = {
            ...evidence,
            faqMiss: { ...evidence.faqMiss, keys: left },
          };
        }
      }
      // RERA/khata atoms on detail — drop legal FAQ miss so compose + catalog_watch
      // treat this as truth-present (not empty-catalogue Watching).
      if (
        (nextDetail.reraNumber?.trim() || nextDetail.khata?.trim()) &&
        evidence.faqMiss?.keys.length
      ) {
        const left = evidence.faqMiss.keys.filter(
          (k) => !/^(?:rera_status|rera_number|khata(?:_legal)?|legal_status)$/i.test(k),
        );
        if (left.length === 0) {
          const { faqMiss: _dropLegalMiss, ...rest } = evidence;
          evidence = rest;
        } else {
          evidence = {
            ...evidence,
            faqMiss: { ...evidence.faqMiss, keys: left },
          };
        }
      }
      // Corridor intel / project ROI owns yield — drop rental_yield FAQ miss so
      // compose speaks advisoryFactLines instead of "not on file".
      if (
        (nextDetail.marketIntel?.rentBands?.length ||
          nextDetail.investment?.expectedRoi?.trim()) &&
        evidence.faqMiss?.keys.length
      ) {
        const left = evidence.faqMiss.keys.filter(
          (k) => !/^(?:rental_yield|resale_value)$/i.test(k),
        );
        if (left.length === 0) {
          const { faqMiss: _dropYieldMiss, ...rest } = evidence;
          evidence = rest;
        } else {
          evidence = {
            ...evidence,
            faqMiss: { ...evidence.faqMiss, keys: left },
          };
        }
      }
      // Project possession_date atom — drop possession FAQ miss so compose speaks
      // the structured date (Ayana "Ready to register") instead of "not on file".
      if (nextDetail.possession?.trim() && evidence.faqMiss?.keys.length) {
        const left = evidence.faqMiss.keys.filter((k) => !/^possession$/i.test(k));
        if (left.length === 0) {
          const { faqMiss: _dropPossessionMiss, ...rest } = evidence;
          evidence = rest;
        } else {
          evidence = {
            ...evidence,
            faqMiss: { ...evidence.faqMiss, keys: left },
          };
        }
      }
    }
    if (detail && wantsLocation) {
      const leadCategories = [...new Set([...askedCategories, ...faqLocationCategories])];
      const location = buildLocationEvidence(detail, leadCategories);
      // Wave 3 — when `location` is an explicit multi-topic atom ("price and
      // connectivity"), attach even a sparse snapshot so compose is not price-only.
      const attachLocation =
        locationHasAskedData(location, leadCategories) || topics.includes('location');
      if (attachLocation) {
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
  // Wave 3 — "price and connectivity": microMarket / summary alone is enough
  // to attach location evidence so compose is not price-only.
  return Boolean(
    loc.connectivitySummary ||
      loc.microMarketOverview ||
      loc.microMarket ||
      loc.nearbyPois?.length ||
      loc.driveTimes?.length ||
      loc.schools?.length ||
      loc.hospitals?.length ||
      loc.metroStations?.length ||
      loc.airports?.length,
  );
}

function buildLocationEvidence(
  detail: import('./types.js').ProjectDetail,
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

/** Phase 0b — record tool name + latency + failure_reason onto evidence. */
function stampToolRun<T>(
  evidence: EvidenceSet,
  name: string,
  result: DataResult<T>,
): EvidenceSet {
  const tools = [...new Set([...(evidence.tools ?? []), name])];
  const toolLatencyMs = { ...(evidence.toolLatencyMs ?? {}), [name]: result.latency_ms };
  if (result.ok) {
    if (!evidence.toolFailureReason?.[name]) {
      return { ...evidence, tools, toolLatencyMs };
    }
    const nextFail = { ...evidence.toolFailureReason };
    delete nextFail[name];
    return {
      ...evidence,
      tools,
      toolLatencyMs,
      ...(Object.keys(nextFail).length ? { toolFailureReason: nextFail } : {}),
    };
  }
  return {
    ...evidence,
    tools,
    toolLatencyMs,
    toolFailureReason: { ...(evidence.toolFailureReason ?? {}), [name]: result.reason },
  };
}

async function enrichDetailLegal(
  deps: EngineDeps,
  nd: string,
  detail: ProjectDetail,
): Promise<ProjectDetail> {
  if (detail.reraNumber?.trim() && detail.phases?.length) return detail;
  const ctx = await deps.data.conversationContext(nd).catch(() => null);
  // Context is Desk-focus-scoped — never overlay another project's RERA/phases.
  if (!ctx?.project?.project_id || ctx.project.project_id !== detail.projectId) {
    return detail;
  }
  let next = detail;
  const projectRera = ctx.project.rera_number?.trim();
  if (!next.reraNumber?.trim() && projectRera) {
    next = { ...next, reraNumber: projectRera };
  }
  if (!next.phases?.length && ctx.phase_journeys?.length) {
    const phases = ctx.phase_journeys.map((j) => ({
      phaseId: j.phase_id,
      phaseLabel: j.phase_label,
      stage: j.stage,
      ...(j.possession_date ? { possession: j.possession_date } : {}),
      ...(j.rera_number?.trim() ? { reraNumber: j.rera_number.trim() } : {}),
    }));
    const phaseRera = phases.find((p) => p.reraNumber)?.reraNumber;
    next = {
      ...next,
      phases,
      ...(!next.reraNumber?.trim() && phaseRera ? { reraNumber: phaseRera } : {}),
    };
  }
  return next;
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
  // Stage 7 — handoff compose reads escalation_phone from Desk builder row.
  if (goal.kind === 'handoff') {
    const b = await deps.data.builder(s.builderId).catch(() => null);
    return {
      tools: ['builder'],
      ...(b?.escalationPhone?.trim() ? { escalationPhone: b.escalationPhone.trim() } : {}),
    };
  }
  return { tools: [] };
}

function compareIds(s: ConversationState): string[] {
  const discussed = discussedList(s);
  if (discussed.length >= 2) return discussed.map((p) => p.projectId).slice(0, 3);
  const ids = currentShortlist(s).map((o) => o.projectId);
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
        const fromOffered = currentShortlist(s).find((o) => o.projectId === goal.projectId);
        const fromDiscussed = discussedList(s).find((o) => o.projectId === goal.projectId);
        const name = fromOffered?.name ?? fromDiscussed?.name ?? s.focus?.projectName;
        if (name) discussed.push({ projectId: goal.projectId, name });
      }
      let next = discussed.length ? recordDiscussed(s, discussed) : s;
      // Catalog escape from sticky handoff — restore focused so later facet
      // asks are not trapped in handoff.decide forever.
      if (next.phase === 'handoff' && next.focus) {
        next = { ...next, phase: 'focused' };
      }
      // Pin listed config (Ivory) so the next price/all-in ask stays on that unit.
      const topics = goal.topics?.length ? goal.topics : [goal.topic];
      if (ev.units?.length && goal.projectId) {
        const pinned = pickFocusUnit(goal.projectId, ev.units, undefined, next.focusUnit);
        if (pinned) next = { ...next, focusUnit: pinned };
      } else if (
        topics.includes('price') &&
        next.focusUnit &&
        next.focusUnit.projectId !== goal.projectId
      ) {
        const { focusUnit: _drop, ...rest } = next;
        next = rest;
      }
      return next;
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
      // Keep focus — sticky handoff must not drop the project pin. Catalog
      // re-engage (loan/brochure/amenities) needs focus to answer, not ask
      // "which project?". Advisor project_id sticky also re-commits focused.
      return { ...s, phase: 'handoff', ...(s.focus ? { focus: s.focus } : {}) };
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

  // CRM safety net: mirror visit window await / clear on book.
  if (goal.kind === 'visit_ask' && goal.ask === 'window' && goal.state.pendingDayIso) {
    await deps.crm
      .setPendingAction(nd, {
        kind: 'visit_window',
        payload: {
          project_id: goal.state.projectId ?? '',
          project_name: goal.state.projectName ?? '',
          day_iso: goal.state.pendingDayIso,
          day_label: goal.state.pendingDayLabel ?? '',
        },
      })
      .catch(() => {});
  } else if (goal.kind === 'visit_booked') {
    await deps.crm.setPendingAction(nd, null).catch(() => {});
  }

  if ((goal.kind === 'recommend' || goal.kind === 'ack_reject_recommend') && ev.matches?.length) {
    await deps.crm.syncShortlist(nd, ev.matches.map((m) => m.projectId));
    await deps.crm.syncMatching(nd, ev.matches.map((m) => m.projectId));
    // Phase 0a — choice events carry observed status, not hardcoded ok.
    const choiceStatus = ev.failure
      ? 'error'
      : ev.notices?.length || ev.faqMiss?.keys.length || ev.noMatch
        ? 'partial'
        : 'ok';
    await deps.crm.postChoiceEvent(
      s.builderId,
      s.ndBuyerPhone ?? '',
      nd,
      ev.matches.map((m) => ({ projectId: m.projectId, name: m.name })),
      s.constraints as Record<string, unknown>,
      choiceStatus,
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

async function appendEarlyFailureLedger(input: {
  deps: EngineDeps;
  nd: string;
  input: EngineTurnInput;
  state: ConversationState;
  ex: Extracted;
  extractProvenance: ExtractProvenance | undefined;
  inputSource: TurnInputSource;
  reply: string;
  failure: Failure;
  evidence?: EvidenceSet;
  goal?: TurnGoal;
}): Promise<void> {
  const {
    deps,
    nd,
    input: turnInput,
    state,
    ex,
    extractProvenance,
    inputSource,
    reply,
    failure,
  } = input;
  const goal: TurnGoal = input.goal ?? { kind: 'handoff' };
  const evidence: EvidenceSet = input.evidence ?? { tools: [], failure };
  const ledger = buildLedgerWritePayload({
    state,
    ex,
    goal,
    evidence,
    inputSource,
    ...(extractProvenance ? { extractProvenance } : {}),
    grounding: 'pass',
    failures: evidence.education ? [] : [failure],
    buyerText: turnInput.text,
  });

  await deps.crm
    .appendTurnLedger({
      conversationId: nd,
      turnIndex: state.turnCount,
      builderId: state.builderId,
      buyerPhone: state.ndBuyerPhone ?? turnInput.buyerPhone,
      buyerText: turnInput.text,
      reply,
      goal: goal.kind,
      tools: evidence.tools,
      phase: state.phase,
      snapshotIn: ledger.snapshot_in,
      resolvedIntent: ledger.resolved_intent,
      actionPlan: ledger.action_plan,
      verify: ledger.verify,
      composer: ledger.composer,
      toolRuns: ledger.tool_runs,
      disclosedFacts: ledger.disclosed_facts,
    })
    .catch((err) => {
      console.error('[appendEarlyFailureLedger]', nd, err);
    });

  deps.emitTurnLog?.(
    buildTurnLogSnapshot({
      turnInput,
      state,
      ex,
      goal,
      debug: withIngressDebug(
        { phase: state.phase, goal, tools: evidence.tools, grounding: 'pass' },
        inputSource,
        extractProvenance,
      ),
      reply,
      evidence,
      buyerText: turnInput.text.trim(),
      failures: evidence.education ? [] : [failure],
      exit: 'ambiguous_opt_out',
    }),
  );
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
    failures?: readonly Failure[];
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
        buyerText: input.text,
        ...(opts.failures?.length ? { failures: opts.failures } : {}),
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
  const hasShortlist = currentShortlist(state).length > 0;

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
