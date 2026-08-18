/**
 * Slice 1 + Slice 2 — single extraction authority.
 *
 * Orchestrates ingress funnel → regex (extractFacts) → embeddings (semantic.enrich) with explicit merge rules.
 * See docs/lld/SLICE-1_EXTRACT_AUTHORITY.md and docs/lld/SLICE-2_UNIFIED_EXTRACT_FUNNEL.md
 *
 * SA-0: chip-canonical speech act resolve stamps act/paths before enrich (permissions = SA-1).
 */
import type { SemanticNluPort } from './adapters/semantic-nlu.js';
import type { EngineLlm } from './ports.js';
import { currentShortlist, discussedList } from './entity-store.js';
import { applyWaInteractiveExtract } from '../channel/wa-pack.js';
import {
  applyIntentRecovery,
  needsIntentRecovery,
  type IntentRecoveryMode,
  type IntentRecoveryReport,
} from './intent-recovery.js';
import {
  buildBamlExtractInput,
  buildBamlShadowReport,
  looksLikeSearchBrief,
  mergeBamlGapFill,
  needsBamlGapFill,
  type BamlExtractMode,
  type BamlExtractResult,
} from './extract-baml.js';
import { applyPriceObjectionAuthority } from './price-objection.js';
import {
  extractFacts,
  extractLocation,
  isConstraintRefinementTurn,
  isDetailAskTurn,
  isLocationCorrectionTurn,
  locationLooksPolluted,
  looksLikeConfigAsk,
  looksLikeOfferedProjectName,
  looksLikeSearchBriefText,
  unionAskTopics,
} from './facts.js';
import { holdIntent } from './hold-intent.js';
import { isCostComponentAsk } from './facts.js';
import { hasNarrowingConstraint } from './phases/discover.js';
import { stampNamedAndUnbound } from './named_bind.js';
import {
  buyerCuedOtherProject,
  filterNamedProjectsByEvidence,
  nameEvidenceIn,
} from './project_switch.js';
import type {
  ExtractProvenance,
  FieldProvenance,
  IngressSlotKey,
  TurnInputSource,
} from './ingress.js';
import { hasTextOverride, isSlotWritable } from './ingress.js';
import {
  applySpeechActPermissions,
  classifySpeechAct,
  mayWriteSearchConstraints,
} from './speech-act/index.js';
import type { ChipResolution } from './speech-act/types.js';
import type { ConversationState, Extracted } from './types.js';

export interface ExtractTurnDeps {
  llm: EngineLlm;
  semantic: SemanticNluPort;
  microMarkets: readonly string[];
  /**
   * The builder's full catalog names. The precision floor needs them to know
   * which words actually pick out a project: a LONE embedder proposal has no
   * sibling in the call to reveal that its token is shared (see name-index.ts).
   * Already fetched for this turn — `catalog()` reads all 50 rows and used to
   * discard the names.
   */
  catalogNames?: ReadonlyArray<{ projectId?: string; name: string }>;
  /** P6 — optional ExtractTurnFacts caller (tests inject fakes). */
  bamlExtract?: (input: import('./extract-baml.js').BamlExtractInput) => Promise<BamlExtractResult | null>;
  bamlMode?: BamlExtractMode;
  /** Intent recovery after BAML/slot abstain. */
  intentRecover?: (input: {
    text: string;
    phase: string;
    focusName?: string;
  }) => Promise<import('./intent-recovery.js').IntentRecoveryResult | null>;
  intentRecoveryMode?: import('./intent-recovery.js').IntentRecoveryMode;
  failureTools?: boolean;
  /**
   * Multi-intent Phase A — when true, topic merges UNION into askTopics (cap 3)
   * instead of empty-only fill. Behind TOPIC_UNION; not behaviour-neutral.
   */
  topicUnion?: boolean;
  /** Defer shadow BAML / train off the sync path. */
  waitUntil?: (p: Promise<unknown>) => void;
}

export interface ExtractTurnOptions {
  inputSource: TurnInputSource;
  ingressFilledSlots?: ReadonlySet<IngressSlotKey>;
  /** Chip tap id when inputSource === 'chip'. */
  actionId?: string;
}

export interface ExtractTurnResult {
  extracted: Extracted;
  provenance: ExtractProvenance;
  chipResolution: ChipResolution;
}

/**
 * One entry for turn extraction — replaces separate extractFacts + enrich calls in turn.ts.
 */
export async function extractTurnAuthority(
  text: string,
  state: ConversationState,
  builderId: string,
  deps: ExtractTurnDeps,
  options: ExtractTurnOptions,
): Promise<ExtractTurnResult> {
  const filled = options.ingressFilledSlots ?? new Set<IngressSlotKey>();
  const override = hasTextOverride(text);
  let chipResolution = classifySpeechAct({
    text,
    actionId: options.actionId,
  });
  // Multi-act / soft-pref search brief: primary act is search.
  // visit_book or facet answer chips must not strip constraints or own the turn on an empty board.
  chipResolution = demoteNonSearchOnFreshSearch(text, state, chipResolution);

  if (options.inputSource === 'chip') {
    // SA-2: chip taps must get the same visit_book / visit_recall seeds as free text.
    const seeded = applyChipPathSeeds(
      await extractFacts(text, state, deps.llm, { inputSource: 'chip' }),
      chipResolution,
    );
    const extracted = applyWaInteractiveExtract(
      options.actionId,
      stampSpeechAct(seeded, chipResolution),
      deps.catalogNames ?? [],
    );
    return {
      extracted,
      provenance: {
        path: 'chip_skip',
        fields: { constraints: 'chip_skip', speechAct: 'chip_resolve' },
        speech_act: chipResolution.speechAct,
        chip_path_ids: chipResolution.chipPathIds,
      },
      chipResolution,
    };
  }

  const baseRaw = await extractFacts(text, state, deps.llm, {
    inputSource: 'free_text',
    ingressFilledSlots: filled,
    ...(deps.failureTools ? { failureTools: true } : {}),
  });
  const seeded = applyChipPathSeeds(baseRaw, chipResolution);
  const permitted = applySpeechActPermissions(seeded, chipResolution);
  const base = stampSpeechAct(permitted, chipResolution);

  const provenance: ExtractProvenance = {
    path: 'free_text_funnel',
    fields: {},
    speech_act: chipResolution.speechAct,
    chip_path_ids: chipResolution.chipPathIds,
  };

  annotateConstraintProvenance(base, filled, text, override, provenance.fields, 'regex');
  if (chipResolution.primary) {
    provenance.fields.speechAct = 'chip_resolve';
  }
  if (
    baseRaw.constraints.propertyType &&
    !base.constraints.propertyType &&
    !mayWriteSearchConstraints(chipResolution.speechAct)
  ) {
    provenance.fields.propertyType = 'ingress_blocked';
  }

  const enriched = await deps.semantic.enrich(text, builderId, base, {
    phase: state.phase,
    microMarkets: deps.microMarkets,
    offeredProjectNames: [
      ...currentShortlist(state).map((o) => o.name),
      ...(state.focus?.projectName ? [state.focus.projectName] : []),
    ],
    pendingOfferPricing: state.rti?.pendingPrompt?.kind === 'offer_pricing',
    hasPriorConstraints: Boolean(
      state.constraints.location ||
        state.constraints.propertyType ||
        state.constraints.budgetMaxInr ||
        state.constraints.bhk,
    ),
    // U8's lexical lane judges against the whole catalog, not the shortlist.
    catalogNames: deps.catalogNames,
  });

  const mergedRaw = mergeExtractedAuthority(base, enriched, {
    topicUnion: deps.topicUnion === true,
  });
  const topicsBeforeBridge = mergedRaw.askTopics ?? (mergedRaw.askTopic ? [mergedRaw.askTopic] : []);
  const withTopicBridge = bridgeUnknownConfigAsk(mergedRaw, text, chipResolution);
  let merged = stampSpeechAct(
    applySpeechActPermissions(withTopicBridge, chipResolution),
    chipResolution,
  );
  merged = scrubEmbedderIdentityNoise(text, state.phase, merged, [
    ...currentShortlist(state),
    ...discussedList(state),
    ...(state.focus ? [{ projectId: state.focus.projectId, name: state.focus.projectName }] : []),
  ], deps.catalogNames ?? []);
  // PR-2-lite: bind compare name spans against session ∪ catalog; stamp unbound.
  const sessionForBind = [
    ...currentShortlist(state),
    ...discussedList(state),
    ...(state.focus
      ? [{ projectId: state.focus.projectId, name: state.focus.projectName }]
      : []),
  ];
  const catalogForBind = (deps.catalogNames ?? [])
    .filter((p): p is { projectId: string; name: string } => Boolean(p.projectId && p.name))
    .map((p) => ({ projectId: p.projectId!, name: p.name }));
  merged = stampNamedAndUnbound(text, merged, {
    session: sessionForBind,
    catalog: catalogForBind,
  });
  // PIV-03: "change to 2BHK under 70L" must recommend, not clarify_project_pick.
  if (isConstraintRefinementTurn(text) && !merged.namedProjects?.length && !merged.pickName) {
    merged = { ...merged, speechAct: 'search' };
  }
  merged = applyWaInteractiveExtract(options.actionId, merged, deps.catalogNames ?? []);
  // Area pivot: "What about Sarjapur?" / "Sarjapur area?" must not stay answer/overview.
  // SA-4 overview chip + permissions wipe location → stuck clarify_project_pick on the board.
  {
    const offeredHints = [
      ...currentShortlist(state).map((o) => o.name),
      ...discussedList(state).map((o) => o.name),
      ...(state.focus?.projectName ? [state.focus.projectName] : []),
    ];
    const pivotLoc =
      extractLocation(text, {
        projectNameHints: offeredHints,
        askTopics: [],
      }) ??
      (merged.constraints.location &&
      !looksLikeOfferedProjectName(merged.constraints.location, offeredHints)
        ? merged.constraints.location
        : undefined);
    const looksLikeAreaPivot =
      Boolean(pivotLoc) &&
      !looksLikeOfferedProjectName(pivotLoc!, offeredHints) &&
      (/\bwhat about\b/i.test(text) ||
        /\barea\s*\??\s*$/i.test(text.trim()) ||
        /\b(?:any|apartments?|homes?|projects?|options?)\b.+\b(?:in|near|around)\b/i.test(text));
    if (
      looksLikeAreaPivot &&
      pivotLoc &&
      !merged.namedProjects?.length &&
      !merged.pickName &&
      (merged.speechAct === 'answer' ||
        merged.transition === 'want_details' ||
        merged.implicitProjectPick ||
        merged.speechAct === 'unknown' ||
        !merged.speechAct)
    ) {
      merged = {
        ...merged,
        speechAct: 'search',
        constraints: { ...merged.constraints, location: pivotLoc },
        askTopic: undefined,
        askTopics: undefined,
        transition: undefined,
        implicitProjectPick: false,
      };
      provenance.fields.speechAct = 'regex';
      provenance.fields.location = provenance.fields.location ?? 'regex';
    }
  }
  // Phase 4: deterministic hold-intent gate ("hold/reserve a 2 bhk") — closed
  // set, regex-only, so turn logs show exactly why the hold sub-flow fired.
  if (holdIntent(text)) {
    merged = { ...merged, holdAsk: true };
    provenance.fields.holdAsk = 'regex';
  }

  if (merged.askTopics?.length && !baseRaw.askTopics?.length) {
    const bridgedIn =
      topicsBeforeBridge.length === 0 &&
      (withTopicBridge.askTopics?.length ?? 0) > 0;
    provenance.fields.askTopics = bridgedIn
      ? 'bridge'
      : chipResolution.primary?.topic && merged.askTopics.includes(chipResolution.primary.topic)
        ? 'chip_resolve'
        : 'embedder';
  }
  if (
    merged.constraints.location &&
    !base.constraints.location &&
    !isDetailAskTurn(merged)
  ) {
    provenance.fields.location = 'embedder';
  }
  if (merged.namedProjects?.length && !base.namedProjects?.length) {
    provenance.fields.namedProjects = 'embedder';
  }

  // Intent-before-slots: evaluative price cues beat topic fills (BAML/embed).
  {
    const before = merged;
    merged = applyPriceObjectionAuthority(merged, text);
    if (merged.objection && !before.objection) {
      provenance.fields.objection = 'regex';
      provenance.fields.speechAct = provenance.fields.speechAct ?? 'chip_resolve';
    }
  }

  // P6: typed ExtractTurnFacts after embedder abstain — shadow by default.
  // Skip promote when objection already latched (slots must not override intent).
  const bamlMode = deps.bamlMode ?? 'off';
  if (
    bamlMode !== 'off' &&
    !merged.objection &&
    needsBamlGapFill(merged, text, chipResolution) &&
    deps.bamlExtract
  ) {
    // Hybrid dig: shadow BAML must not block the buyer (DeepSeek RTT).
    if (bamlMode === 'shadow') {
      const runShadow = async () => {
        const proposal = await deps.bamlExtract!(
          buildBamlExtractInput(text, state.phase, merged, state.focus?.projectName),
        ).catch(() => null);
        provenance.baml = buildBamlShadowReport(bamlMode, merged, proposal);
      };
      if (deps.waitUntil) deps.waitUntil(runShadow());
      else await runShadow();
    } else {
      const proposal = await deps.bamlExtract(
        buildBamlExtractInput(text, state.phase, merged, state.focus?.projectName),
      ).catch(() => null);
      const report = buildBamlShadowReport(bamlMode, merged, proposal);
      provenance.baml = report;
      if (bamlMode === 'promote' && proposal?.confidence === 'llm') {
        const searchBrief = looksLikeSearchBrief(text);
        let promoted = stampSpeechAct(
          applySpeechActPermissions(
            mergeBamlGapFill(merged, proposal, { topicUnion: deps.topicUnion === true }),
            chipResolution,
          ),
          chipResolution,
        );
        promoted = scrubEmbedderIdentityNoise(text, state.phase, promoted, [
          ...currentShortlist(state),
          ...discussedList(state),
          ...(state.focus ? [{ projectId: state.focus.projectId, name: state.focus.projectName }] : []),
        ], deps.catalogNames ?? []);
        if (isConstraintRefinementTurn(text) && !promoted.namedProjects?.length && !promoted.pickName) {
          promoted = { ...promoted, speechAct: 'search' };
        }
        // Location correction: prefer regex/extracted location over BAML inventing a project.
        if (isLocationCorrectionTurn(text) && merged.constraints.location) {
          promoted = {
            ...promoted,
            constraints: { ...promoted.constraints, location: merged.constraints.location },
          };
        }
        for (const field of report.would_fill) {
          provenance.fields[field] = 'baml';
        }
        // Free-text promote may overwrite disagreed locality (polluted regex → BAML).
        if (
          proposal.location &&
          promoted.constraints.location?.toLowerCase() === proposal.location.toLowerCase() &&
          merged.constraints.location?.toLowerCase() !== proposal.location.toLowerCase()
        ) {
          provenance.fields.location = 'baml';
        }
        // P2: search briefs are search acts so discover recommends (not facet clarify).
        if (searchBrief && (promoted.speechAct === 'unknown' || !promoted.speechAct)) {
          promoted = { ...promoted, speechAct: 'search' };
          provenance.fields.speechAct = 'baml';
        }
        // Intent-before-slots after BAML merge (mehengaa / bit expensive ≠ price FAQ).
        promoted = applyPriceObjectionAuthority(promoted, text);
        if (promoted.objection) {
          provenance.fields.objection = provenance.fields.objection ?? 'regex';
        }
        return {
          extracted: ensurePriceTopicFloor(text, promoted, provenance, state.focus?.costTerms),
          provenance,
          chipResolution,
        };
      }
    }
  }

  // Intent recovery — paid closed-label pass when slots/topics still empty.
  const recoveryMode: IntentRecoveryMode = deps.intentRecoveryMode ?? 'off';
  if (
    recoveryMode !== 'off' &&
    deps.intentRecover &&
    needsIntentRecovery(merged, text)
  ) {
    const proposal = await deps
      .intentRecover({
        text,
        phase: state.phase,
        ...(state.focus?.projectName ? { focusName: state.focus.projectName } : {}),
      })
      .catch(() => null);
    const report: IntentRecoveryReport = {
      mode: recoveryMode,
      called: true,
      labels: proposal?.labels ?? [],
      confidence: proposal?.confidence ?? 'abstain',
      ...(proposal?.abstainReason ? { abstain_reason: proposal.abstainReason } : {}),
      train_eligible: true,
    };
    provenance.intent_recovery = report;
    provenance.train_eligible = true;
    provenance.train_sources = [...(provenance.train_sources ?? []), 'intent_recovery'];
    provenance.train_proposal = {
      text: text.slice(0, 240),
      labels: report.labels,
      confidence: report.confidence,
      phase: state.phase,
    };
    if (recoveryMode === 'promote' && proposal?.confidence === 'llm' && proposal.labels.length) {
      const recovered = applyIntentRecovery(merged, proposal);
      for (const label of proposal.labels) {
        provenance.fields[`recovery:${label}`] = 'llm';
      }
      return {
        extracted: ensurePriceTopicFloor(text, recovered, provenance, state.focus?.costTerms),
        provenance,
        chipResolution,
      };
    }
  }

  // BAML call (even abstain) is train-eligible — human review of gap-fill.
  if (provenance.baml?.called) {
    provenance.train_eligible = true;
    provenance.train_sources = [...new Set([...(provenance.train_sources ?? []), 'baml' as const])];
    if (!provenance.train_proposal) {
      provenance.train_proposal = {
        text: text.slice(0, 240),
        baml: provenance.baml,
        phase: state.phase,
      };
    }
  }

  return {
    extracted: ensurePriceTopicFloor(text, merged, provenance, state.focus?.costTerms),
    provenance,
    chipResolution,
  };
}

/** Seed act-local flags/topics from resolved chip path when extract left them empty. */
export function applyChipPathSeeds(extracted: Extracted, resolution: ChipResolution): Extracted {
  if (!resolution.primary) return extracted;
  let next = { ...extracted };

  const topic = resolution.primary.topic;
  const existing = next.askTopics ?? (next.askTopic ? [next.askTopic] : []);
  if (topic && existing.length === 0) {
    next = { ...next, askTopic: topic, askTopics: [topic] };
  }

  if (resolution.speechAct === 'visit_recall' && !next.recall) {
    next = { ...next, recall: true };
  }
  // Chip path wins: visit_book must not keep legacy "the visit" → recall flag
  if (resolution.speechAct === 'visit_book' && next.recall) {
    const { recall: _drop, ...rest } = next;
    next = { ...rest, transition: rest.transition === 'none' ? 'want_visit' : rest.transition };
  } else if (resolution.speechAct === 'visit_book' && next.transition === 'none') {
    next = { ...next, transition: 'want_visit' };
  }
  // Destructive-signal authority: only an actual Stop button tap may add stop —
  // free-text opt-out detection belongs solely to STOP_RE in facts.ts.
  if (
    resolution.speechAct === 'stop' &&
    !next.stop &&
    resolution.primary?.source === 'action_id'
  ) {
    next = { ...next, stop: true };
  }
  if (resolution.speechAct === 'greet' && !next.smalltalk) {
    next = { ...next, smalltalk: true };
  }
  if (resolution.speechAct === 'object' && !next.objection) {
    next = { ...next, objection: true };
  }
  // Secondary object (Legal + issues) must NOT flip primary answer into objection goal
  if (resolution.secondary?.act === 'object' && resolution.primary.act === 'answer') {
    // keep objection flag for playbook hint only when primary is already object — strip for answer
    if (next.objection) {
      const { objection: _o, objectionTopic: _t, ...rest } = next;
      next = rest;
    }
  }

  return next;
}

export function stampSpeechAct(extracted: Extracted, resolution: ChipResolution): Extracted {
  return {
    ...extracted,
    speechAct: resolution.speechAct,
    ...(resolution.chipPathIds.length ? { chipPathIds: resolution.chipPathIds } : {}),
  };
}

/**
 * Chip miss + shortlist/project identity already known + config lexicon →
 * seed availability. INTENT_VECTORS often returns find_projects for
 * "options for 2BHK in Eldorado"; this is a narrow bridge, not free-text
 * chip sprawl. Novel asks without a named shortlist project still rely on embedder.
 */
export function bridgeUnknownConfigAsk(
  extracted: Extracted,
  text: string,
  resolution: ChipResolution,
): Extracted {
  if (resolution.primary) return extracted;
  const existing = extracted.askTopics ?? (extracted.askTopic ? [extracted.askTopic] : []);
  if (existing.length) return extracted;
  if (!(extracted.namedProjects?.length || extracted.pickName)) return extracted;
  if (!looksLikeConfigAsk(text)) return extracted;
  return {
    ...extracted,
    askTopic: 'availability',
    askTopics: ['availability'],
  };
}

function annotateConstraintProvenance(
  extracted: Extracted,
  filled: ReadonlySet<IngressSlotKey>,
  text: string,
  override: boolean,
  fields: ExtractProvenance['fields'],
  source: FieldProvenance,
): void {
  const constraints = extracted.constraints;
  if (constraints.location) {
    fields.location = override && filled.has('location') ? 'override' : source;
  } else if (filled.has('location') && !isSlotWritable('location', filled, text)) {
    fields.location = 'ingress_blocked';
  }
  if (constraints.bhk) {
    fields.bhk = override && filled.has('bhk') ? 'override' : source;
  } else if (filled.has('bhk') && !isSlotWritable('bhk', filled, text)) {
    fields.bhk = 'ingress_blocked';
  }
  if (constraints.budgetMaxInr !== undefined || constraints.budgetMinInr !== undefined) {
    fields.budget = override && filled.has('budget') ? 'override' : source;
  } else if (filled.has('budget') && !isSlotWritable('budget', filled, text)) {
    fields.budget = 'ingress_blocked';
  }
  if (constraints.propertyType) {
    fields.propertyType = override && filled.has('propertyType') ? 'override' : source;
  } else if (filled.has('propertyType') && !isSlotWritable('propertyType', filled, text)) {
    fields.propertyType = 'ingress_blocked';
  }
  if (constraints.purpose) {
    fields.purpose = override && filled.has('purpose') ? 'override' : source;
  } else if (filled.has('purpose') && !isSlotWritable('purpose', filled, text)) {
    fields.purpose = 'ingress_blocked';
  }
  const topics = extracted.askTopics ?? (extracted.askTopic ? [extracted.askTopic] : []);
  if (topics.length) {
    fields.askTopics = source;
  }
}

/**
 * Explicit precedence for free text:
 * - Clean regex locality wins over embedder.
 * - Polluted regex locality ("… under 1.5 Cr") yields to clean embedder.
 * - Detail asks never take embedder location.
 * Chip path never reaches this merge.
 */
export function mergeExtractedAuthority(
  base: Extracted,
  enriched: Extracted,
  opts?: { topicUnion?: boolean },
): Extracted {
  const merged: Extracted = {
    ...base,
    constraints: { ...base.constraints },
  };

  // Drop polluted regex location so gap-fill / BAML can own free-text locality.
  if (locationLooksPolluted(merged.constraints.location)) {
    const { location: _drop, ...rest } = merged.constraints;
    merged.constraints = rest;
  }

  const baseTopics = base.askTopics ?? (base.askTopic ? [base.askTopic] : []);
  const enrichedTopics = enriched.askTopics ?? (enriched.askTopic ? [enriched.askTopic] : []);
  if (opts?.topicUnion) {
    const united = unionAskTopics(baseTopics, enrichedTopics);
    if (united.length) {
      merged.askTopics = united;
      merged.askTopic = united[0];
    }
  } else if (baseTopics.length === 0) {
    // Legacy empty-only: once regex found any topic, enriched cannot add another.
    if (enrichedTopics.length > 0) {
      merged.askTopics = enrichedTopics;
      merged.askTopic = enriched.askTopic ?? enrichedTopics[0];
    } else if (enriched.askTopic) {
      merged.askTopic = enriched.askTopic;
      merged.askTopics = [enriched.askTopic];
    }
  }

  const detailAsk = isDetailAskTurn(merged);
  const enrichLoc = enriched.constraints.location;
  const enrichLocClean = enrichLoc && !locationLooksPolluted(enrichLoc) ? enrichLoc : undefined;
  const mayFillLocation = !detailAsk && baseTopics.length === 0 && enrichLocClean;
  if (mayFillLocation && !merged.constraints.location) {
    merged.constraints = {
      ...merged.constraints,
      location: enrichLocClean,
    };
  }

  if (enriched.namedProjects?.length) {
    merged.namedProjects = enriched.namedProjects;
  }

  // `merged` spreads `base`, so anything the enrich step stamped is dropped
  // unless it is carried here by name. The U8 shadow is stamped in enrich and
  // read in ledger-write; without this line it would be computed on every turn,
  // pass its own unit tests, and reach the ledger on none of them.
  if (enriched.identityShadow) {
    merged.identityShadow = enriched.identityShadow;
  }

  return merged;
}

/** Drop embedder namedProjects on focused pure-facet / location-correction turns. */
export function scrubEmbedderIdentityNoise(
  text: string,
  phase: ConversationState['phase'],
  extracted: Extracted,
  sessionPool?: ReadonlyArray<{ name: string }>,
  catalogNames: ReadonlyArray<{ projectId?: string; name: string }> = [],
): Extracted {
  if (isLocationCorrectionTurn(text)) {
    if (!extracted.namedProjects?.length) return extracted;
    const { namedProjects: _drop, ...rest } = extracted;
    return rest;
  }
  // Fresh search brief on empty session pool: PROJECT_VECTORS names are not a shortlist.
  if (
    phase === 'discover' &&
    looksLikeSearchBriefText(text) &&
    hasNarrowingConstraint(extracted.constraints) &&
    extracted.namedProjects?.length &&
    !(sessionPool?.length)
  ) {
    const { namedProjects: _n, pickName: _p, ...rest } = extracted;
    return rest;
  }
  // Focused/visit "I want to visit" — keep focus; drop off-pool embedder invent.
  if (
    (phase === 'focused' || phase === 'visit') &&
    (extracted.speechAct === 'visit_book' || extracted.transition === 'want_visit') &&
    extracted.namedProjects?.length &&
    !buyerCuedOtherProject(text, sessionPool)
  ) {
    const { namedProjects: _n, pickName: _p, ...rest } = extracted;
    return rest;
  }
  // Precision floor, every phase: proposed identity survives only when the buyer's
  // text names it; split evidence resolves toward the session pool (the buyer's own
  // board), never a same-brand sibling from the global catalog. Kills state-dependent
  // focus steals ("take home 85k" → Century Breeze) at the producer so every consumer
  // (discover / focused / visit / compare) inherits the guarantee.
  if (extracted.namedProjects?.length) {
    const filtered = filterNamedProjectsByEvidence(
      text,
      extracted.namedProjects,
      (sessionPool ?? []) as ReadonlyArray<{ projectId?: string; name: string }>,
      catalogNames,
    );
    if (!filtered.length) {
      const { namedProjects: _n, ...rest } = extracted;
      extracted = rest;
    } else {
      extracted = { ...extracted, namedProjects: filtered };
    }
  }
  if (phase !== 'focused' && phase !== 'visit') return extracted;
  if (!isDetailAskTurn(extracted)) return extracted;
  // Keep identity on structural cue, session-pool name, or a fully-typed project name
  // (the floor above already vetoed anything the buyer didn't actually write).
  if (buyerCuedOtherProject(text, sessionPool)) return extracted;
  if (
    extracted.namedProjects?.some(
      (p) => nameEvidenceIn(text, p.name, [...catalogNames, ...(sessionPool ?? [])]) === 'full',
    )
  ) {
    return extracted;
  }
  if (!extracted.namedProjects?.length && !extracted.pickName) return extracted;
  const { namedProjects: _n, pickName: _p, ...rest } = extracted;
  return rest;
}

/**
 * Search brief on empty board → primary act is search.
 * visit_book and facet answer chips (e.g. "nearby" → location) must not strip
 * constraints or own goal routing.
 */
export function demoteNonSearchOnFreshSearch(
  text: string,
  state: ConversationState,
  resolution: ChipResolution,
): ChipResolution {
  if (state.focus || currentShortlist(state).length > 0) return resolution;
  if (!looksLikeSearchBriefText(text)) return resolution;
  if (resolution.speechAct === 'visit_book') {
    return { primary: null, secondary: null, speechAct: 'search', chipPathIds: [] };
  }
  if (resolution.speechAct === 'answer' && resolution.primary?.topic) {
    return { primary: null, secondary: null, speechAct: 'search', chipPathIds: [] };
  }
  return resolution;
}

/** @deprecated use demoteNonSearchOnFreshSearch */
export function demoteVisitBookOnFreshSearch(
  text: string,
  state: ConversationState,
  resolution: ChipResolution,
): ChipResolution {
  return demoteNonSearchOnFreshSearch(text, state, resolution);
}

/**
 * A cost-component ask must carry the `price` topic, or it grounds on nothing.
 *
 * When the match came from the focused project's Desk cost terms — "floor rise",
 * "BESCOM charges" — neither the regex topic table nor the LLM has any way to
 * know those words name a price. Without this floor the turn reaches routing
 * with no topic and falls to no_fit, which is W7: the buyer asked about money
 * and got a shrug. Additive only; an ask that already resolved a topic keeps it
 * and merely gains `price` alongside.
 */
function ensurePriceTopicFloor(
  text: string,
  ex: Extracted,
  provenance: ExtractProvenance,
  terms: readonly string[] | undefined,
): Extracted {
  if (!isCostComponentAsk(text, terms)) return ex;
  const topics = ex.askTopics ?? (ex.askTopic ? [ex.askTopic] : []);
  if (topics.includes('price')) return ex;
  provenance.fields.askTopics = 'regex';
  return { ...ex, askTopics: [...topics, 'price'], askTopic: ex.askTopic ?? 'price' };
}
