/**
 * THE WIRE — the intent verdict gets a vote before the subject is deleted.
 *
 * `turn.ts:341` asks an LLM classifier what the turn wants; `343` applies it,
 * and `release_focus` / `broaden_constraints` delete the conversation's
 * subject. The embedding verdict is not computed until line 927. So the
 * pipeline destroys the subject ~580 lines before it works out what the turn
 * meant, and the verdict cannot participate because it does not exist yet.
 * That ordering, not a missing consumer, is why embeddings measure inert
 * end-to-end.
 *
 * Measured on dev, focused on Brigade Eldorado, six fresh conversations each:
 *
 *   "when is possession"           ask_delivery_timeline 0.874   kept 0/6
 *   "what is the possession date"  ask_delivery_timeline 0.880   kept 6/6
 *
 * Same intent, same confidence, and `embedder-map.ts` had already mapped
 * `ask_delivery_timeline -> availability` and listed it in ANSWER_INTENTS.
 * Only the LLM classifier differs. The shortlist that replaces the project
 * then BECOMES the subject: chained, 5 of 8 asks collapse, no recovery.
 *
 * ONE BLADE, and it only ever WITHHOLDS a release. It cannot release a focus
 * that would have been kept, cannot choose a goal, cannot pick a project. The
 * worst case is a buyer who did mean "show me others" saying so once more,
 * against a subject deletion that today is silent and unrecoverable.
 */
import { ROUTING_TAU_HIGH, answerTopicForIntent, isAnswerIntent } from './embedder-map.js';
import type { TurnRoutingResult } from './types.js';

export interface FocusHoldDecision {
  hold: boolean;
  reason?: { intent: string; score: number; topic: string };
}

export function holdsFocusAgainstRelease(
  routing: TurnRoutingResult | undefined,
  enabled: boolean,
): FocusHoldDecision {
  if (!enabled) return { hold: false };

  // Read the SAME fields the Understanding board reads
  // (understanding/capture.ts silDecision). `embedder_intent_kind` /
  // `embedder_score` are populated only on some branches; two earlier drafts
  // of this wire read that pair and silently never fired in production while
  // every unit probe stayed green.
  const bind = routing?.bind;
  // Only a real embedding bind. A `regex` bind is the very lane whose verdict
  // this is meant to check, so letting it vote would be circular.
  if (bind?.bind_source !== 'embed_intent') return { hold: false };
  const intent = bind.top_kind;
  const score = bind.top_score;
  if (!intent || typeof score !== 'number') return { hold: false };
  // tau_high, not tau_low. A weak bind pinning a buyer to a project they were
  // trying to leave is a worse failure than the one being fixed.
  if (score < ROUTING_TAU_HIGH) return { hold: false };
  if (!isAnswerIntent(intent)) return { hold: false };

  // An answer intent with no topic is not evidence of anything; decline rather
  // than defaulting, which is why `answerTopicForIntent` does not fall back.
  const topic = routing?.answer_topic ?? answerTopicForIntent(intent);
  if (!topic) return { hold: false };

  return { hold: true, reason: { intent, score, topic } };
}
