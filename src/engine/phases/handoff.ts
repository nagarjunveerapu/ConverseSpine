import { currentShortlist, discussedList, focusedRef } from '../entity-store.js';
import { detectTopics } from '../facts.js';
import type { ConversationState, Extracted, TurnGoal } from '../types.js';
import { BARE_BHK_CONFIG_RE, catalogAskOwns } from '../turn-routing/intent-authority.js';
import { decide as focusedDecide } from './focused.js';

/** Pin for catalog escape when sticky handoff lost focus after advisor book. */
function catalogPin(
  s: ConversationState,
): { projectId: string; projectName: string } | undefined {
  const focus = focusedRef(s);
  if (focus) return focus;
  if (s.visit?.projectId && s.visit.projectName) {
    return { projectId: s.visit.projectId, projectName: s.visit.projectName };
  }
  const disc = discussedList(s)[0] ?? currentShortlist(s)[0];
  if (disc) return { projectId: disc.projectId, projectName: disc.name };
  return undefined;
}

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
  if (ex.recallConstraints) return { kind: 'recall_constraints' };
  if (ex.recall) return { kind: 'visit_recall' };
  if (ex.postVisitAck || (ex.affirm && !ex.askTopic && !ex.isQuestion) || ex.smalltalk) {
    return { kind: 'warm_ack' };
  }
  // Catalog re-engage — leave sticky handoff when the buyer asks a project fact.
  // Prefer focus; fall back to visit / discussed / shortlist (advisor book often
  // clears visit with focus unset → sticky handoff traps "2BHK").
  const pinned = catalogPin(s);
  if (pinned && catalogAskOwns(ex, text)) {
    let next = ex;
    // FactKey/FAQ can own the turn while askTopics are still empty (loan chip).
    // Seed detectTopics so focused.decide does not collapse to overview.
    if (!next.askTopic && !(next.askTopics?.length) && text.trim()) {
      const topics = detectTopics(text);
      if (topics.length) {
        next = { ...next, askTopic: topics[0], askTopics: topics };
      } else if (BARE_BHK_CONFIG_RE.test(text.trim())) {
        // Same closed token as visit defer — post-book sticky handoff must answer.
        next = { ...next, askTopic: 'availability', askTopics: ['availability'] };
      }
    }
    return focusedDecide({ ...s, focus: pinned }, next, text);
  }
  return { kind: 'handoff' };
}
