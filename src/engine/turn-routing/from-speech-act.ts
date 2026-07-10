/**
 * SA-4 = P5: project speech-act (+ topic, phase) → TurnRoutingResult.
 * Not a second act classifier — closed chip menu already resolved on Extracted.
 */
import type { SpeechActKind } from '../speech-act/types.js';
import type { AnswerTopic } from '../types.js';
import type { TurnRoutingInput, TurnRoutingResult } from './types.js';

/** Topics that answer on a project instead of visit/search (shared with visit.decide). */
export const DEFERRABLE_ANSWER_TOPICS: readonly AnswerTopic[] = [
  'emi',
  'legal',
  'price',
  'media',
  'location',
  'property_type',
  'amenities',
  'availability',
] as const;

function primaryTopic(input: TurnRoutingInput): AnswerTopic | undefined {
  const topics = (input.ask_topics ?? []).filter((t) => t !== 'compare');
  if (topics.length) return topics[0];
  if (input.ask_topic && input.ask_topic !== 'compare') return input.ask_topic;
  return undefined;
}

function projectId(input: TurnRoutingInput): string | undefined {
  return input.named_project_ids[0] ?? input.focus?.project_id;
}

/**
 * Map resolved speech act → routing. Returns null when act is unknown / needs gap-fill.
 */
export function projectRoutingFromSpeechAct(
  input: TurnRoutingInput,
  speechAct?: SpeechActKind,
): TurnRoutingResult | null {
  const act = speechAct ?? input.speech_act;
  if (!act || act === 'unknown') return null;

  const topic = primaryTopic(input);
  const pid = projectId(input);
  const base = {
    confidence: 'rule' as const,
    ...(pid ? { project_id: pid } : {}),
  };

  switch (act) {
    case 'answer': {
      const answerTopic = topic ?? 'overview';
      return {
        routing: 'answer_on_project',
        answer_topic: answerTopic,
        ...base,
      };
    }
    case 'switch':
      return {
        routing: 'answer_on_project',
        answer_topic: topic ?? 'overview',
        ...base,
      };
    case 'compare':
      return { routing: 'compare_offered', ...base };
    case 'visit_book':
      return { routing: 'visit_schedule_stop', ...base };
    case 'visit_recall':
      // Recall is goal-level; routing stays defer so visit.decide / recall path owns it.
      return { routing: 'defer', confidence: 'rule', abstain_reason: 'speech_act_visit_recall' };
    case 'search':
      return { routing: 'search_pivot', ...base };
    case 'object':
      if (input.focus || pid) {
        return {
          routing: 'focused_question',
          ...(topic ? { answer_topic: topic } : {}),
          ...base,
        };
      }
      return { routing: 'defer', confidence: 'rule', abstain_reason: 'speech_act_object_no_focus' };
    case 'greet':
    case 'handoff':
    case 'stop':
      return { routing: 'defer', confidence: 'rule', abstain_reason: `speech_act_${act}` };
    default:
      return null;
  }
}
