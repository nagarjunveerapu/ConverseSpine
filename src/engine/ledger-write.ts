/**
 * P2a / SA-5 — map end-of-turn engine state → NayaDesk turn_ledger columns.
 * P2c adds disclosed_facts from structured evidence.
 */
import type { ExtractProvenance } from '../engine/ingress.js';
import { buildChipShadow } from '../chips/shadow.js';
import { extractDisclosedFacts, type DisclosedFact } from './disclosed-facts.js';
import { summarizeFailure, type Failure } from './outcome.js';
import { answerRequirements, deliveredFactKeys } from './answer-contract.js';
import type {
  ConversationState,
  EvidenceSet,
  Extracted,
  TurnGoal,
} from '../engine/types.js';

export interface LedgerWritePayload {
  snapshot_in: Record<string, unknown>;
  resolved_intent: Record<string, unknown>;
  action_plan: Record<string, unknown>;
  offered_project_ids: string[];
  disclosed_facts: DisclosedFact[];
  tool_runs: Array<{ name: string; args_summary: string; success: boolean; latency_ms: number }>;
  verify: Record<string, unknown>;
  composer: string;
}

export function buildLedgerWritePayload(input: {
  state: ConversationState;
  ex: Extracted;
  goal: TurnGoal;
  evidence: EvidenceSet;
  inputSource?: string;
  extractProvenance?: ExtractProvenance;
  grounding?: string;
  failures?: readonly Failure[];
  /** Buyer text for over-answer telemetry (asked vs delivered). */
  buyerText?: string;
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
  } = input;

  const snapshot_in: Record<string, unknown> = {
    phase: state.phase,
    ...(state.focus
      ? { focus: { project_id: state.focus.projectId, name: state.focus.projectName } }
      : {}),
    constraints: { ...state.constraints },
    shortlist: state.discover.lastOffered.map((o) => ({
      project_id: o.projectId,
      name: o.name,
    })),
    ...(state.rti?.pendingPrompt ? { pending_prompt: state.rti.pendingPrompt } : {}),
    ...(inputSource ? { input_source: inputSource } : {}),
  };

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
          },
        }
      : {}),
  };

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
  const fromOffered = state.discover.lastOffered.map((o) => o.projectId);
  const offered_project_ids = [...new Set([...fromMatches, ...fromOffered])].slice(0, 20);

  return {
    snapshot_in,
    resolved_intent,
    action_plan,
    offered_project_ids,
    disclosed_facts: extractDisclosedFacts({ goal, evidence }),
    tool_runs: (evidence.tools ?? []).map((name) => ({
      name,
      args_summary: '',
      success: true,
      latency_ms: 0,
    })),
    verify: {
      grounding: grounding ?? 'pass',
      // v1 instrument only — dump = delivered ≫ asked. Gate later.
      over_answer: {
        topics_asked: topicsAsked,
        facts_delivered: factsDelivered,
        faq_keys_delivered: faqKeysDelivered,
        education_delivered: Boolean(evidence.education),
      },
    },
    composer: 'converse_engine',
  };
}
