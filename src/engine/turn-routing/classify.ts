import type { Env } from '../../env.js';
import type { AnswerTopic } from '../types.js';
import { isVisitFollowUpQuestion } from '../phases/visit.js';
import { buildRoutingQuery } from './build-query.js';
import { hasVisitRoutingContext, mapIntentToRouting, ROUTING_TAU_HIGH } from './embedder-map.js';
import { DEFERRABLE_ANSWER_TOPICS, projectRoutingFromSpeechAct } from './from-speech-act.js';
import type { TurnRoutingInput, TurnRoutingResult } from './types.js';

/** Default only — the ACTIVE model is env.SIL_EMBED_MODEL, shared with the
 *  index rebuild. Query and index MUST embed with the same model: different
 *  models produce different vector spaces, so a mismatch silently destroys
 *  retrieval rather than failing loudly. */
const DEFAULT_EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';

function primaryTopic(input: TurnRoutingInput): AnswerTopic | undefined {
  const topics = (input.ask_topics ?? []).filter((t) => t !== 'compare');
  if (topics.length) return topics[0];
  if (input.ask_topic && input.ask_topic !== 'compare') return input.ask_topic;
  return undefined;
}

/** RTI-3A rule ladder — sync; used when speech-act is unknown. */
export function classifyTurnRoutingRules(input: TurnRoutingInput): TurnRoutingResult {
  const topic = primaryTopic(input);
  const pid = input.named_project_ids?.[0];

  if (topic && (DEFERRABLE_ANSWER_TOPICS as readonly AnswerTopic[]).includes(topic)) {
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

type EmbedMissReason = 'no_match' | 'below_tau' | 'unmapped_kind' | 'query_error';

interface EmbedderOutcome {
  result: TurnRoutingResult | null;
  fired: boolean;
  top_kind?: string;
  top_score?: number;
  margin?: number;
  miss_reason?: EmbedMissReason;
  facet?: string;
  /** Telemetry only: the ranked candidates behind the bind. The bind itself
   *  still uses matches[0]; this exposes whether a SECOND distinct intent is
   *  present, which is what a multi-intent turn looks like. */
  top_matches?: { kind: string; score: number }[];
}

/** Exported for the embedder-only experiment: run the SAME bind the engine uses,
 *  bypassing the regex ladder that normally gates it. Measurement only. */
export async function embedderRouting(
  env: Pick<Env, 'AI' | 'INTENT_VECTORS' | 'SIL_EMBED_MODEL'>,
  input: TurnRoutingInput,
): Promise<EmbedderOutcome> {
  if (!env.AI || !env.INTENT_VECTORS) return { result: null, fired: false };

  const queryText = buildRoutingQuery(input);
  const model = env.SIL_EMBED_MODEL || DEFAULT_EMBED_MODEL;
  const embed = (await env.AI.run(model as never, { text: [queryText] })) as { data?: number[][] };
  const vector = embed.data?.[0];
  if (!vector) return { result: null, fired: false };

  const scopes = [input.builder_id, ''].filter((s, i, a) => a.indexOf(s) === i);
  // SIL Phase 0 — keep every match (deduped by id: the global query re-returns
  // scoped rows) so the top-1/top-2 margin is measurable, not just the winner.
  const seen = new Set<string>();
  const matches: { kind: string; score: number; facet: string }[] = [];
  let queryOk = false;

  for (const scope of scopes) {
    const filter = scope ? { builder_scope: scope } : undefined;
    const results = await env.INTENT_VECTORS.query(vector, {
      topK: 5,
      returnMetadata: 'all',
      ...(filter ? { filter } : {}),
    }).catch(() => null);
    if (results) queryOk = true;
    for (const m of results?.matches ?? []) {
      if (m.id && seen.has(m.id)) continue;
      if (m.id) seen.add(m.id);
      matches.push({
        kind:
          m.metadata && typeof m.metadata.intent_kind === 'string'
            ? (m.metadata.intent_kind as string)
            : '',
        score: m.score ?? 0,
        facet:
          m.metadata && typeof m.metadata.facet === 'string'
            ? (m.metadata.facet as string)
            : '',
      });
    }
  }

  // Tie-break: identical phrasings taught under several doors score equal;
  // the copy carrying a taught facet is strictly more information (facets are
  // only taught when one FAQ key owns the meaning catalog-wide), so it wins.
  matches.sort((a, b) => b.score - a.score || (b.facet ? 1 : 0) - (a.facet ? 1 : 0));
  const top = matches[0];
  const second = matches[1];
  const telemetry = {
    fired: true,
    ...(top ? { top_kind: top.kind, top_score: top.score } : {}),
    ...(top?.facet ? { facet: top.facet } : {}),
    ...(top && second ? { margin: top.score - second.score } : {}),
    top_matches: matches.slice(0, 5).map((m) => ({ kind: m.kind, score: m.score })),
  };

  // SIL Phase 0 — record WHY a fired embedder produced no bind, so an empty/stale
  // index, a low-confidence result, and an unroutable kind are distinguishable
  // (review: fired:true with no reason conflates four different failures).
  if (!top?.kind) {
    return { result: null, ...telemetry, miss_reason: queryOk ? 'no_match' : 'query_error' };
  }
  if (top.score < ROUTING_TAU_HIGH) {
    return { result: null, ...telemetry, miss_reason: 'below_tau' };
  }
  const result = mapIntentToRouting(top.kind, top.score, input);
  if (!result) {
    return { result: null, ...telemetry, miss_reason: 'unmapped_kind' };
  }
  // Taught sub-intent rides the winning vector's metadata (Desk mirrors the
  // facet the human picked on the board) — carry it for the compose consumer.
  return {
    result: top.facet ? { ...result, embedder_facet: top.facet } : result,
    ...telemetry,
  };
}

/**
 * SA-4 = P5: speech-act projection first; rule ladder; embedder only when act=unknown + defer.
 * Visit follow-up (bare "what about X" with visit context) beats speech-act overview (V02).
 */
export async function classifyTurnRouting(
  env: Pick<Env, 'AI' | 'INTENT_VECTORS' | 'SIL_EMBED_MODEL'> | undefined,
  input: TurnRoutingInput,
): Promise<TurnRoutingResult> {
  const pid = input.named_project_ids?.[0];

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
      bind: { bind_source: 'regex', embed_fired: false, embed_gate: 'visit_rule' },
    };
  }

  const fromAct = projectRoutingFromSpeechAct(input);
  if (fromAct && fromAct.routing !== 'defer') {
    return { ...fromAct, bind: { bind_source: 'regex', embed_fired: false, embed_gate: 'speech_act' } };
  }

  const ruled = classifyTurnRoutingRules(input);
  if (ruled.routing !== 'defer') {
    return { ...ruled, bind: { bind_source: 'regex', embed_fired: false, embed_gate: 'rule_bound' } };
  }

  // Embedder gap-fill only when speech act is unknown (or absent).
  const act = input.speech_act;
  if (act && act !== 'unknown') {
    const gated = fromAct ?? ruled;
    return { ...gated, bind: { bind_source: 'none', embed_fired: false, embed_gate: 'act_known' } };
  }

  if (!env) {
    return { ...ruled, bind: { bind_source: 'none', embed_fired: false, embed_gate: 'no_env' } };
  }

  const embedded = await embedderRouting(env, input);
  const scores = {
    ...(embedded.top_kind !== undefined ? { top_kind: embedded.top_kind } : {}),
    ...(embedded.top_score !== undefined ? { top_score: embedded.top_score } : {}),
    ...(embedded.margin !== undefined ? { margin: embedded.margin } : {}),
    ...(embedded.miss_reason !== undefined ? { miss_reason: embedded.miss_reason } : {}),
    ...(embedded.facet !== undefined ? { facet: embedded.facet } : {}),
  };
  if (embedded.result) {
    return { ...embedded.result, bind: { bind_source: 'embed_intent', embed_fired: true, ...scores } };
  }

  return {
    ...ruled,
    bind: {
      bind_source: 'none',
      embed_fired: embedded.fired,
      ...(embedded.fired ? {} : { embed_gate: 'embed_error' }),
      ...scores,
    },
  };
}

/** @deprecated use classifyTurnRoutingRules — kept for tests importing sync helper */
export function classifyTurnRoutingSync(input: TurnRoutingInput): TurnRoutingResult {
  return classifyTurnRoutingRules(input);
}
