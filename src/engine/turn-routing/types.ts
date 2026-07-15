import type { AnswerTopic, ConversationState, Extracted, Phase } from '../types.js';

export type TurnRoutingKind =
  | 'answer_on_project'
  | 'focused_question'
  | 'visit_schedule_stop'
  | 'visit_add_stop'
  | 'visit_confirm'
  | 'visit_reschedule'
  | 'search_pivot'
  | 'compare_offered'
  | 'defer';

export type TurnRoutingConfidence = 'rule' | 'embedder' | 'llm' | 'abstain';

/**
 * SIL Phase 0 — per-turn semantic-layer telemetry (SEMANTIC_INTENT_LAYER_LLD §3.3).
 * Records whether the embedder ran, what gated it when it didn't, and the top
 * match + margin when it did. Stamped into extract_provenance.routing_bind —
 * the debug channel that survives the /chat route re-shape.
 */
export interface RoutingBindTelemetry {
  bind_source: 'regex' | 'embed_intent' | 'none';
  embed_fired: boolean;
  embed_gate?: 'visit_rule' | 'speech_act' | 'rule_bound' | 'act_known' | 'no_env' | 'embed_error';
  top_kind?: string;
  top_score?: number;
  margin?: number;
}

export interface TurnRoutingResult {
  routing: TurnRoutingKind;
  confidence: TurnRoutingConfidence;
  project_id?: string;
  project_name?: string;
  answer_topic?: AnswerTopic;
  embedder_intent_kind?: string;
  embedder_score?: number;
  abstain_reason?: string;
  bind?: RoutingBindTelemetry;
}

export interface TurnRoutingInput {
  text: string;
  builder_id: string;
  phase: Phase;
  focus?: { project_id: string; project_name: string };
  visit?: {
    project_id?: string;
    project_name?: string;
    queued_count: number;
    awaiting_confirm: boolean;
    booked_count: number;
  };
  ask_topic?: AnswerTopic;
  ask_topics?: AnswerTopic[];
  named_project_ids: string[];
  transition?: Extracted['transition'];
  /** SA-4: resolved speech act — routing projects from this when known. */
  speech_act?: Extracted['speechAct'];
}

export function buildTurnRoutingInput(
  state: ConversationState,
  ex: Extracted,
  text: string,
): TurnRoutingInput {
  return {
    text,
    builder_id: state.builderId,
    phase: state.phase,
    transition: ex.transition,
    ...(state.focus
      ? { focus: { project_id: state.focus.projectId, project_name: state.focus.projectName } }
      : {}),
    ...(state.visit
      ? {
          visit: {
            ...(state.visit.projectId ? { project_id: state.visit.projectId } : {}),
            ...(state.visit.projectName ? { project_name: state.visit.projectName } : {}),
            queued_count: state.visit.queued?.length ?? 0,
            awaiting_confirm: !!state.visit.awaitingConfirm,
            booked_count: state.visitBookedCache?.length ?? 0,
          },
        }
      : {}),
    ...(ex.askTopic ? { ask_topic: ex.askTopic } : {}),
    ...(ex.askTopics?.length ? { ask_topics: ex.askTopics } : {}),
    named_project_ids: (ex.namedProjects ?? []).map((p) => p.projectId),
    ...(ex.speechAct ? { speech_act: ex.speechAct } : {}),
  };
}
