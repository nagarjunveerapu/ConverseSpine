/**
 * THE WIRE — let the intent verdict reach the decision.
 *
 * The engine computes its best understanding of every turn, scores it, maps it
 * to an answer topic, classifies it as answerable, and writes it to the
 * Understanding board. Then `decideGoal(s, ex, visitCtx, text)` is called
 * without any of it. That signature is the defect: the decision cannot see the
 * understanding.
 *
 * Measured on dev, 2026-07-26, focused on Brigade Eldorado, six fresh
 * conversations each:
 *
 *   "when is possession"           sil=ask_delivery_timeline 0.874   kept 0/6
 *   "what is the possession date"  sil=ask_delivery_timeline 0.880   kept 6/6
 *
 * Same intent. Same confidence. The embedder understood both perfectly and had
 * already mapped `ask_delivery_timeline -> availability` in `embedder-map.ts`.
 * The first phrasing still went to search, because only the LLM/regex extract
 * gets a vote, and the shortlist it returned then BECAME the subject — chained,
 * 5 of 8 asks collapse with no recovery path.
 *
 * That is also why every embedding investment measures inert end-to-end: the
 * corpus, the learned projection, the teach loop and the board all land in
 * telemetry and one narrow FAQ-key override. None of them can change what the
 * bot does.
 *
 * SCOPE — deliberately one blade.
 *
 * This rescues ONLY a turn that would otherwise fall to `search` while a focus
 * is held, on a high-confidence answer-intent bind. It is additive by
 * construction: it can convert a lost turn into an answer, and it cannot touch
 * a turn that already answers, because it only ever fires on `search`.
 *
 * It does NOT make the verdict an authority over a goal the extract already
 * chose. Widening it is a later, separately-measured step — the LLD's phases 2
 * through 5 all sharpen this verdict, and none of them is worth anything until
 * something consumes it.
 *
 * The rescued goal is returned WITHOUT `requires`; the caller runs it through
 * `withAnswerRequirements` like any other answer goal, so it faces the same
 * answer contract and declines honestly when the fact is absent.
 */
import type { ConversationState, TurnGoal } from '../types.js';
import { ROUTING_TAU_HIGH, answerTopicForIntent, isAnswerIntent } from './embedder-map.js';
import type { TurnRoutingResult } from './types.js';

export interface GoalRescueDecision {
  goal: TurnGoal;
  /** Set when the wire fired, for the ledger. Absent means nothing changed. */
  rescued?: { intent: string; score: number; topic: string };
}

export function rescueFocusedAnswer(
  goal: TurnGoal,
  routing: TurnRoutingResult | undefined,
  state: ConversationState,
  enabled: boolean,
): GoalRescueDecision {
  if (!enabled) return { goal };
  // ONE kind, on purpose. `recommend` is the shortlist -- the measured loss,
  // where the buyer named a project and got three others. `clarify_project_pick`
  // is a sibling symptom with its own owner (shortlist_answer, #134) and
  // `no_fit` only appeared downstream of an already-poisoned turn, so neither
  // is rescued here. Widen a kind at a time, each with its own measurement.
  if (goal.kind !== 'recommend') return { goal };
  // Only with a subject to return to. Without a focus there is no project to
  // answer about, and inventing one is the drift W1 exists to prevent.
  if (!state.focus?.projectId) return { goal };

  const intent = routing?.embedder_intent_kind;
  const score = routing?.embedder_score;
  if (!intent || typeof score !== 'number') return { goal };
  // τ_high, not τ_low. A weak bind that overrode a search would be a worse
  // failure than the one being fixed — the buyer at least gets projects today.
  if (score < ROUTING_TAU_HIGH) return { goal };
  if (!isAnswerIntent(intent)) return { goal };

  const topic = routing?.answer_topic ?? answerTopicForIntent(intent);
  if (!topic) return { goal };

  return {
    goal: { kind: 'answer', topic, projectId: state.focus.projectId },
    rescued: { intent, score, topic },
  };
}
