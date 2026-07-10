import type { AnswerTopic, ConversationState, Extracted, TurnGoal } from '../types.js';

/** Facet topics — P3-B: never collapse these to overview when already extracted. */
const FACET_TOPICS: ReadonlySet<AnswerTopic> = new Set([
  'price',
  'legal',
  'emi',
  'amenities',
  'availability',
  'location',
  'media',
  'property_type',
]);

function answerTopics(ex: Extracted): AnswerTopic[] {
  const raw = ex.askTopics?.length ? ex.askTopics : ex.askTopic ? [ex.askTopic] : [];
  const filtered = raw.filter((t) => t !== 'compare');
  if (filtered.length) return filtered;
  if (ex.transition === 'want_details') return ['overview'];
  return ['overview'];
}

export function decide(s: ConversationState, ex: Extracted): TurnGoal {
  const focus = s.focus;
  if (!focus) return { kind: 'orient' };

  if (
    s.postVisitAckPending &&
    (ex.postVisitAck || (ex.affirm && !ex.askTopic && !ex.isQuestion) || ex.smalltalk)
  ) {
    return { kind: 'warm_ack' };
  }

  if (ex.recall) return { kind: 'visit_recall' };
  if (ex.transition === 'want_visit') return { kind: 'propose_visit', projectId: focus.projectId };
  if (ex.objection) return { kind: 'objection', topic: ex.objectionTopic ?? 'custom', projectId: focus.projectId };

  if (ex.compareAdvice || ex.askTopic === 'compare' || ex.askTopics?.includes('compare')) {
    const pid =
      (ex.compareProjectIds?.length ?? 0) >= 2
        ? ex.compareProjectIds![0]!
        : focus.projectId;
    return { kind: 'answer', topic: 'compare', projectId: pid };
  }
  // Correction / multi-name without "compare" verb — keep both in play.
  if ((ex.namedProjects?.length ?? 0) >= 2) {
    return {
      kind: 'answer',
      topic: 'compare',
      projectId: ex.namedProjects![0]!.projectId,
    };
  }

  const topics = answerTopics(ex);
  let primary = topics[0] ?? 'overview';
  // P3-B: if extract already set a facet topic, never fall through to overview.
  if (primary === 'overview') {
    const facet =
      (ex.askTopic && FACET_TOPICS.has(ex.askTopic) ? ex.askTopic : undefined) ??
      topics.find((t) => FACET_TOPICS.has(t));
    if (facet) primary = facet;
  }
  return {
    kind: 'answer',
    topic: primary,
    projectId: focus.projectId,
    ...(topics.length > 1 ? { topics } : {}),
  };
}
