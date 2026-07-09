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
import { extractFacts, isDetailAskTurn, looksLikeConfigAsk } from './facts.js';
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
  const chipResolution = classifySpeechAct({
    text,
    actionId: options.actionId,
  });

  if (options.inputSource === 'chip') {
    const extracted = stampSpeechAct(
      await extractFacts(text, state, deps.llm, { inputSource: 'chip' }),
      chipResolution,
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
  });

  const mergedRaw = mergeExtractedAuthority(base, enriched);
  const topicsBeforeBridge = mergedRaw.askTopics ?? (mergedRaw.askTopic ? [mergedRaw.askTopic] : []);
  const withTopicBridge = bridgeUnknownConfigAsk(mergedRaw, text, chipResolution);
  const merged = stampSpeechAct(
    applySpeechActPermissions(withTopicBridge, chipResolution),
    chipResolution,
  );

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

  return { extracted: merged, provenance, chipResolution };
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

/** Explicit precedence — regex base wins per field; enrich is gap-fill only. */
export function mergeExtractedAuthority(base: Extracted, enriched: Extracted): Extracted {
  const merged: Extracted = {
    ...base,
    constraints: { ...base.constraints },
  };

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
  const mayFillLocation =
    !merged.constraints.location && !detailAsk && baseTopics.length === 0;
  if (mayFillLocation && enriched.constraints.location) {
    merged.constraints = {
      ...merged.constraints,
      location: enriched.constraints.location,
    };
  }

  if (enriched.namedProjects?.length) {
    merged.namedProjects = enriched.namedProjects;
  }

  return merged;
}
