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
import {
  buildBamlExtractInput,
  buildBamlShadowReport,
  looksLikeSearchBrief,
  mergeBamlGapFill,
  needsBamlGapFill,
  type BamlExtractMode,
  type BamlExtractResult,
} from './extract-baml.js';
import { extractFacts, isConstraintRefinementTurn, isCostComponentAsk, isDetailAskTurn, isLocationCorrectionTurn, locationLooksPolluted, looksLikeConfigAsk, looksLikeSearchBriefText } from './facts.js';
import { holdIntent } from './hold-intent.js';
import { hasNarrowingConstraint } from './phases/discover.js';
import { buyerCuedOtherProject } from './project_switch.js';
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
  /** P6 — optional ExtractTurnFacts caller (tests inject fakes). */
  bamlExtract?: (input: import('./extract-baml.js').BamlExtractInput) => Promise<BamlExtractResult | null>;
  bamlMode?: BamlExtractMode;
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
    const extracted = stampSpeechAct(seeded, chipResolution);
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
      ...state.discover.lastOffered.map((o) => o.name),
      ...(state.focus?.projectName ? [state.focus.projectName] : []),
    ],
    pendingOfferPricing: state.rti?.pendingPrompt?.kind === 'offer_pricing',
    hasPriorConstraints: Boolean(
      state.constraints.location ||
        state.constraints.propertyType ||
        state.constraints.budgetMaxInr ||
        state.constraints.bhk,
    ),
  });

  const mergedRaw = mergeExtractedAuthority(base, enriched);
  const topicsBeforeBridge = mergedRaw.askTopics ?? (mergedRaw.askTopic ? [mergedRaw.askTopic] : []);
  const withTopicBridge = bridgeUnknownConfigAsk(mergedRaw, text, chipResolution);
  let merged = stampSpeechAct(
    applySpeechActPermissions(withTopicBridge, chipResolution),
    chipResolution,
  );
  merged = scrubEmbedderIdentityNoise(text, state.phase, merged, [
    ...state.discover.lastOffered,
    ...(state.discover.discussedProjects ?? []),
    ...(state.focus ? [{ projectId: state.focus.projectId, name: state.focus.projectName }] : []),
  ]);
  // PIV-03: "change to 2BHK under 70L" must recommend, not clarify_project_pick.
  if (isConstraintRefinementTurn(text) && !merged.namedProjects?.length && !merged.pickName) {
    merged = { ...merged, speechAct: 'search' };
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

  // P6: typed ExtractTurnFacts after embedder abstain — shadow by default.
  const bamlMode = deps.bamlMode ?? 'off';
  if (bamlMode !== 'off' && needsBamlGapFill(merged, text, chipResolution) && deps.bamlExtract) {
    const proposal = await deps.bamlExtract(
      buildBamlExtractInput(text, state.phase, merged, state.focus?.projectName),
    ).catch(() => null);
    const report = buildBamlShadowReport(bamlMode, merged, proposal);
    provenance.baml = report;
    if (bamlMode === 'promote' && proposal?.confidence === 'llm') {
      const searchBrief = looksLikeSearchBrief(text);
      let promoted = stampSpeechAct(
        applySpeechActPermissions(mergeBamlGapFill(merged, proposal), chipResolution),
        chipResolution,
      );
      promoted = scrubEmbedderIdentityNoise(text, state.phase, promoted, [
        ...state.discover.lastOffered,
        ...(state.discover.discussedProjects ?? []),
        ...(state.focus ? [{ projectId: state.focus.projectId, name: state.focus.projectName }] : []),
      ]);
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
      return { extracted: ensurePriceTopicFloor(text, promoted), provenance, chipResolution };
    }
  }

  return { extracted: ensurePriceTopicFloor(text, merged), provenance, chipResolution };
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
  if (resolution.speechAct === 'stop' && !next.stop) {
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
 * W7 deterministic price-topic floor: an unambiguous cost-sheet ask (stamp
 * duty, registration charges, taxes) MUST carry the `price` topic even when the
 * promoted LLM extractor missed it — otherwise it falls to no_fit instead of
 * grounding on the pricing evidence. The LLM may ADD topics; it may not SUPPRESS
 * a deterministic cost ask. Runs on every extraction exit (promote + merge).
 */
function ensurePriceTopicFloor(text: string, ex: Extracted): Extracted {
  if (!isCostComponentAsk(text)) return ex;
  const topics = ex.askTopics ?? (ex.askTopic ? [ex.askTopic] : []);
  if (topics.includes('price')) return ex;
  return { ...ex, askTopics: [...topics, 'price'], askTopic: ex.askTopic ?? 'price' };
}

/**
 * Explicit precedence for free text:
 * - Clean regex locality wins over embedder.
 * - Polluted regex locality ("… under 1.5 Cr") yields to clean embedder.
 * - Detail asks never take embedder location.
 * Chip path never reaches this merge.
 */
export function mergeExtractedAuthority(base: Extracted, enriched: Extracted): Extracted {
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
  if (baseTopics.length === 0) {
    const enrichedTopics = enriched.askTopics ?? (enriched.askTopic ? [enriched.askTopic] : []);
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

  return merged;
}

/** Drop embedder namedProjects on focused pure-facet / location-correction turns. */
export function scrubEmbedderIdentityNoise(
  text: string,
  phase: ConversationState['phase'],
  extracted: Extracted,
  sessionPool?: ReadonlyArray<{ name: string }>,
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
  if (phase !== 'focused' && phase !== 'visit') return extracted;
  if (!isDetailAskTurn(extracted)) return extracted;
  // Keep identity only on structural cue or session-pool name — never a global catalog list.
  if (buyerCuedOtherProject(text, sessionPool)) return extracted;
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
  if (state.focus || state.discover.lastOffered.length > 0) return resolution;
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
