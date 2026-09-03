/**
 * P2a / SA-5 — map end-of-turn engine state → NayaDesk turn_ledger columns.
 * P2c adds disclosed_facts from structured evidence.
 */
import type { ExtractProvenance } from '../engine/ingress.js';
import { buildChipShadow } from '../chips/shadow.js';
import { extractDisclosedFacts, type DisclosedFact } from './disclosed-facts.js';
import { summarizeFailure, type Failure } from './outcome.js';
import { answerRequirements, deliveredFactKeys } from './answer-contract.js';
import { currentShortlist, focusedRef } from './entity-store.js';
import { detectFocusedSwitchIntent } from './project_switch.js';
import type {
  ThreadState,
  EvidenceSet,
  Extracted,
  TurnGoal,
} from '../engine/types.js';

/**
 * What the compose lane cost this turn, and which path it took.
 *
 * Every one of these numbers is already computed on the main path and put in
 * the HTTP debug response — and then dropped when the response returns. Nothing
 * durable has ever recorded whether a reply was written by the paid model or by
 * a voice template, so "is the paid composer worth it?" has no production
 * answer: `llm_used` and `compose_template` are declared in engine types and
 * appear in zero ledger rows, the same shape `routing_bind` had before P0a.
 *
 * `shed` is the one that only a ledger can show: the paid call was made and
 * then abandoned (timeout or rate cap) and a template shipped anyway. That is
 * money spent for a templated reply, and it is invisible per-turn.
 */
export interface ComposeTelemetry {
  /** Sync paid model actually wrote this reply. */
  llm_used: boolean;
  /** Paid call timed out or was rate-capped → template shipped instead. */
  llm_shed?: boolean;
  /** Compose path used a voice template, not the LLM. */
  template?: boolean;
  compose_ms?: number;
  total_ms?: number;
  /** Workers AI calls this turn — embedding is priced per call. */
  embed_calls?: number;
  embed_ms?: number;
}

export interface LedgerWritePayload {
  snapshot_in: Record<string, unknown>;
  resolved_intent: Record<string, unknown>;
  action_plan: Record<string, unknown>;
  offered_project_ids: string[];
  disclosed_facts: DisclosedFact[];
  tool_runs: Array<{
    name: string;
    args_summary: string;
    produced_evidence: boolean;
    latency_ms: number;
    /** Phase 0b — set when the port returned !ok. */
    failure_reason?: 'absent' | 'transport';
  }>;
  verify: Record<string, unknown>;
  composer: string;
}

/**
 * Did this tool actually put something in the evidence set?
 *
 * Every Desk adapter is `catch { return null }`, so the tool name stays in
 * `evidence.tools` whether or not the call yielded anything. Comparing the
 * name against the slot it fills is the only honest signal available before
 * the ports return discriminated results (Phase 0b).
 */
function toolProducedEvidence(name: string, ev: EvidenceSet): boolean {
  switch (name) {
    case 'pricing': return Boolean(ev.pricing?.components?.length);
    case 'landedCost': return Boolean(ev.landedCost);
    case 'compare': return Boolean(ev.compare?.tableText || ev.compare?.matrix);
    case 'detail': return Boolean(ev.detail);
    case 'listUnits': return Boolean(ev.units?.length);
    case 'mediaShare': return Boolean(ev.media);
    case 'search': return Boolean(ev.matches?.length);
    case 'lastOffered': return Boolean(ev.matches?.length);
    case 'educationSearch': return Boolean(ev.education);
    case 'faqLookup': return Boolean(ev.detail?.faqs?.length) && !ev.faqMiss;
    case 'faqMiss': return false;
    case 'catalog': return Boolean(ev.catalog?.total);
    case 'geoAreasInRegion': return Boolean(ev.noMatch?.nearby?.length);
    default: return true;
  }
}

export function buildLedgerWritePayload(input: {
  state: ThreadState;
  ex: Extracted;
  goal: TurnGoal;
  evidence: EvidenceSet;
  inputSource?: string;
  extractProvenance?: ExtractProvenance;
  grounding?: string;
  failures?: readonly Failure[];
  /** Buyer text for over-answer telemetry (asked vs delivered). */
  buyerText?: string;
  /** Compose-path cost + which lane wrote the reply. */
  compose?: ComposeTelemetry;
}): LedgerWritePayload {
  const {
    state,
    ex,
    goal,
    evidence,
    inputSource,
    extractProvenance,
    grounding,
    failures,
    buyerText,
    compose,
  } = input;

  const snapshot_in: Record<string, unknown> = {
    phase: state.phase,
    ...(() => {
      const f = focusedRef(state);
      return f ? { focus: { project_id: f.projectId, name: f.projectName } } : {};
    })(),
    constraints: { ...state.constraints },
    shortlist: currentShortlist(state).map((o) => ({
      project_id: o.projectId,
      name: o.name,
    })),
    ...(state.rti?.pendingPrompt ? { pending_prompt: state.rti.pendingPrompt } : {}),
    ...(inputSource ? { input_source: inputSource } : {}),
  };

  // Phase 0a — promote turn-log-snapshot fields into the deployed ledger row
  // (named_projects as id:name, switch_intent, full extract_provenance).
  const switchIntent =
    buyerText && state.phase === 'focused'
      ? detectFocusedSwitchIntent(buyerText, ex, state)
      : null;

  const resolved_intent: Record<string, unknown> = {
    ...(ex.speechAct ? { speech_act: ex.speechAct } : {}),
    ...(ex.chipPathIds?.length ? { chip_path_ids: ex.chipPathIds } : {}),
    ...(ex.askTopics?.length
      ? { ask_topics: ex.askTopics }
      : ex.askTopic
        ? { ask_topics: [ex.askTopic] }
        : {}),
    ...(ex.transition && ex.transition !== 'none' ? { transition: ex.transition } : {}),
    ...(Object.keys(ex.constraints).length ? { constraints: { ...ex.constraints } } : {}),
    ...(ex.namedProjects?.length
      ? {
          named_projects: ex.namedProjects.map((p) => `${p.projectId}:${p.name}`),
        }
      : {}),
    ...(switchIntent ? { switch_intent: switchIntent } : {}),
    // SHADOW ONLY (U8) — what a lexical+dense fusion would have resolved, and
    // by what margin. Nothing branches on it. It rides on resolved_intent
    // because it is a claim about WHICH PROJECT the buyer named, so a reader
    // comparing the shadow to what shipped needs one column, not a join:
    // `named_projects` above is the truth this is scored against.
    ...(ex.identityShadow
      ? {
          identity_shadow: {
            ...ex.identityShadow,
            // Read off the same `ex` as `named_projects` above, one field up,
            // so the shadow is scored against what bound and not what was
            // proposed three layers earlier.
            shipped: (ex.namedProjects ?? []).map((p) => p.projectId),
          },
        }
      : {}),
    // Full provenance object (deployed ledger), not wrangler-dev-only snapshot.
    ...(extractProvenance ? { extract_provenance: extractProvenance } : {}),
    ...(extractProvenance
      ? {
          provenance: {
            path: extractProvenance.path,
            fields: extractProvenance.fields,
            ...(extractProvenance.speech_act
              ? { speech_act: extractProvenance.speech_act }
              : {}),
            ...(extractProvenance.baml ? { baml: extractProvenance.baml } : {}),
            // WHICH LAYER DECIDED THE TURN. turn.ts sets this on the provenance
            // object, but this projection is hand-picked and was dropping it —
            // so `bind_source`/`embed_gate` existed in code and in NO durable
            // store (12,036 ledger rows, every one null). Without it there is
            // no way to answer "how much of understanding is regex vs the
            // embedding?" from production, which is the single question the
            // intent layer is accountable for.
            ...(extractProvenance.routing_bind
              ? { routing_bind: extractProvenance.routing_bind }
              : {}),
            ...(extractProvenance.intent_recovery
              ? { intent_recovery: extractProvenance.intent_recovery }
              : {}),
            ...(extractProvenance.train_eligible
              ? {
                  train_eligible: true,
                  ...(extractProvenance.train_sources?.length
                    ? { train_sources: extractProvenance.train_sources }
                    : {}),
                  ...(extractProvenance.train_proposal
                    ? { train_proposal: extractProvenance.train_proposal }
                    : {}),
                }
              : {}),
          },
        }
      : {}),
  };

  // Top-level train flag for exporters that don't walk provenance.
  if (extractProvenance?.train_eligible) {
    resolved_intent.train_eligible = true;
    if (extractProvenance.train_sources?.length) {
      resolved_intent.train_sources = extractProvenance.train_sources;
    }
    if (extractProvenance.train_proposal) {
      resolved_intent.train_proposal = extractProvenance.train_proposal;
    }
  }

  const topicsAsked = [
    ...(ex.askTopics?.length ? ex.askTopics : ex.askTopic ? [ex.askTopic] : []),
    ...(buyerText ? answerRequirements(buyerText) : []),
  ];
  const factsDelivered = [
    ...deliveredFactKeys(evidence),
    ...(evidence.education ? (['education'] as const) : []),
  ];
  const faqKeysDelivered =
    evidence.detail?.faqs?.map((f) => f.questionKey.toLowerCase()) ?? [];

  const action_plan: Record<string, unknown> = {
    kind: goal.kind,
    ...('topic' in goal && goal.topic ? { topic: goal.topic } : {}),
    ...('topics' in goal && goal.topics?.length ? { topics: goal.topics } : {}),
    ...('projectId' in goal && goal.projectId ? { project_id: goal.projectId } : {}),
    // SHADOW ONLY — what the chip ranker would have offered after this turn.
    // Nothing reads it to build the UI; the next row's `kind` is the truth it
    // gets scored against. It rides on action_plan because that is where the
    // turn's outgoing decisions live, and because a reader joining rows for the
    // prediction and the outcome then needs exactly one column.
    chip_shadow: buildChipShadow({ state, goal, evidence }),
    ...(failures?.length
      ? { failures: failures.map(summarizeFailure) }
      : {}),
    ...(evidence.education ||
    (failures?.some(
      (f) =>
        f.subject === 'education_explainer' ||
        (f.detail as { policy?: string } | undefined)?.policy === 'definition',
    ))
      ? {
          education: {
            kb_hit: Boolean(evidence.education),
            topic_key: evidence.education?.topicKey ?? null,
            jurisdiction: evidence.education?.jurisdiction ?? null,
            match: evidence.education?.match ?? null,
          },
        }
      : {}),
  };

  const fromMatches = evidence.matches?.map((m) => m.projectId) ?? [];
  const fromOffered = currentShortlist(state).map((o) => o.projectId);
  const offered_project_ids = [...new Set([...fromMatches, ...fromOffered])].slice(0, 20);

  return {
    snapshot_in,
    resolved_intent,
    action_plan,
    offered_project_ids,
    disclosed_facts: extractDisclosedFacts({ goal, evidence }),
    tool_runs: (evidence.tools ?? []).map((name) => {
      const produced = toolProducedEvidence(name, evidence);
      const latency_ms = evidence.toolLatencyMs?.[name] ?? 0;
      const failure_reason = evidence.toolFailureReason?.[name];
      return {
        name,
        args_summary: '',
        // Phase 0b — produced_evidence only when the slot filled; failure_reason
        // separates catalog absence from transport when the port reported !ok.
        produced_evidence: produced,
        latency_ms,
        ...(failure_reason && !produced ? { failure_reason } : {}),
      };
    }),
    verify: {
      grounding: grounding ?? 'pass',
      // v1 instrument only — dump = delivered ≫ asked. Gate later.
      over_answer: {
        topics_asked: topicsAsked,
        facts_delivered: factsDelivered,
        faq_keys_delivered: faqKeysDelivered,
        education_delivered: Boolean(evidence.education),
      },
      ...(Object.keys(evidence.toolFailureReason ?? {}).length
        ? { tool_failures: evidence.toolFailureReason }
        : {}),
      // Rides on `verify` because the question it exists to answer — "did the
      // paid composer produce a BETTER reply?" — is scored against `grounding`
      // and `over_answer` directly above it. One column, no join. `verify_json`
      // is already free-form, so this costs no migration.
      ...(compose ? { compose } : {}),
    },
    composer: 'converse_engine',
  };
}
