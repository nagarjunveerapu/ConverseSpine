import type { AnswerTopic } from '../types.js';
import { isVisitFollowUpQuestion } from '../phases/visit.js';
import type { TurnRoutingInput, TurnRoutingResult } from './types.js';

const DEFERRABLE_TOPICS: AnswerTopic[] = [
  'emi',
  'legal',
  'price',
  'media',
  'location',
  'property_type',
  'amenities',
  'availability',
];

function primaryTopic(input: TurnRoutingInput): AnswerTopic | undefined {
  const topics = (input.ask_topics ?? []).filter((t) => t !== 'compare');
  if (topics.length) return topics[0];
  if (input.ask_topic && input.ask_topic !== 'compare') return input.ask_topic;
  return undefined;
}

/** RTI-3A — rule ladder only; embedder shadow in RTI-3B. */
export function classifyTurnRouting(input: TurnRoutingInput): TurnRoutingResult {
  const topic = primaryTopic(input);

  if (topic && DEFERRABLE_TOPICS.includes(topic)) {
    return {
      routing: 'answer_on_project',
      confidence: 'rule',
      answer_topic: topic,
      ...(input.named_project_ids[0] ? { project_id: input.named_project_ids[0] } : {}),
    };
  }

  if (
    isVisitFollowUpQuestion(input.text, {
      askTopic: input.ask_topic,
      askTopics: input.ask_topics,
    })
  ) {
    return {
      routing: 'visit_schedule_stop',
      confidence: 'rule',
      ...(input.named_project_ids[0] ? { project_id: input.named_project_ids[0] } : {}),
    };
  }

  return { routing: 'defer', confidence: 'abstain', abstain_reason: 'rti_3a_no_rule' };
}
