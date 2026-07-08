import type { Env } from '../../env.js';
import type { AnswerTopic } from '../types.js';
import { isVisitFollowUpQuestion } from '../phases/visit.js';
import { buildRoutingQuery } from './build-query.js';
import { hasVisitRoutingContext, mapIntentToRouting, ROUTING_TAU_HIGH } from './embedder-map.js';
import type { TurnRoutingInput, TurnRoutingResult } from './types.js';

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';

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

/** RTI-3A rule ladder — sync, always runs first. */
export function classifyTurnRoutingRules(input: TurnRoutingInput): TurnRoutingResult {
  const topic = primaryTopic(input);
  const pid = input.named_project_ids?.[0];

  if (topic && DEFERRABLE_TOPICS.includes(topic)) {
    return {
      routing: 'answer_on_project',
      confidence: 'rule',
      answer_topic: topic,
      ...(pid ? { project_id: pid } : {}),
    };
  }

  if (input.transition === 'want_visit') {
    return {
      routing: 'visit_schedule_stop',
      confidence: 'rule',
      ...(pid ? { project_id: pid } : {}),
    };
  }

  if (
    isVisitFollowUpQuestion(input.text, {
      askTopic: input.ask_topic,
      askTopics: input.ask_topics,
    }) &&
    hasVisitRoutingContext(input)
  ) {
    return {
      routing: 'visit_schedule_stop',
      confidence: 'rule',
      ...(pid ? { project_id: pid } : {}),
    };
  }

  if (input.visit?.awaiting_confirm && /^(?:yes|yeah|yep|yup|ok(?:ay)?|sure|confirm(?:ed)?|go ahead|sounds good)\.?!?\s*$/i.test(input.text.trim())) {
    return { routing: 'visit_confirm', confidence: 'rule' };
  }

  return { routing: 'defer', confidence: 'abstain', abstain_reason: 'rti_3a_no_rule' };
}

async function embedderRouting(
  env: Pick<Env, 'AI' | 'INTENT_VECTORS'>,
  input: TurnRoutingInput,
): Promise<TurnRoutingResult | null> {
  if (!env.AI || !env.INTENT_VECTORS) return null;

  const queryText = buildRoutingQuery(input);
  const embed = (await env.AI.run(EMBED_MODEL, { text: [queryText] })) as { data?: number[][] };
  const vector = embed.data?.[0];
  if (!vector) return null;

  const scopes = [input.builder_id, ''].filter((s, i, a) => a.indexOf(s) === i);
  let bestKind = '';
  let bestScore = 0;

  for (const scope of scopes) {
    const filter = scope ? { builder_scope: scope } : undefined;
    const results = await env.INTENT_VECTORS.query(vector, {
      topK: 3,
      returnMetadata: 'all',
      ...(filter ? { filter } : {}),
    }).catch(() => null);
    const top = results?.matches?.[0];
    const kind =
      top?.metadata && typeof top.metadata.intent_kind === 'string'
        ? (top.metadata.intent_kind as string)
        : '';
    const score = top?.score ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestKind = kind;
    }
  }

  if (!bestKind || bestScore < ROUTING_TAU_HIGH) return null;
  return mapIntentToRouting(bestKind, bestScore, input);
}

/** RTI-3B — rules first, then embedder enforce when corpus matches. */
export async function classifyTurnRouting(
  env: Pick<Env, 'AI' | 'INTENT_VECTORS'> | undefined,
  input: TurnRoutingInput,
): Promise<TurnRoutingResult> {
  const ruled = classifyTurnRoutingRules(input);
  if (ruled.routing !== 'defer') return ruled;

  if (!env) return ruled;

  const embedded = await embedderRouting(env, input);
  if (embedded) return embedded;

  return ruled;
}

/** @deprecated use classifyTurnRoutingRules — kept for tests importing sync helper */
export function classifyTurnRoutingSync(input: TurnRoutingInput): TurnRoutingResult {
  return classifyTurnRoutingRules(input);
}
