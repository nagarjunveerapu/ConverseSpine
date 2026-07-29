import { detectTopics } from '../facts.js';
import type { ConversationState, Extracted, TurnGoal } from '../types.js';
import { catalogAskOwns } from '../turn-routing/intent-authority.js';
import { decide as focusedDecide } from './focused.js';

/**
 * Sticky handoff must not trap catalog facet asks. Once phase===handoff,
 * the old path returned handoff for almost everything (only smalltalk/recall
 * escaped) — one false escalate in a session poisoned later loan/PDF/amenity
 * asks into "advisor will follow up."
 *
 * Escape: focus still set + clear catalog ask → re-enter focused answer.
 * True human/stop asks stay handoff (no catalog ownership).
 */
export function decide(s: ConversationState, ex: Extracted, text = ''): TurnGoal {
  if (ex.recall) return { kind: 'visit_recall' };
  if (ex.postVisitAck || (ex.affirm && !ex.askTopic && !ex.isQuestion) || ex.smalltalk) {
    return { kind: 'warm_ack' };
  }
  // Catalog re-engage — leave sticky handoff when the buyer asks a project fact.
  if (s.focus && catalogAskOwns(ex, text)) {
    let next = ex;
    // FactKey/FAQ can own the turn while askTopics are still empty (loan chip).
    // Seed detectTopics so focused.decide does not collapse to overview.
    if (!next.askTopic && !(next.askTopics?.length) && text.trim()) {
      const topics = detectTopics(text);
      if (topics.length) {
        next = { ...next, askTopic: topics[0], askTopics: topics };
      }
    }
    return focusedDecide(s, next, text);
  }
  return { kind: 'handoff' };
}
