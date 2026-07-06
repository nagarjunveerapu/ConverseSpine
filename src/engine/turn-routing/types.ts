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

export interface TurnRoutingResult {
  routing: TurnRoutingKind;
  confidence: TurnRoutingConfidence;
  project_id?: string;
  project_name?: string;
  answer_topic?: AnswerTopic;
  embedder_intent_kind?: string;
  embedder_score?: number;
  abstain_reason?: string;
}

export interface TurnRoutingInput {
  text: string;
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
}

export function buildTurnRoutingInput(
  state: ConversationState,
  ex: Extracted,
  text: string,
): TurnRoutingInput {
  return {
    text,
    phase: state.phase,
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
  };
}
