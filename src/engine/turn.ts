/**
 * ConverseEngine — the turn kernel.
 * extract → merge → phase transition → goal → evidence → compose → verify → persist
 */
import * as discover from './phases/discover.js';
import { asksForAHuman, HANDOFF_QUESTIONS } from './book-questions.js';
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
import { DEFAULT_SITE_VISIT_HOURS, parseSiteVisitDays } from './visit-hours.js';
import { AFFIRM_ONLY, DECLINE } from './turn-intent/dialogue-acts.js';
import { isDifferentDayPhrase, isSameDayPhrase } from './visit-itinerary.js';
import * as handoff from './phases/handoff.js';
import { buildTurnLogSnapshot } from '../observability/turn-log-snapshot.js';
import { extractTurnAuthority } from './extract-authority.js';
import {
  advanceWaBriefState,
  isWaBriefActionId,
  packWhatsAppInteractive,
  packedToSuggestedActions,
  splitProjectStamp,
  syncWaBriefFromGoal,
  waCanonicalUtterance,
  waConsoleRows,
  waListPickKeepsCommit,
  WA_MENU_NODE,
  WA_MENU_PROJECTS,
  WA_MENU_SEE,
  WA_MENU_KNOW,
  WA_MONEY_TOTAL,
  WA_NODE_LATER,
  WA_NODE_LIFE,
  WA_NODE_PLACE,
  WA_NODE_TIME,
  WA_NODE_TRUST,
  type WaPacked,
} from '../channel/wa-pack.js';
import { waConsoleCardReply, waConsoleNodeReply } from '../channel/wa-console.js';
import { hydrateStateFromFeedForward, mapLedgerPrior } from './ledger-read.js';
import { extractDisclosedFacts, hasDisclosedRera, mergeDisclosedFacts } from './disclosed-facts.js';
import { buildLedgerWritePayload, type ComposeTelemetry } from './ledger-write.js';
import { costTermsFromCostSheet } from './cost-terms.js';
import { deriveShadowFailures } from './failure-shadow.js';
import { resolveDurableLocation } from './geography-authority.js';
import { searchWithAuthorityRelaxation } from './search-outcome.js';
import { searchLocalityWiden } from './locality-widen.js';
import {
  currentShortlist,
  discussedList,
  discourseEntities,
  markFacetSeen,
  popFocus,
  projectSeenFacets,
  type SeenFacet,
} from './entity-store.js';
import {
  collapseCoverageMarkets,
  coverageCityCoverBit,
  coverageCoverBit,
  deskKnowsAsPlace,
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
  isStandaloneDelete,
  keepsOneChannel,
  resolvePendingStop,
} from './optout-confirm.js';
import { CONSENT_NOTICE, owesConsentNotice } from './consent-line.js';
import { owesWelcome, welcomeLine } from './welcome.js';
import { performErasure } from './erasure-reply.js';
import { intelGatedSubject, speakFailure } from './speak-failure.js';
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
  textAnchorsProjectName,
  wantsCostBreakdown,
} from './facts.js';
import { resolveShortlistNames, seedFromDeskBrief } from './desk-brief.js';
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
  freshSession,
  isSessionResetText,
  isSameAsLast,
  markAsked,
  markOriented,
  recordDiscussed,
  recordOffered,
  releaseToDiscover,
  withNdConversation,
} from './state.js';
import { buildComposeRequest, componentsForAsk, fallbackReply, formatInr, minimumBudgetReply, typeComparisonReply, waBookFirstGreet } from './compose.js';
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
import {
  humanizeMediaKind,
  mediaKindMissingFromInventory,
  normalizeMediaAssetKind,
  requestedMediaKinds,
} from './media-asset.js';
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
import { isAttentionNudge, isNonPlaceUtterance, isPlausiblePlaceLabel } from './placeability.js';
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
import type { DataResult, EngineDeps, UnitConfig } from './ports.js';

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
  /** Packed Cloud API interactive (list XOR buttons) when WA_PROJECT_FIRST. */
  whatsappInteractive?: WaPacked;
  /** Structured media for Advisor cards / WhatsApp native send — never in prose. */
  mediaAttachments?: MediaAttachment[];
  /**
   * This turn erased the buyer, so the store copy of the state is gone.
   * Anything that would write the state back — the consent stamp below is the
   * first — has to know, or it resurrects the conversation we just purged.
   */
  erased?: boolean;
  /**
   * The one-time "STOP / DELETE" line, when this turn is the one that owes it.
   * Delivered as its own message rather than glued to `reply`, so it cannot
   * eat into WhatsApp's 1024-character interactive body.
   */
  consentNotice?: string;
  /**
   * The self-registration hello, sent once and BEFORE the reply.
   *
   * The mirror image of `consentNotice`: that line trails the answer so the
   * buyer's own question is what they read first; this one leads, because a
   * greeting delivered after the answer is not a greeting. Its own message for
   * the same reason — the 1024-character interactive body.
   */
  welcome?: string;
}

/**
 * The state handed back on the turn that erased the buyer.
 *
 * The store copy is purged, but this object is still RETURNED — the advisor
 * mapper reads `result.state` to build the HTTP response, so whatever is left
 * on it goes back over the wire on the very turn we said everything was
 * deleted. It has to be empty of the person: no focus, no shortlist, no brief,
 * and no `ndConversationId`/`ndBuyerPhone` pointing back at Desk.
 *
 * `initState`, not `freshSession` — freshSession deliberately keeps the Desk
 * conversation id and the buyer's phone so an ordinary restart stays attached
 * to the same lead. That is right for "start over" and wrong for this.
 */
function erasedState(prev: ConversationState): ConversationState {
  return {
    ...initState(prev.convId, prev.builderId),
    phase: 'handoff',
    turnCount: prev.turnCount + 1,
  };
}

/**
 * The turn, plus the one thing that has to happen on exactly one turn.
 *
 * `runEngineTurnCore` has around forty return sites. A rule that applies to
 * the FIRST reply and no other cannot live inside it without being written
 * forty times and forgotten in half of them — that is the shape of the
 * three-copies-one-gate bug we already paid for once. So it lives here, at the
 * single exit, and reads the state that comes back: no stamp means this buyer
 * has never been told, whatever the turn happened to be about.
 *
 * A conversation that predates this code has no stamp either, and gets the
 * line on its next turn. That is correct, not a migration gap: those buyers
 * were never told how to leave.
 */
export async function runEngineTurn(
  input: EngineTurnInput,
  deps: EngineDeps,
): Promise<EngineTurnOutput> {
  let out = await runEngineTurnCore(input, deps);
  const channel = input.channel ?? 'whatsapp';

  // The self-registration welcome. Same seam and the same reason as the
  // consent notice below: a first-reply-only rule cannot live at forty return
  // sites. Runs FIRST because the stamp it writes has to survive into the same
  // save the consent notice performs, and because a welcome that arrives after
  // the answer is not a welcome.
  const welcomeArgs = {
    channel,
    ...(out.state.selfRegistered ? { selfRegistered: true } : {}),
    ...(out.state.welcomedAt !== undefined ? { welcomedAt: out.state.welcomedAt } : {}),
    ...(out.erased ? { erased: true } : {}),
    ...(out.state.buyerName ? { buyerName: out.state.buyerName } : {}),
    builderName: friendlyBuilder(out.state.builderId),
    constraints: out.state.constraints,
    ...(out.state.focus?.projectName ? { focusProjectName: out.state.focus.projectName } : {}),
  };
  if (owesWelcome(welcomeArgs)) {
    const welcome = welcomeLine(welcomeArgs);
    if (welcome) {
      const state = { ...out.state, welcomedAt: deps.clock.nowMs() };
      await deps.store.save(state).catch(() => {});
      // Written down as well as sent, for the same reason the consent line is:
      // an outbound the transcript has no record of is not something we can
      // later say we said.
      if (state.ndConversationId) {
        await deps.crm
          .appendMessage(state.ndConversationId, 'outbound', welcome, { replyKey: 'welcome' })
          .catch(() => {});
      }
      out = { ...out, state, welcome };
    }
  }

  if (
    !owesConsentNotice({
      channel,
      ...(out.state.consentNoticedAt !== undefined
        ? { consentNoticedAt: out.state.consentNoticedAt }
        : {}),
      ...(out.erased ? { erased: true } : {}),
    })
  ) {
    return out;
  }
  const state = { ...out.state, consentNoticedAt: deps.clock.nowMs() };
  await deps.store.save(state).catch(() => {});
  // Written down as well as sent. "We told them" is the consent evidence, and
  // evidence that exists only in a message we hoped got delivered is not
  // evidence.
  if (state.ndConversationId) {
    await deps.crm
      .appendMessage(state.ndConversationId, 'outbound', CONSENT_NOTICE, {
        replyKey: 'consent_notice',
      })
      .catch(() => {});
  }
  return { ...out, state, consentNotice: CONSENT_NOTICE };
}

async function runEngineTurnCore(input: EngineTurnInput, deps: EngineDeps): Promise<EngineTurnOutput> {
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
  // Snapshot BEFORE anything in this turn can consume it: several lanes clear
  // pendingPrompt on their way through, so reading it at write time cannot tell
  // "there was no question" from "the question was just answered".
  const promptAtTurnStart = state.rti?.pendingPrompt;
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

  // A tap means what its ID says, not what its label reads. The visit FSM and
  // the regex lanes all consume free text, so a canonical utterance is how an
  // id speaks to them ("wa.day.saturday" → "saturday"). Without it a buyer who
  // taps "Sat 16 Aug" answers nothing and the machine re-asks forever.
  const canonicalTap = waCanonicalUtterance(input.action_id);
  const trimmedText = canonicalTap ?? input.text.trim();
  if (isSessionResetText(trimmedText) && !input.action_id) {
    const keptNd = state.ndConversationId;
    const keptPhone = state.ndBuyerPhone ?? input.buyerPhone;
    // "Starting fresh" was only ever fresh on this side: the visits live in
    // Desk, so an old booking kept clashing with the new walk two resets later.
    // The slash command is the explicit wipe (a buyer typing "start over" is
    // restarting the conversation, not cancelling visits they made).
    if (keptNd && trimmedText.trim().toLowerCase() === '/reset') {
      await deps.data.cancelSiteVisits(keptNd).catch(() => 0);
    }
    state = freshSession(state);
    if (keptNd) state = withNdConversation(state, keptNd, keptPhone);
    const channel: TurnIntentChannel = input.channel ?? 'whatsapp';
    const skipBrief = deps.waProjectFirst === true && channel === 'whatsapp';
    const catalog = await deps.data.catalog(state.builderId).catch(() => null);
    const reply = skipBrief
      ? `Starting fresh.\n\n${waBookFirstGreet({
          builderName: friendlyBuilder(state.builderId),
          catalog,
        })}`
      : 'Starting fresh — tell me the area and budget you are working with.';
    const packed = skipBrief
      ? packWhatsAppInteractive({
          goal: { kind: 'greet' },
          state,
          catalogNames: catalog?.projectNames ?? [],
          briefAreas: catalog?.microMarkets ?? [],
          singleProject: (catalog?.projectNames?.length ?? 0) <= 1,
          catalog,
        })
      : undefined;
    state = markOriented({
      ...state,
      turnCount: 1,
      lastReply: reply,
      recentReplies: rememberReply(state, reply),
    });
    await deps.store.save(state);
    const packedActions = packed ? packedToSuggestedActions(packed) : undefined;
    return {
      reply,
      state,
      debug: withIngressDebug(
        { phase: state.phase, goal: { kind: 'greet' }, tools: [], grounding: 'pass' },
        inputSource,
      ),
      ...(packedActions ? { whatsappActions: packedActions } : {}),
      ...(packed && packed.kind !== 'text' ? { whatsappInteractive: packed } : {}),
    };
  }
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

  // Which of the buyer's own fields came from Desk rather than this session.
  // Carried to debug so "the bot knew my budget" is a checkable claim about a
  // specific turn, not a thing we believe about the wiring.
  let deskBriefSeeded: string[] = [];
  // Desk bootstrap is expensive, so it runs when there is a reason to look —
  // not on a clock.
  //
  // The condition used to be `turnCount === 0`, described as "only on cold
  // conversations (first turn)". The session is what turns cold; the buyer is
  // not. `handleChat` resolves this `convId` from Desk's `upsertLead`, Desk's
  // `conversations` row is `UNIQUE(builder_id, buyer_phone)`, and the same id
  // keys the Durable Object — so a person gets exactly one turn 0, ever, and
  // every fact Desk recorded after it went into a row nobody would read again.
  // That is the whole reason a buyer who filled the registration form got a
  // hello with nothing in it: she had messaged the bot three days earlier.
  //
  // `deskBriefAt` asks the honest question instead — have we looked at all? An
  // empty row still counts as looked, so a session that finds nothing does not
  // re-fetch forever; `freshSession` clears it, so `/reset` looks again.
  if (nd && (state.turnCount === 0 || state.deskBriefAt === undefined)) {
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
      // What Desk already holds about this buyer — bhk, budget, area, purpose,
      // name, board. The row arrived in the same fetch above and used to be
      // dropped, so a buyer who filled Desk's registration form at the gate
      // met a bot that knew nothing about them. Gap-fill only: the live
      // session always wins, same rule as the ledger prior below.
      const briefSeed = seedFromDeskBrief(state, boot.deskBrief);
      state = briefSeed.state;
      if (briefSeed.seeded.length) {
        deskBriefSeeded = briefSeed.seeded;
      }
      // Stamped on the LOOK, not on the find — see `deskBriefAt`. A row that
      // holds nothing is an answer, and re-asking it every turn would put a
      // Desk round trip on the critical path of every message the bot handles.
      state = { ...state, deskBriefAt: deps.clock.nowMs() };
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
  const skipBrief = deps.waProjectFirst === true && channel === 'whatsapp';
  // "I know the project" — the welcome's third door. Nothing to compute: ask
  // for the name and get out of the way; the next typed message is the search.
  if (skipBrief && input.action_id === WA_MENU_KNOW) {
    const reply = 'Which project? Type the name — even roughly — and I’ll pull up its file.';
    state = {
      ...state,
      turnCount: state.turnCount + 1,
      lastReply: reply,
      recentReplies: rememberReply(state, reply),
    };
    state = appendTranscript(state, trimmedText, reply, deps.clock.nowMs());
    await deps.store.save(state);
    const knowPacked: WaPacked = {
      kind: 'buttons',
      buttons: [{ id: WA_MENU_PROJECTS, title: 'See everything' }],
    };
    return {
      reply,
      state,
      debug: withIngressDebug({ phase: state.phase, goal: { kind: 'orient' }, tools: [], grounding: 'pass' }, inputSource),
      whatsappActions: packedToSuggestedActions(knowPacked),
      whatsappInteractive: knowPacked,
    };
  }
  if (skipBrief && (input.action_id === WA_MENU_PROJECTS || input.action_id === WA_MENU_SEE)) {
    // Projects is the always-there exit: back to the book from anywhere.
    // releaseToDiscover, not popFocus — popFocus keeps a single-entry stack
    // unchanged, so the tap silently stayed on the project. Drop the visit
    // pending markers too so the window/day guards below don't pull the turn
    // back into the visit ask; keep the draft for a typed resume later.
    state = releaseToDiscover(state);
    if (state.visit && (state.visit.lastAsk || state.visit.pendingDayIso)) {
      const { lastAsk: _ask, pendingDayIso: _day, ...rest } = state.visit;
      state = { ...state, visit: rest };
    }
  }
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
  // Project-first WA: the RTI recovery machine is Advisor-web furniture — its
  // canned adjust-your-filters probe and patch-chips would hijack unrouted
  // turns (and persist junk like "green side" as a locality) before the
  // book's own clarify path (three doors) ever ran.
  //
  // But the veto was doing TWO jobs with one flag: keeping the recovery
  // machine out, and — by accident — throwing away the answer to the question
  // the bot itself just asked. Compose closers arm rti.pendingPrompt on every
  // channel ("Want pricing on a specific size?"), and a bare "yes" to that
  // offer was falling through 40 lanes of free-text guessing instead of
  // resolving against it. The gate below is cut so ruleClassify's L2 branch
  // (pending offer_pricing + focused + affirm/decline → focused_question)
  // always answers before the classifier LLM or any recovery kind can run —
  // the open question is read; the filter-adjust furniture stays dark.
  const waPendingOfferResolve =
    skipBrief &&
    !input.action_id &&
    state.phase === 'focused' &&
    state.rti?.pendingPrompt?.kind === 'offer_pricing' &&
    (AFFIRM_ONLY.test(trimmedText) || DECLINE.test(trimmedText));
  let runTurnIntent = Boolean(
    deps.turnIntent &&
      (!skipBrief || waPendingOfferResolve) &&
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
    // "Who will show me around the site?" classifies as release_focus — the
    // buyer is asking about a PERSON, and the classifier reads any turn that is
    // not about the project as leaving it. Dropping focus here answered a
    // question about Brigade Eldorado without naming Brigade Eldorado, and put
    // the whole book back on screen underneath it. Asking for a human is not
    // leaving the project you asked about.
    const keptFocus =
      state.focus && !applied.state.focus && skipBrief && asksForAHuman(trimmedText)
        ? state.focus
        : undefined;
    state = keptFocus
      ? { ...applied.state, phase: 'focused', focus: keptFocus }
      : applied.state;
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
      // The `lastReplyExcerpt` check above is a window of one, and the probe
      // menu came back three and four turns later untouched. This path speaks,
      // so it registers what it said and takes the same third-send break as
      // the compose tail.
      const { reply, state: outbound } = guardOutbound(state, applied.probeReply);
      state = {
        ...outbound,
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

  // Soft Advisor prefs (hub / schools / worries) stay off WhatsApp — this
  // number is a builder-allotted book, not the city-wide brief.
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
  // WA book: a locality must exist in this builder's live book (micro-market
  // or project-name echo). Place-ish junk ("green side") must not persist and
  // drive a doomed search — dropping it here lets the honest probe own the
  // turn. Live catalog only, never a hardcoded place list.
  if (skipBrief && ex.constraints.location && catalogForTurn) {
    const cand = ex.constraints.location.trim().toLowerCase();
    const namesHit = (catalogForTurn.projectNames ?? []).filter((p) =>
      p.name.trim().toLowerCase().includes(cand),
    );
    const known =
      cand.length >= 3 &&
      ((catalogForTurn.microMarkets ?? []).some((m) => {
        const mm = m.trim().toLowerCase();
        return mm.includes(cand) || cand.includes(mm);
      }) ||
        // One project echoed back as a "location" is a project reference we can
        // still act on. A fragment shared by several ("Brigade" in a Brigade
        // book) is the BRAND, and searching for it as a place returns "No exact
        // match for Brigade" against a book that is entirely Brigade.
        namesHit.length === 1);
    if (!known) {
      const { location: _junk, ...constraints } = ex.constraints;
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
        // `resolved` came from the same Desk endpoint, which answers ANY string:
        // "immediately" and "floor is available" both resolve, to the centroid
        // of India — which is of course outside served inventory, so the ask
        // arrived here and was named back as a town. Re-ask for the full answer
        // (source / area_id / radius) and let the registry decide whether there
        // is a place here at all. Serviceability is a separate question that
        // already works: "I don't have homes in *Pune*" stays.
        const askedGeo = askPoint
          ? await deps.data.resolveGeo(locationCandidate.trim()).catch(() => null)
          : null;
        if (
          askPoint &&
          looksLikePlaceFramedAsk(input.text) &&
          deskKnowsAsPlace(askedGeo) &&
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
  // Not on WA brief taps: the id is the meaning; topics read off the row label
  // ("Help me choose", "Under ₹85L") would dodge the minimal-brief step trap.
  if (!(skipBrief && isWaBriefActionId(input.action_id))) {
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

    ({ reply, state } = guardOutbound(
      { ...state, turnCount: state.turnCount + 1 },
      reply,
    ));
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
      // This is the door a buyer reaches by asking in words and then
      // confirming — the most deliberate delete request we get. It used to do
      // the LEAST: one table cleared, visits left standing, session intact,
      // and the same "removed your details" sentence as the branch below.
      // Both doors now run the same erasure.
      const run = await performErasure(deps, {
        convId: state.convId,
        builderId: state.builderId,
        ndConversationId: nd,
        buyerPhone: state.ndBuyerPhone ?? input.buyerPhone ?? '',
        scope: 'all',
      });
      state = erasedState(state);
      // No save, and no message rows: the state is purged and Desk refuses
      // writes to an erased conversation (410). Appending the buyer's words
      // back into the table we just swept is how a delete undoes itself.
      if (!run.purged) await deps.store.save(state);
      return {
        reply: run.reply,
        state,
        erased: true,
        debug: withIngressDebug(
          { phase: 'handoff', goal: { kind: 'handoff' }, tools: run.tools, grounding: 'pass' },
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

  // "Do not call, just message me here" is a request to KEEP talking, on one
  // channel. Extraction reads only the "do not call" half and stamps `stop`,
  // which sent it into the destructive gate below and answered a buyer who
  // asked us to keep messaging with an offer to delete their details.
  if (ex.stop && keepsOneChannel(trimmedText)) {
    const reply =
      `Noted — no calls, we'll keep everything here on WhatsApp. Nothing gets deleted, and it's on this conversation so the team sees it too. ` +
      (state.focus?.projectName
        ? `Carry on whenever you like — pricing for *${state.focus.projectName}*, the configurations, the legal papers, or a site visit.`
        : `Carry on whenever you like — pick any project below, or tell me a size or budget.`);
    state = { ...state, turnCount: state.turnCount + 1 };
    await deps.store.save(state);
    if (nd) {
      await deps.crm.appendMessage(nd, 'inbound', input.text).catch(() => {});
      await deps.crm
        .appendMessage(nd, 'outbound', reply, { replyKey: 'channel_preference' })
        .catch(() => {});
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

  if (ex.stop && nd) {
    // Standalone SMS keyword is an unambiguous opt-out — act immediately. Anything
    // longer (a sentence mentioning contact/data) confirms before the destructive
    // delete: extraction can misread, and "removed your details" must never be false.
    // The two advertised words, and they do different things. STOP stops the
    // messages and keeps the record; DELETE removes everything. Neither asks
    // for confirmation, because the greeting already told the buyer what each
    // one does — a keyword you advertise has to work when it is typed.
    const standaloneDelete = isStandaloneDelete(trimmedText);
    const standaloneStop = isStandaloneStop(trimmedText);
    if (standaloneDelete || standaloneStop) {
      const scope: 'all' | 'contact_only' = standaloneDelete ? 'all' : 'contact_only';
      // "I've removed your details" used to mean one thing: buyer-memory rows,
      // which Desk's own memory mirror then wrote back at the end of the next
      // turn — 10 of the last 11 completed erase requests on dev had the row
      // return, one of them 68.7 hours later carrying a budget and a visit
      // slot. Erasure now covers everything the buyer can still be shown, and
      // the reply is assembled from what the sweep reports rather than stated
      // in advance.
      const buyerPhone = state.ndBuyerPhone ?? input.buyerPhone ?? '';
      const run = await performErasure(deps, {
        convId: state.convId,
        builderId: state.builderId,
        ndConversationId: nd,
        buyerPhone,
        scope,
      });
      // `freshSession` + `withNdConversation` used to stand here. Both were
      // wrong once the state is really gone: the first WRITES a blank state
      // over the record rather than removing it, and — read it — `freshSession`
      // itself carries `ndConversationId` and `ndBuyerPhone` forward, so the
      // Desk pointer and the phone number survived the erasure inside the very
      // helper meant to clear them. `optedOut` went with them; nothing ever
      // read it, and a flag on a state we no longer keep cannot silence
      // anything. Suppression is Desk's tombstone, which every sender checks.
      if (scope === 'all') {
        state = erasedState(state);
        if (!run.purged) await deps.store.save(state);
      } else {
        // STOP retains the record at Desk, so the thread stays too — and both
        // sides of it are written down. An opt-out that leaves no trace of
        // having been asked for is the one a staff member later overrides.
        state = { ...state, phase: 'handoff', turnCount: state.turnCount + 1 };
        await deps.store.save(state);
        await deps.crm.appendMessage(nd, 'inbound', input.text).catch(() => {});
        await deps.crm
          .appendMessage(nd, 'outbound', run.reply, { replyKey: 'stop_contact_only' })
          .catch(() => {});
      }
      return {
        reply: run.reply,
        state,
        ...(scope === 'all' ? { erased: true as const } : {}),
        debug: withIngressDebug(
          {
            phase: 'handoff',
            goal: { kind: 'handoff' },
            tools: run.tools,
            grounding: 'pass',
          },
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
  /** The builder's own hours string — the chrome that offers a day is cut from it. */
  let siteHoursForTurn: string | undefined;
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

    siteHoursForTurn =
      (await deps.data.builder(state.builderId).catch(() => null))?.siteVisitHours ??
      'Mon–Sun, 9am–7pm';
    visitCtx = {
      // trimmedText, not input.text — a day/window TAP speaks to the FSM
      // through its canonical utterance, never through its human label.
      text: trimmedText,
      now,
      siteVisitHours: siteHoursForTurn,
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
  // Minimal-brief step machine: menu taps open it, answers advance it, picks
  // abandon it — before goal decide so the pending step can trap a pure turn.
  if (skipBrief) {
    // Descriptive-statement guard: an embedder name-bind off a vibe ("near
    // hills" → Coorg Hills Estate) must not open a project. A pure statement
    // in discover only commits when the text anchors the name; taps carry
    // ids, and questions/asks route normally.
    if (
      !input.action_id &&
      state.phase === 'discover' &&
      ((ex.namedProjects?.length ?? 0) > 0 || ex.pickName) &&
      !ex.isQuestion &&
      !ex.askTopic &&
      !(ex.askTopics?.length) &&
      ex.transition !== 'want_visit' &&
      ex.speechAct !== 'visit_book'
    ) {
      const anchored =
        (ex.namedProjects ?? []).some((p) => textAnchorsProjectName(trimmedText, p.name)) ||
        (ex.pickName ? textAnchorsProjectName(trimmedText, ex.pickName) : false);
      if (!anchored) {
        ex = { ...ex, namedProjects: undefined, pickName: undefined, implicitProjectPick: false };
      }
    }
    state = advanceWaBriefState(state, input.action_id, ex);
  }
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
  // WA list tap ≡ Advisor board open: keep commit (thin confirm + BHK list).
  // want_details on the packer stamp would otherwise swap this to overviewCard.
  if (skipBrief && waListPickKeepsCommit(input.action_id, goal, ex) && goal.kind === 'commit') {
    goal = { kind: 'commit', projectId: goal.projectId, projectName: goal.projectName };
  }
  // Discover can start the brief itself (help-me asks) — keep the step in sync.
  if (skipBrief) {
    state = syncWaBriefFromGoal(state, goal);
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
  // You never ask for a day you already have. One turn after "Done — your visit
  // is set for Saturday at 10:30 AM", "and can my brother come too" came back
  // as "Which day and time work for your visit?" — the booking had been erased
  // from state the moment it was made. Read the real booking back instead, once;
  // if the buyer genuinely wants a different day the next ask goes through, and
  // a day they NAME never reaches here (that is a propose, not an ask).
  // …but only about THAT project. A buyer who books Eldorado and then presses
  // "Book a visit" on Cornerstone gets their Eldorado booking read back at
  // them — an answer to a question nobody asked, and the second visit is lost.
  // The readback is for the project you already booked, not for the next one.
  const askingAboutAnotherProject =
    goal.kind === 'visit_ask' &&
    Boolean(goal.state?.projectId) &&
    goal.state.projectId !== state.lastBookedProjectId;
  if (
    goal.kind === 'visit_ask' &&
    (goal.ask === 'day' || goal.ask === 'time' || goal.ask === 'project') &&
    state.lastBookedProjectId &&
    !state.visitRebookOffered &&
    !askingAboutAnotherProject
  ) {
    goal = { kind: 'visit_recall' };
    state = { ...state, visitRebookOffered: true };
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
    // Cache this project's cost vocabulary the moment focus is taken, for every
    // commit — bare pick or pick-with-follow-up — so a later "floor rise?" is
    // recognised against the builder's real heads and not a regex we wrote.
    state = await cacheCostTerms(state, deps, nd, goal.projectId, goal.projectName);
    if (goal.followUp || goal.followUpTopics?.length) {
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
    evidence = fetchEmiCalculation(ex, state);
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

  // A buyer asking for a person gets a person, not nine project cards — the
  // list would read as the brush-off the ask was already trying to escape.
  // (Declared here so the attach guard below stays one expression.)
  // A book-level ask ("price?" before any project is picked) is answered from the
  // book's own spread, so the catalog has to reach compose. Search evidence never
  // carried it — only the greet path did. clarify_intent needs it for the same
  // reason: a miss should still hand the buyer something true about the book.
  // `no_fit` needs it too: on an allotted book, "nothing matched" is only half
  // an answer — the buyer has to see what the book does span to know which of
  // their filters to give up.
  if (
    ((goal.kind === 'recommend' &&
      (goal.askedTopic ||
        (goal.bookQuestion && !HANDOFF_QUESTIONS.has(goal.bookQuestion)) ||
        goal.situation)) ||
      goal.kind === 'clarify_intent' ||
      goal.kind === 'no_fit') &&
    !evidence.catalog &&
    catalogForTurn
  ) {
    evidence = { ...evidence, catalog: catalogForTurn };
  }

  // A project pick opens that project's OWN sizes — the sub-option step in the
  // book design. Copy and chrome are decided from the same configs, fetched
  // before compose so the sentence can never promise rows the pack won't send.
  let pickSizeUnits:
    | Array<{ unitType: string; priceDisplay: string; priceMinInr: number; sizeDisplay?: string }>
    | undefined;
  // The goal carries the picked id — state.focus is only committed later in
  // the turn, so reading focus here saw the PREVIOUS project (or none at all).
  const pickedProjectId =
    goal.kind === 'commit' ? goal.projectId || state.focus?.projectId : undefined;
  if (skipBrief && pickedProjectId && !state.constraints?.bhk?.trim()) {
    pickSizeUnits = await deps.data.listUnits(pickedProjectId).catch(() => []);
  }
  const offersSizeRows = (pickSizeUnits?.length ?? 0) >= 2;

  const alreadyShownSameSet = evidence.matches ? isSameAsLast(state, evidence.matches) : false;
  // The board, by name. Live session first; Desk's durable ids resolved
  // against the catalog name index this turn already holds, so reading the
  // shortlist back costs no extra call.
  const shortlistNames = resolveShortlistNames(
    state,
    currentShortlist(state),
    catalogForTurn?.projectNames,
  );
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
    ...(skipBrief ? { waProjectFirst: true } : {}),
    ...(offersSizeRows ? { waSizeOptions: pickSizeUnits!.length } : {}),
    ...(state.focus ? { focusProjectName: state.focus.projectName } : {}),
    returningBuyer: state.returningBuyer,
    ...(ff?.priorTopics?.length ? { priorTopics: ff.priorTopics } : {}),
    // The last thing the buyer read. Templates need it too, not just the LLM:
    // a template-locked nudge is exempt from the repeat guard, so without this
    // it repeated itself verbatim turn after turn.
    ...(ff?.priorReplyExcerpt || state.lastReply
      ? { priorReplyExcerpt: ff?.priorReplyExcerpt || state.lastReply! }
      : {}),
    ...(disclosedForCompose.length ? { disclosedFacts: disclosedForCompose } : {}),
    // Stage 7 — named latch when Desk provides escalation_phone on builder/objection ctx.
    ...(evidence.escalationPhone?.trim()
      ? { handoffPhone: evidence.escalationPhone.trim(), handoffTeamName: friendlyBuilder(state.builderId) }
      : {}),
    ...(shortlistNames.length ? { shortlistNames } : {}),
    ...(state.selfRegistered ? { selfRegistered: true } : {}),
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
  const waBagDeterministic =
    skipBrief &&
    !state.focus &&
    (goal.kind === 'greet' ||
      goal.kind === 'clarify_intent' ||
      goal.kind === 'smalltalk' ||
      goal.kind === 'probe' ||
      goal.kind === 'recommend' ||
      goal.kind === 'ack_reject_recommend');

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
    emiCalculateDeterministic ||
    waBagDeterministic;

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
  // Checked FIRST, and against the whole window: the single-line guard below
  // would otherwise "acknowledge" the third send and call it handled — which is
  // how the same menu went out at turns 7, 9, 10 and 13 with an apology stapled
  // to half of them. Only a question, and only on what would be the third send.
  if (/\?$/.test(reply.trim()) && timesAlreadySent(reply, state) >= 2) {
    reply = breakRepeatLoop();
    repeat_guard = 'loop_broken';
  } else if (!hybridOn && !templateLocked && !retryUsed && state.lastReply && sameLine(reply, state.lastReply)) {
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
      if (!sameLine(floor, state.lastReply)) {
        reply = floor;
        repeat_guard = 'template';
      } else {
        // The floor is the same line too. It used to ship verbatim here.
        reply = acknowledgeRepeat(floor);
        repeat_guard = 'acknowledged';
      }
    }
  } else if (state.lastReply && sameLine(reply, state.lastReply)) {
    // A template that lands on the same line twice. The content is deterministic
    // and must not be paraphrased — a hold's terms have to restate exactly — but
    // sending the identical message is the bot not registering that the buyer
    // already read it. Say that we noticed, keep the facts word-for-word.
    reply = acknowledgeRepeat(reply);
    repeat_guard = 'acknowledged';
  }

  if (evidence.notices?.length) {
    const projectName = state.focus?.projectName;
    // Two plain `no_data` misses used to speak twice — "I don't have carpet area
    // on file. I do have the cost sheet. I don't have built up area on file. I do
    // have the cost sheet." One gap, named once, with one shared offer.
    const plain = evidence.notices.filter(
      (f) => f.kind === 'no_data' && !intelGatedSubject(f.subject),
    );
    const rest = evidence.notices.filter((f) => !plain.includes(f));
    const parts: string[] = [];
    if (plain.length) {
      const subjects = dedupe(plain.map((f) => f.subject.replace(/[._]/g, ' ')));
      const alts = dedupe(plain.flatMap((f) => failureAlternatives(f, evidence)));
      parts.push(
        `I don't have ${joinWith(subjects, 'or')} on file${projectName ? ` for *${projectName}*` : ''}.` +
          (alts.length ? ` I do have ${joinWith(alts, 'and')}.` : ''),
      );
    }
    for (const failure of rest) {
      parts.push(
        speakFailure(failure, {
          ...(projectName ? { projectName } : {}),
          alternatives: failureAlternatives(failure, evidence),
        }),
      );
    }
    reply = `${parts.join(' ')} ${reply}`.trim();
  }

  // "Loan eligibility, or shall I walk through the configs?" — "yes" answers a
  // question that had two answers. The engine takes the first, which is fine;
  // taking it SILENTLY is not. One clause names the branch taken and the way to
  // the other, so a yes is never a guess the buyer can't see or undo.
  if (
    goal.kind === 'answer' &&
    trimmedText &&
    AFFIRM_ONLY.test(trimmedText) &&
    (promptAtTurnStart?.options?.length ?? 0) > 1 &&
    goal.topic === promptAtTurnStart!.options![0]
  ) {
    const other = promptAtTurnStart!.options![1]!;
    reply = `${forkTopicLabel(goal.topic)} first — say *${forkTopicWord(other)}* for ${forkTopicPhrase(other)}.\n\n${reply.trim()}`;
  }

  // A multi-asset ask is answered one asset at a time, and silence on the rest
  // reads as "sent". Name what did not go out — the buyer is waiting for it.
  if (goal.kind === 'answer' && trimmedText) {
    const wanted = requestedMediaKinds(trimmedText);
    if (wanted.length > 1) {
      const sent = normalizeMediaAssetKind(evidence.media?.assetKind);
      const missing = wanted.filter((k) => k !== sent);
      if (missing.length && evidence.media?.allowed) {
        reply = `${reply.trim()}\n\nI haven't sent ${joinWith(missing.map(humanizeMediaKind), 'or')} — say the word and I'll check what's on file for it.`;
      }
    }
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

  // Console voice — a node tap's screen is authored from the same record the
  // honest menu gate read. Compose's closers, leftovers and config dumps never
  // ride a tap; free text keeps the engine's reply untouched.
  /** The committed project's record, resolved for the card AND the pack site. */
  let commitDetail: ProjectDetail | undefined;
  let renderedCommitCard = false;
  let authoredNode: string | undefined;
  if (skipBrief) {
    authoredNode = waConsoleNodeReply(input.action_id, goal, evidence.detail);
    if (authoredNode) reply = authoredNode;
    // The book screen — "See everything" / "Back to projects" opens the list,
    // and the words describe the book, not whatever goal the engine landed on.
    if (!state.focus && (input.action_id === WA_MENU_PROJECTS || input.action_id === WA_MENU_SEE)) {
      const mm = (catalogForTurn?.microMarkets ?? []).slice(0, 3).join(', ');
      reply = `Here's the book${mm ? ` — ${mm}` : ''}. Pick a project, or tap *✨ Help me choose* and I'll cut it to fit in two taps.`;
    }
    // The project card. With a size already given, it states the buyer's fit —
    // the size is CONSUMED, spoken back as this project's answer. Without one,
    // it is the mock's card: one labelled line per node the record can back.
    // Gate on the GOAL's project: state.focus is only committed later in the
    // turn, so reading it here missed the first pick every time (founder walk,
    // 14 Aug — the pick answered in the old voice with a bare Price button).
    if (goal.kind === 'commit' && goal.projectId) {
      const pid = goal.projectId;
      const name = goal.projectName ?? state.focus?.projectName ?? 'This project';
      // A plain list-pick deliberately fetches no overview — resolve the record
      // anyway so the card and the console menu are cut from what the project
      // actually holds, not from silence. Read the cache THROUGH hydrate, never
      // directly: the board search prefetches every match, and a match that
      // isn't Desk's current focus legitimately yields an identity-only shell
      // (name + units; no RERA, no media, no location). Taking that shell at
      // face value is what left the console showing money rows and nothing else
      // (founder, 14 Aug — "I don't see other options even now"). hydrate
      // refuses unusable cards and re-fetches; the adapter's catalog-GET
      // fallback carries the legal/possession facts the file rows are gated on.
      commitDetail =
        evidence.detail && evidence.detail.projectId === pid
          ? evidence.detail
          : ((await hydrateProjectDetail(deps, state, pid).catch(() => null))?.detail ??
            undefined);
      // One config list for the card, the fit lines AND the console menu. An
      // overview-fetched detail carries no configurations — graft them on so
      // the cached record keeps feeding money rows on every later turn.
      const commitUnits = commitDetail?.configurations?.length
        ? commitDetail.configurations
        : pickSizeUnits?.length
          ? pickSizeUnits
          : await deps.data.listUnits(pid).catch(() => []);
      if (commitDetail && !commitDetail.configurations?.length && commitUnits.length) {
        commitDetail = {
          ...commitDetail,
          configurations: commitUnits.map((u) => ({
            unitType: u.unitType,
            priceDisplay: u.priceDisplay,
            priceMinInr: u.priceMinInr,
            ...(u.sizeDisplay ? { sizeDisplay: u.sizeDisplay } : {}),
          })),
        };
      }
      if (state.constraints?.bhk?.trim()) {
        const wanted = /(\d+)/.exec(state.constraints.bhk)?.[1];
        const fit = wanted
          ? commitUnits.filter((u) => new RegExp(`\\b${wanted}\\s*BHK`, 'i').test(u.unitType))
          : [];
        if (fit.length) {
          const lines = fit
            .slice(0, 3)
            .map((u) => `• ${[u.unitType, u.sizeDisplay, u.priceDisplay].filter(Boolean).join(' · ')}`);
          reply = `*${name}* — your fit:\n${lines.join('\n')}\n\nWhat do you want to check?`;
          renderedCommitCard = true;
        }
      } else {
        const card = commitDetail ? waConsoleCardReply(commitDetail, pickSizeUnits) : undefined;
        if (card) {
          reply = card;
          renderedCommitCard = true;
        }
      }
    }
  }

  state = applyGoalToState(state, goal, evidence);
  if (skipBrief && (goal.kind === 'greet' || goal.kind === 'recommend' || goal.kind === 'orient')) {
    state = markOriented(state);
  }
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
  // The commit's resolved record is durable project truth — cache it so the
  // very next turn's menu and screens read it for free (answer turns get the
  // same treatment below; commit was the gap that left focusFacts cold).
  // identityOnly shells are NOT project truth — promoting one installs a card
  // that every later hydrate treats as a hit, so the file rows stay missing for
  // the whole conversation. Cache only a record that already stands on its own.
  if (
    skipBrief &&
    commitDetail &&
    goal.kind === 'commit' &&
    goal.projectId === commitDetail.projectId &&
    !commitDetail.identityOnly
  ) {
    const { faqs: _questionScoped, ...rawDurable } = commitDetail;
    state = {
      ...state,
      projectCache: {
        ...(state.projectCache ?? {}),
        [commitDetail.projectId]: promoteDurableProjectDetail(rawDurable),
      },
    };
  }
  // The seen ledger — mark ONLY what this turn actually DELIVERED (never a
  // miss), then let this same turn's menu drop it. Ordering is load-bearing:
  // after applyGoalToState (the entity exists), before the reply is remembered
  // and packed — so no one-turn special case exists anywhere.
  if (skipBrief) {
    const goalPid =
      goal.kind === 'commit' || goal.kind === 'answer' ? goal.projectId : undefined;
    const seenPid = goalPid ?? state.focus?.projectId;
    if (seenPid) {
      if (renderedCommitCard) state = markFacetSeen(state, seenPid, 'card');
      if (authoredNode && input.action_id) {
        const facetByNode: Record<string, SeenFacet> = {
          [WA_NODE_TRUST]: 'trust',
          [WA_NODE_PLACE]: 'place',
          [WA_NODE_LIFE]: 'life',
          [WA_NODE_TIME]: 'time',
          [WA_NODE_LATER]: 'later',
          [WA_MENU_NODE]: 'card',
        };
        const facet = facetByNode[splitProjectStamp(input.action_id.trim()).aid];
        if (facet) state = markFacetSeen(state, seenPid, facet);
      }
      if (goal.kind === 'answer' && goal.topic === 'price') {
        // 'total' means the all-in number was DELIVERED — a headline price is
        // not it, unless the buyer tapped Total cost and pricing is all we had.
        const tappedTotal =
          !!input.action_id &&
          splitProjectStamp(input.action_id.trim()).aid === WA_MONEY_TOTAL;
        if (evidence.landedCost || (tappedTotal && evidence.pricing)) {
          state = markFacetSeen(state, seenPid, 'total');
        }
      }
      if (goal.kind === 'answer' && goal.topic === 'emi' && evidence.emi) {
        state = markFacetSeen(state, seenPid, 'emi');
      }
      if (evidence.media?.allowed) {
        const sentKind = normalizeMediaAssetKind(evidence.media.assetKind);
        if (sentKind === 'brochure') state = markFacetSeen(state, seenPid, 'brochure');
        if (sentKind === 'payment_plan') state = markFacetSeen(state, seenPid, 'plan');
      }
      // All seen → say so instead of drawing an empty file — the mock's ending.
      // Mirrors the pack site's inputs; ≥2 seen facets keeps a bare stub record
      // from claiming a tour that never happened.
      const seenNow = projectSeenFacets(state, seenPid);
      if (seenNow.length >= 2) {
        const facts =
          commitDetail?.projectId === seenPid
            ? commitDetail
            : evidence.detail?.projectId === seenPid
              ? evidence.detail
              : state.projectCache?.[seenPid];
        const unitsNow =
          (evidence.units?.length ? evidence.units : undefined) ??
          (pickSizeUnits?.length ? pickSizeUnits : undefined) ??
          facts?.configurations ??
          [];
        const { infoCount } = waConsoleRows({
          ...(facts ? { facts } : {}),
          units: unitsNow,
          ...(state.constraints?.bhk?.trim() ? { bhk: state.constraints.bhk.trim() } : {}),
          seen: seenNow,
        });
        const doneLine = 'the full file on';
        if (
          infoCount === 0 &&
          facts &&
          !reply.includes(doneLine) &&
          !(state.lastReply ?? '').includes(doneLine)
        ) {
          const name =
            state.focus?.projectId === seenPid ? state.focus.projectName : undefined;
          reply = `${reply.trim()}\n\nYou've been through the full file on *${name ?? 'this one'}* — want me to set up a visit?`;
        }
      }
    }
  }
  // W3 — remember the outbound line for the repeat guard, and its fingerprint
  // for the wider window.
  state = { ...state, lastReply: reply, recentReplies: rememberReply(state, reply) };
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
      ...(state.constraints?.bhk ? { constraints: { bhk: state.constraints.bhk } } : {}),
      focus: state.focus
        ? { projectId: state.focus.projectId, projectName: state.focus.projectName }
        : null,
      // A hold or a visit awaiting confirmation is a HARD question — the engine
      // asked it and is holding a commitment open on the answer. A closing
      // "want pricing next?" is a soft nudge. One pending question per turn
      // means the soft one yields; otherwise a digression's closer quietly
      // steals the yes that belonged to the hold.
      hardQuestionOutstanding:
        (state.hold?.unitType != null && state.turnCount - (state.hold.offeredAtTurn ?? 0) <= 6) ||
        state.visit?.awaitingConfirm === true,
      // A soft offer binds ONCE. Without this, "ok / ok / ok" walks the buyer
      // through every topic in the table and never reaches a next step.
      // Read the utterance, not just ex.affirm — several lanes route a bare
      // "ok" without ever stamping the affirm flag.
      consumingAffirm:
        Boolean(promptAtTurnStart) && (Boolean(ex.affirm) || AFFIRM_ONLY.test(trimmedText)),
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
      // The same values `debug.timings` reports, but written where they
      // survive the response. Without this the compose lane has no history
      // and "retire the paid composer?" stays an opinion.
      compose: {
        llm_used: llmUsed,
        ...(llmShed ? { llm_shed: true } : {}),
        ...(composeTemplate ? { template: true } : {}),
        ...(composeMs !== undefined ? { compose_ms: composeMs } : {}),
        total_ms: deps.clock.nowMs() - turnStartedMs,
        ...(deps.embedMeter && deps.embedMeter.calls > 0
          ? { embed_calls: deps.embedMeter.calls, embed_ms: deps.embedMeter.ms }
          : {}),
      },
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
      ...(deskBriefSeeded.length ? { desk_brief_seeded: deskBriefSeeded } : {}),
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
        // Cuts across the phases above rather than sitting between them: the
        // embed lanes fire inside pre_extract, routing and mid. Reported as a
        // total because the question it answers is "how many times did this one
        // turn go to Workers AI", not "which phase paid for it".
        ...(deps.embedMeter && deps.embedMeter.calls > 0
          ? {
              embed_ms: deps.embedMeter.ms,
              embed_calls: deps.embedMeter.calls,
              embed_texts: deps.embedMeter.texts,
            }
          : {}),
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

  let packed: WaPacked | undefined;
  if (skipBrief) {
    // The money menu's rows ARE the project's configs, so it needs them even
    // when the answer itself was a headline price (evidence.units is only
    // filled for availability answers).
    let moneyUnits = evidence.units?.length ? evidence.units : pickSizeUnits;
    if (
      !moneyUnits?.length &&
      goal.kind === 'answer' &&
      (goal.topic === 'price' || goal.topic === 'emi') &&
      state.focus?.projectId
    ) {
      moneyUnits = await deps.data.listUnits(state.focus.projectId).catch(() => []);
    }
    const offersDays =
      goal.kind === 'visit_ask' || goal.kind === 'propose_visit' || goal.kind === 'visit_propose';
    if (offersDays && siteHoursForTurn === undefined) {
      // A visit goal can be reached from discover, where the visit block never ran.
      siteHoursForTurn =
        (await deps.data.builder(state.builderId).catch(() => null))?.siteVisitHours ??
        DEFAULT_SITE_VISIT_HOURS;
    }
    packed = packWhatsAppInteractive({
      goal,
      state,
      catalogNames:
        evidence.matches?.length
          ? evidence.matches.map((m) => ({
              projectId: m.projectId,
              name: m.name,
              description: matchRowHint(m),
            }))
          : catalogForTurn?.projectNames ?? [],
      briefAreas: catalogForTurn?.microMarkets ?? [],
      singleProject: (catalogForTurn?.projectNames?.length ?? 0) <= 1,
      catalog: catalogForTurn,
      siteVisitHours: siteHoursForTurn,
      openDays: parseSiteVisitDays(siteHoursForTurn),
      nowMs: deps.clock.nowMs(),
      ...(moneyUnits?.length ? { focusUnits: moneyUnits } : {}),
      // The node menu is cut from the focused project's own record — only when
      // this turn's evidence actually fetched THAT project (an answer about a
      // compare target must not draw Eldorado's menu under Orchards' name).
      // This turn's fetched record when it IS the focus; else the cached card —
      // a pick or money turn deliberately fetches no overview, but the node
      // menu must still know what the project holds.
      ...(() => {
        const pid = state.focus?.projectId;
        // The commit block's resolved record wins — it is the record the card
        // spoke from, so the menu is gated on exactly what the reply said.
        const facts =
          commitDetail && pid && commitDetail.projectId === pid
            ? commitDetail
            : evidence.detail && pid && evidence.detail.projectId === pid
              ? evidence.detail
              : pid
                ? state.projectCache?.[pid]
                : undefined;
        return facts ? { focusFacts: facts } : {};
      })(),
      bookOpen: input.action_id === WA_MENU_PROJECTS || input.action_id === WA_MENU_SEE,
      // Which level of the file this turn is on — the tapped id is the whole
      // navigation state, so nothing has to be remembered between turns.
      ...(input.action_id ? { actionId: input.action_id } : {}),
    });
  }
  const packedActions = packed ? packedToSuggestedActions(packed) : undefined;

  return {
    reply,
    state,
    debug: debugOut,
    ...(evidence.compare?.matrix ? { compareMatrix: evidence.compare.matrix } : {}),
    ...(cappedRecovery ? { searchRecovery: cappedRecovery } : {}),
    uiMode,
    whatsappActions:
      packedActions ??
      whatsAppButtons(searchRecovery, channel) ??
      (channel === 'whatsapp' && evidence.nearbyOffer
        ? nearbyOfferSuggestedActions(evidence.nearbyOffer).slice(0, 2)
        : undefined),
    ...(packed && packed.kind !== 'text' ? { whatsappInteractive: packed } : {}),
    ...(mediaAttachments?.length ? { mediaAttachments } : {}),
  };
}

function matchRowHint(m: {
  startingPriceDisplay?: string;
  tradeoffNote?: string;
  dimensionFit?: ReadonlyArray<{ good: boolean; evidence: string; dimension: string }>;
  dimensionGap?: { label: string };
}): string {
  const goods = (m.dimensionFit ?? [])
    .filter((d) => d.good)
    .slice(0, 2)
    .map((d) => `✓ ${(d.evidence || d.dimension).trim()}`)
    .filter((s) => s.length > 2);
  const gap = m.dimensionGap?.label?.trim() ? `⚠ ${m.dimensionGap.label.trim()}` : '';
  const bits = [...goods, gap].filter(Boolean);
  if (bits.length) return bits.join(' · ');
  return (m.tradeoffNote || m.startingPriceDisplay || '').trim();
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
  return replyFingerprint(a) === replyFingerprint(b);
}

/** How many outbound lines back the repeat guard can see. */
const REPEAT_WINDOW = 8;

/**
 * Case- and whitespace-insensitive identity for an outbound line. Stored rather
 * than the line itself so the window costs bytes, not kilobytes, in a state
 * blob that rides every turn.
 */
export function replyFingerprint(reply: string): string {
  const norm = reply.toLowerCase().replace(/\s+/g, ' ').trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(36)}.${norm.length.toString(36)}`;
}

/** Times this exact line has already been sent in the recent window. */
function timesAlreadySent(reply: string, s: ConversationState): number {
  const fp = replyFingerprint(reply);
  return (s.recentReplies ?? []).filter((x) => x === fp).length;
}

function rememberReply(s: ConversationState, reply: string): string[] {
  return [replyFingerprint(reply), ...(s.recentReplies ?? [])].slice(0, REPEAT_WINDOW);
}

/**
 * Every path that SENDS has to leave the trace the next turn's guard reads.
 *
 * The repeat guard lived only on the main compose path, so the early returns —
 * sticky clarify, recovery probes — could send the same line four times without
 * ever registering that they had: "Let me put that plainly — we're on Brigade
 * Cornerstone… Which one?" at turns 7, 9, 10 and 13, with not even the adjacent
 * guard noticing, because those turns never wrote `lastReply` at all.
 */
function guardOutbound(
  s: ConversationState,
  reply: string,
): { reply: string; state: ConversationState } {
  const out =
    /\?$/.test(reply.trim()) && timesAlreadySent(reply, s) >= 2 ? breakRepeatLoop() : reply;
  return { reply: out, state: { ...s, lastReply: out, recentReplies: rememberReply(s, out) } };
}

/**
 * The line is the right one and cannot be paraphrased — deterministic facts and
 * commitment terms have to restate exactly — but the buyer already read it.
 * Keep the words, add the fact that we noticed.
 *
 * Question vs statement is the whole distinction: re-asking a question they just
 * failed to answer means the question is not landing, so hand control back;
 * repeating a fact they asked for twice is fine once it is labelled as a repeat.
 */
function acknowledgeRepeat(reply: string): string {
  const body = reply.trim();
  if (!body) return reply;
  return /\?$/.test(body)
    ? `${reply}\n\nIf that's not the right question, tell me in your own words what you're after and I'll take it from there.`
    : `Same as a moment ago — ${body.charAt(0).toLowerCase()}${body.slice(1)}`;
}

/**
 * Third identical send inside the window: the loop is ours, not theirs.
 *
 * L10 asked four straight questions about the agreement — litigation, delay
 * compensation, the penalty clause, whether the booking amount is refundable —
 * and got the same "price, legal papers, amenities, or a site visit — which
 * one?" menu at turns 7, 9, 10 and 13. Sending it a fourth time claims the menu
 * is an answer. Say what is actually happening and give two real exits.
 *
 * Deliberately only the THIRD send, and only for a question: a line repeated
 * twice is often legitimate (a cancel then a rebook re-asks for the day), and
 * a fact restated on request is not a loop.
 */
function breakRepeatLoop(): string {
  return (
    "That's the third time I've sent you the same line — I'm not understanding the question. " +
    'Put it in your own words and I\'ll answer it, or say *talk to someone* and I\'ll bring in the site team.'
  );
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
  skipBrief = false,
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
  // The same precedence, for the phrasings `wantsHuman` does not stamp. On a
  // builder-allotted book these were the majority of the handoff lane: "can
  // someone call me?", "call me tomorrow after 6pm", "connect me to your sales
  // manager". Below this line a focused turn read them as facts about the open
  // project ("I don't have that on file") and a callback time as a site-visit
  // slot to be negotiated down to 5 PM. Same catalog guard as above — a facet
  // ask that happens to contain "call me" is still a facet ask.
  if (skipBrief && text && !(s.focus && catalogAskOwns(ex, text))) {
    const handoffQ = asksForAHuman(text);
    if (handoffQ) return { kind: 'recommend', bookQuestion: handoffQ };
  }
  switch (s.phase) {
    case 'discover':
      return discover.decide(s, ex, text, skipBrief ? { skipBrief: true } : undefined);
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
  const skipBrief = deps.waProjectFirst === true && channel === 'whatsapp';
  if (ex.recallConstraints) return { kind: 'recall_constraints' };
  // Noise / smash — sticky clarify before ask_next_step / false brochure binds.
  // Ignore askTopics: embedder often nearest-neighbours get_brochure on smash.
  // When the hard brief is already filled, bare "ok" must advance — not re-probe.
  // Project-first WA: "hi" / "ok" must re-offer the book, not "couldn't make sense".
  //
  // …and so must every other channel. This is the THIRD copy of that gate, and
  // the only one the shipped turn actually reaches — fixing the two inside
  // discover left "hi" on advisor_web still answered with "I couldn't make
  // sense of that", because control never got that far. The good behaviour was
  // written once and then fenced behind `skipBrief`, exactly as bookLevelAnswer
  // was: the WhatsApp buyer got a greeting, the web buyer got told they were
  // unintelligible. isAttentionNudge is the existing knock/smash split — a
  // knock deserves an answer, smash deserves "I couldn't make sense of that".
  if (
    !skipBrief &&
    s.phase === 'discover' &&
    isNonPlaceUtterance(text) &&
    !isAttentionNudge(text) &&
    !discover.hasNarrowingConstraint(ex.constraints) &&
    !(ex.namedProjects?.length) &&
    ex.transition !== 'want_visit'
  ) {
    if (discover.hasNarrowingConstraint(s.constraints) && !discover.firstMissingSlot(s)) {
      return resolveAskNextStepGoal(s, channel);
    }
    return { kind: 'clarify_intent' };
  }
  // Minimal-brief trap: a pending size/budget step catches PURE turns (brief
  // answers, "ok", noise). A facet ask, name, visit or real question routes
  // normally — the step stays pending and re-offers on the next pure turn.
  const pendingWaBrief = skipBrief && s.phase !== 'focused' ? s.discover.waBriefStep : undefined;
  if (
    pendingWaBrief &&
    !ex.askTopic &&
    !(ex.askTopics?.length) &&
    !(ex.namedProjects?.length) &&
    ex.transition !== 'want_visit' &&
    ex.speechAct !== 'visit_book' &&
    !ex.objection &&
    !ex.recall &&
    !(ex.isQuestion && !ex.smalltalk)
  ) {
    return { kind: 'probe', slot: pendingWaBrief === 'size' ? 'bhk' : 'budget' };
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
  return decideGoal(s, ex, visitCtx, text, skipBrief);
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
  const rankFull = channel === 'advisor_web';
  if (rankFull) {
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
  const skipSearchForBag =
    deps.waProjectFirst === true &&
    channel === 'whatsapp' &&
    !discover.hasNarrowingConstraint(s.constraints) &&
    !discover.hasNarrowingConstraint(ex.constraints) &&
    !(ex.namedProjects?.length) &&
    !ex.forceRecommendList;
  if (skipSearchForBag) {
    return { goal: base, evidence: { tools: [], matches: [] } };
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
      // Desk is the authority on whether there is a PLACE here at all — the
      // question nothing asked before naming one back to the buyer. Ayana ·
      // "can i move in next month?" produced "I don't have homes in *next*";
      // Brigade Calista · "can i move in right away?" produced "*right*". A
      // town invented out of the buyer's own sentence.
      //
      // This is the SECOND of two copies of that decision in one fallback
      // chain — the locality-validation stage holds the other. Gating either
      // alone measures 6/11 phantoms, exactly the ungated number, because the
      // turn simply falls through to the copy that is still open. Both, 0/11.
      // Do not remove one because it "looks unreachable": that was measured.
      //
      // Serviceability is a different question and already has an answer —
      // "I don't have homes in *Pune*" is honest, and is verified to survive.
      if (!deskKnowsAsPlace(await deps.data.resolveGeo(loc).catch(() => null))) {
        // Drop it and answer the rest of the brief. The caller purges the
        // constraint from state on droppedLocation, so the phantom cannot
        // stick and steer the next search.
        if (out) out.droppedLocation = loc;
        const { locations: _phantomLoc, ...filtersSansPhantom } = filters;
        const rescued = await searchWithFilters(deps, s.builderId, filtersSansPhantom);
        if (rescued.matches.length) {
          return {
            goal:
              base.kind === 'recommend' || base.kind === 'ack_reject_recommend'
                ? base
                : { kind: 'recommend' },
            evidence: { tools: ['search'], matches: rawToMatches(rescued.matches) },
          };
        }
        // Nothing to show — decline without naming a place that does not exist.
        return { goal: { kind: 'no_fit' }, evidence: { tools: ['search'], failure } };
      }
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

  // Provisional locality — drop a captured "place" that is dialogue noise
  // ("boarding a flight", "next option") and re-search the rest of the brief,
  // so noise cannot steer the search or get echoed back as a town.
  //
  // `recognizedLocations` CANNOT decide that. It answers a different question:
  // Desk returns the subset of the asked locations we SERVE, so a real city we
  // do not cover comes back exactly like the word "next" — measured against
  // Desk dev, 17 Aug 2026:
  //
  //     Mumbai  → matches 0, recognized []        Pune  → matches 0, recognized []
  //     next    → matches 0, recognized []        Bengaluru → matches 3, recognized ['Bengaluru']
  //
  // So this gate fired on every out-of-area city and silently dropped it. The
  // deployed bot answered "2 BHK apartment in Mumbai under 1.5 Cr" with three
  // Devanahalli projects and never said the word Mumbai — and the comment 100
  // lines above, claiming "I don't have homes in *Pune*" survives, was false.
  //
  // Existence is `deskKnowsAsPlace`, which the phantom-drop already uses. Keep
  // the cheap conditions first — a served area never reaches the geo call.
  if (
    filters.locations &&
    strictSearch.matches.length === 0 &&
    strictSearch.recognizedLocations !== undefined &&
    strictSearch.recognizedLocations.length === 0 &&
    !deskKnowsAsPlace(await deps.data.resolveGeo(filters.locations).catch(() => null))
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
    // Desk expands the buyer's area into neighbouring localities and hands them
    // back as `expandedLocations`; filterSearchMatches (above) accepts a match on
    // ANY of them. That is good retrieval and a SILENT widening: the buyer's own
    // location is tried first, so a card that fails it and gets listed anyway
    // only got in on the expansion — and it was listed unmarked, so the reply
    // read as an exact-area fit. `area` is already a RelaxedDimension with copy
    // behind it ("I couldn't match that area tightly"); it was simply never set
    // on this path, which is the only path that can widen without an explicit
    // offer. The two sites that widen deliberately (findNearbyTypeOffer) already
    // declare it. Showing the wider list stays right; showing it silently is not.
    const askedArea = s.constraints.location?.trim();
    const listedOutsideAsked =
      !!askedArea &&
      listed.some(
        (m) =>
          !discover.matchMicroMarket(m.microMarket, askedArea) &&
          !discover.deskLocationIdentityHit(m, [askedArea]),
      );
    const relaxedOut: RelaxedDimension[] = listedOutsideAsked
      ? [...new Set<RelaxedDimension>([...padRelaxed, 'area'])]
      : padRelaxed;
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
      // Project-first WA never asks area/purpose — the book's brief is size
      // and budget only, so the same-set nudge may only probe those two.
      const missRaw = s.discover.advancedOnce ? undefined : discover.firstMissingSlot(s);
      const skipBriefHere = deps.waProjectFirst === true && channel === 'whatsapp';
      const miss =
        skipBriefHere && missRaw && missRaw !== 'bhk' && missRaw !== 'budget'
          ? undefined
          : missRaw;
      return {
        goal: { kind: 'advance', reason: 'same_set' },
        evidence: {
          tools: ['search'],
          matches: listed,
          ...(miss ? { nextSlot: miss } : {}),
          ...(relaxedOut.length ? { relaxed: relaxedOut } : {}),
          ...(nearbyOfferEv ?? {}),
        },
      };
    }
    return {
      goal: base,
      evidence: {
        tools: ['search'],
        matches: listed,
        ...(relaxedOut.length ? { relaxed: relaxedOut } : {}),
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
    // …but not on the way in. A buyer who has not seen a project yet cannot be
    // objecting to one, so a FIRST objection with no shortlist and no budget on
    // file is far more likely a misread turn than a real stall — "under 1.5 cr",
    // answering the budget probe, is stamped speechAct:'object' by the semantic
    // lane (hasPriceObjectionCue says false) and ended the conversation with
    // "I'll connect you with our sales team". Keep discovering; a real objection
    // survives to the next turn, when objectionCount is no longer 1.
    const earlyMisread =
      count <= 1 && !s.constraints.budgetMaxInr && currentShortlist(s).length === 0;
    if (earlyMisread) {
      return {
        goal: { kind: 'probe', slot: discover.firstMissingSlot(s) ?? 'budget' },
        evidence: { tools: ['catalog'] },
      };
    }
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
/**
 * The basis a money question may be worked on when the buyer did not restate
 * one this turn.
 *
 * "i can pay 55000 a month" was converted, spoken back — "about ₹63 L of loan,
 * roughly ₹79 L of home" — and then forgotten: four later turns in the same
 * conversation answered "I need a loan amount before I can work that out". The
 * number was ours. Recompute on it, and stamp where it came from, because a
 * figure carried forward silently is a figure the buyer cannot correct.
 */
function recalledEmiBasis(s: ConversationState):
  | {
      input: { principalInr: number } | { projectPriceInr: number };
      source: NonNullable<import('./types.js').EmiEvidence['basisSource']>;
    }
  | undefined {
  const a = s.affordability;
  if (a && a.loanInr > 0) {
    return {
      input: { principalInr: a.loanInr },
      source: { kind: 'buyer_monthly', monthlyInr: a.monthlyInr, fromIncome: a.fromIncome },
    };
  }
  const budget = s.constraints.budgetMaxInr;
  if (budget !== undefined && budget > 0) {
    return {
      input: { projectPriceInr: budget },
      source: { kind: 'buyer_budget', budgetInr: budget },
    };
  }
  return undefined;
}

function fetchEmiCalculation(ex: Extracted, s: ConversationState): EvidenceSet {
  const recalled = ex.emiPrincipalInr === undefined ? recalledEmiBasis(s) : undefined;
  const outcome = computeEmi({
    ...(ex.emiPrincipalInr !== undefined
      ? { principalInr: ex.emiPrincipalInr }
      : (recalled?.input ?? {})),
    ...(ex.emiRatePercent !== undefined ? { ratePercent: ex.emiRatePercent } : {}),
    ...(ex.emiTenureYears !== undefined ? { tenureYears: ex.emiTenureYears } : {}),
  });
  return outcome.ok
    ? {
        tools: ['emi'],
        emi: {
          ...outcome.value,
          discloseInputs: true,
          ...(recalled ? { basisSource: recalled.source } : {}),
        },
      }
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

/** Plain words for a fork branch — what the buyer would say back, and what it is. */
const FORK_LABELS: Record<string, readonly [word: string, label: string]> = {
  price: ['price', 'pricing'],
  emi: ['emi', 'loan eligibility'],
  availability: ['configs', 'the configurations'],
  legal: ['legal', 'the legal papers'],
  compare: ['compare', 'how it compares nearby'],
  amenities: ['amenities', 'the amenities'],
  location: ['location', 'the location'],
  media: ['brochure', 'the brochure'],
  visit: ['visit', 'a site visit'],
};

function forkTopicWord(topic: string): string {
  return FORK_LABELS[topic]?.[0] ?? topic.replace(/_/g, ' ');
}

function forkTopicPhrase(topic: string): string {
  return FORK_LABELS[topic]?.[1] ?? topic.replace(/_/g, ' ');
}

function forkTopicLabel(topic: string): string {
  const label = forkTopicPhrase(topic);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))];
}

function joinWith(xs: string[], conj: 'and' | 'or'): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} ${conj} ${xs[xs.length - 1]}`;
}

function failureAlternatives(
  failure: Failure,
  evidence: EvidenceSet,
): string[] {
  if (
    failure.subject === 'carpet_area' ||
    failure.subject === 'built_up_area'
  ) {
    // Name the bands. "The published configuration sizes" tells the buyer a
    // category exists; "2 BHK 1050-1180 sqft" is the thing they came for, minus
    // the basis we genuinely don't record.
    const bands = (evidence.units ?? [])
      .filter((u) => u.sizeDisplay)
      .map((u) => `${u.unitType} ${u.sizeDisplay}`);
    return [
      ...(bands.length ? [`the published sizes — ${bands.join(', ')}`] : []),
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
  /** The buyer said yes to an offer of the all-in cost — the words are "yes",
   *  but the ask is the cost sheet. */
  breakdownRequested?: boolean;
}): Promise<EvidenceSet> {
  const { deps, s, nd, projectId, unitType, focusName, buyerText } = args;
  let evidence: EvidenceSet = { tools: [] };
  const required = buyerText ? answerRequirements(buyerText) : [];
  const breakdownAsk =
    args.breakdownRequested === true || (buyerText ? wantsCostBreakdown(buyerText) : false);
  // The statutory add-ons live on the cost sheet, not the price sheet — so
  // "what about stamp duty and registration?" has to reach for the same
  // evidence "give me the full breakup" does, or it gets answered with the
  // headline price, which is not what was asked.
  const statutoryAsk = required.includes('stamp_duty');
  // A rate needs a size, and sizes live on the published configurations. So
  // does the honest answer to "carpet or super built-up?" — the book records
  // the bands but not which basis they are on, and naming the bands is the
  // difference between a shrug and a useful admission.
  const rateAsk = required.includes('price_per_sqft');
  const areaAsk = required.includes('carpet_area') || required.includes('built_up_area');
  let units: UnitConfig[] = [];
  // A pure breakdown ask with no size named still needs a unit — landed cost
  // is per-unit arithmetic, so fetch the configs and price the entry one.
  // Without this, "what's the all-in cost" could never reach the cost sheet.
  if (((statutoryAsk || breakdownAsk) && !unitType) || rateAsk || areaAsk) {
    units = await deps.data.listUnits(projectId).catch(() => []);
    if (areaAsk && units.length) {
      evidence = {
        ...evidence,
        units: units.map((u) => ({
          unitType: u.unitType,
          priceDisplay: u.priceDisplay,
          ...(u.sizeDisplay ? { sizeDisplay: u.sizeDisplay } : {}),
        })),
      };
    }
    if (rateAsk) {
      const rows = units
        .filter((u) => (u.sizeMinSqft ?? 0) > 0 && u.priceMinInr > 0)
        .map((u) => ({
          unitType: u.unitType,
          // Rounded to ₹10 — a rate carried to the rupee reads like a quote.
          rateInr: Math.round(u.priceMinInr / (u.sizeMinSqft as number) / 10) * 10,
        }))
        .filter((r) => r.rateInr > 0);
      if (rows.length) {
        evidence = { ...evidence, perSqft: { projectName: focusName, rows } };
      }
    }
  }
  // No config chosen yet — quote the entry one. `landedCostLine` names the unit
  // it priced, so the buyer always knows which home the charges belong to.
  const costUnit = unitType ?? units[0]?.unitType;
  if ((breakdownAsk || statutoryAsk) && costUnit) {
    const landedRes = await deps.data
      .landedCost(s.builderId, nd, projectId, costUnit)
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
  // No published basis for this project/size is not the end of the arithmetic —
  // the buyer may have already given us the only number this sum needs.
  const recalled = basis ? undefined : recalledEmiBasis(s);
  const outcome = computeEmi({
    ...(basis ? { projectPriceInr: basis.priceInr } : (recalled?.input ?? {})),
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
        ...(recalled ? { basisSource: recalled.source } : {}),
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
          breakdownRequested:
            Boolean(s.rti?.pendingPrompt?.breakdown) &&
            Boolean(buyerText && AFFIRM_ONLY.test(buyerText.trim())),
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
  if (goal.kind === 'orient' || goal.kind === 'greet') {
    const catalog = await deps.data.catalog(s.builderId).catch(() => emptyCatalog());
    return { tools: ['catalog'], catalog };
  }
  // Minimal-brief steps speak the live spread ("Homes here run ₹52L – ₹1.6 Cr")
  // and the packer cuts band rows from it — memoized per turn, so cheap.
  if (goal.kind === 'probe' && (goal.slot === 'bhk' || goal.slot === 'budget' || goal.slot === 'propertyType')) {
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
    compose?: ComposeTelemetry;
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
        ...(opts.compose ? { compose: opts.compose } : {}),
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
        // No buyerPhone. This was the one console.* in the turn path carrying a
        // raw E.164 number, ungated, on prod. `nd` is the NayaDesk conversation
        // id — it finds the same row and is not personal data by itself.
        console.error(
          '[syncTelemetry] postProfileObservations',
          nd,
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

/**
 * Read the focused project's cost heads off the Desk bundle and keep them on
 * focus state.
 *
 * Deliberately fire-and-forget in spirit: the bundle call is already made on
 * most turns and any failure just leaves `costTerms` unset, which drops cost-ask
 * detection back to the universal regex — the behaviour before this existed.
 * Never let a catalog read decide whether the buyer gets a reply.
 */
async function cacheCostTerms(
  state: ConversationState,
  deps: EngineDeps,
  nd: string,
  projectId: string,
  projectName: string,
): Promise<ConversationState> {
  const next = commitTo(state, projectId, projectName);
  const ctx = await deps.data.conversationContext(nd).catch(() => null);
  // Desk scopes the bundle to its own focus — never adopt another project's sheet.
  if (!ctx || ctx.project?.project_id !== projectId) return next;
  const costTerms = costTermsFromCostSheet(ctx.cost_sheet);
  if (!costTerms.length || !next.focus) return next;
  return { ...next, focus: { ...next.focus, costTerms } };
}
