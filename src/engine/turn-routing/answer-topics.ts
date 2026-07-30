/**
 * Multi-intent Phase B — attach and merge answer_topics[] without collapsing
 * extract.askTopics when routing only carries a scalar.
 */
import { ASK_TOPICS_CAP, unionAskTopics } from '../facts.js';
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
  const prev = ex.askTopics ?? (ex.askTopic ? [ex.askTopic] : []);
  // Deterministic extract already named topics — keep extract order as authority.
  // Do not re-sort via TOPIC_ORDER (price before location), and do not let a
  // false embedder facet contaminate overview/FAQ turns (P1 residual-22:
  // ಸ್ಥಳ/இடம் → price; बिल्डर/एप्रिसिएशन → price).
  if (prev.length > 0) {
    const primary = prev[0]!;
    // Overview/FAQ extract owns the turn — taught-lane may promote later only
    // when FAQ keys are empty; merging price here leapfrogs compose.
    if (primary === 'overview') return ex;
    const routingOnly = fromRouting.filter((t) => t !== 'compare' && !prev.includes(t));
    const askTopics = [primary, ...prev.slice(1).filter((t) => t !== primary), ...routingOnly].slice(
      0,
      ASK_TOPICS_CAP,
    );
    if (prev.length === askTopics.length && prev.every((t, i) => t === askTopics[i])) return ex;
    return { ...ex, askTopic: primary, askTopics };
  }
  const united = unionAskTopics(fromRouting);
  if (!united.length) return ex;
  return { ...ex, askTopic: united[0], askTopics: united };
}
