/**
 * Multi-intent Phase B — attach and merge answer_topics[] without collapsing
 * extract.askTopics when routing only carries a scalar.
 */
import { unionAskTopics } from '../facts.js';
import type { Extracted } from '../types.js';
import type { TurnRoutingInput, TurnRoutingResult } from './types.js';

const ANSWERISH: ReadonlySet<TurnRoutingResult['routing']> = new Set([
  'answer_on_project',
  'focused_question',
]);

/** Stamp answer_topics from extract input + singular answer_topic. */
export function attachAnswerTopics(
  result: TurnRoutingResult,
  input: TurnRoutingInput,
): TurnRoutingResult {
  if (!ANSWERISH.has(result.routing)) return result;
  const topics = unionAskTopics(
    input.ask_topics,
    input.ask_topic && input.ask_topic !== 'compare' ? [input.ask_topic] : undefined,
    result.answer_topics,
    result.answer_topic && result.answer_topic !== 'compare' ? [result.answer_topic] : undefined,
  ).filter((t) => t !== 'compare');
  if (!topics.length) return result;
  return {
    ...result,
    answer_topic: topics[0],
    answer_topics: topics,
  };
}

/** Union routing's topic set into Extracted.askTopics (never overwrite with a shorter set). */
export function mergeRoutingTopicsIntoExtract(
  ex: Extracted,
  routing: TurnRoutingResult | undefined,
): Extracted {
  if (!routing) return ex;
  const fromRouting =
    routing.answer_topics?.length
      ? routing.answer_topics
      : routing.answer_topic
        ? [routing.answer_topic]
        : [];
  if (!fromRouting.length) return ex;
  const united = unionAskTopics(
    ex.askTopics,
    ex.askTopic ? [ex.askTopic] : undefined,
    fromRouting,
  );
  if (!united.length) return ex;
  const prev = ex.askTopics ?? (ex.askTopic ? [ex.askTopic] : []);
  if (prev.length === united.length && prev.every((t, i) => t === united[i])) return ex;
  return { ...ex, askTopic: united[0], askTopics: united };
}
