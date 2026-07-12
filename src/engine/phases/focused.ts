import type { AnswerTopic, ConversationState, Extracted, TurnGoal } from '../types.js';
import { holdUnitType } from '../hold-intent.js';

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

export function decide(s: ConversationState, ex: Extracted, text = ''): TurnGoal {
  const focus = s.focus;
  if (!focus) return { kind: 'orient' };

  // Hold confirm gate — one-shot window opened by hold_propose last turn. A
  // bare affirmation books it; anything else falls through (and the engine
  // clears the window after the turn), mirroring the visit confirm gate.
  if (s.hold?.awaitingConfirm && ex.affirm && !ex.decline) {
    return {
      kind: 'hold_booked',
      projectId: s.hold.projectId ?? focus.projectId,
      projectName: s.hold.projectName ?? focus.projectName,
      unitType: s.hold.unitType ?? '',
    };
  }

  if (
    s.postVisitAckPending &&
    (ex.postVisitAck || (ex.affirm && !ex.askTopic && !ex.isQuestion) || ex.smalltalk)
  ) {
    return { kind: 'warm_ack' };
  }

  if (ex.recall) return { kind: 'visit_recall' };
  if (ex.transition === 'want_visit') return { kind: 'propose_visit', projectId: focus.projectId };
  if (ex.objection) return { kind: 'objection', topic: ex.objectionTopic ?? 'custom', projectId: focus.projectId };

  // Explicit ask to hold/reserve a unit — stamped as ex.holdAsk by the
  // extract funnel (hold-intent.ts) so turn logs show why the gate fired.
  // Proposes only when the TYPE resolves; otherwise falls through and
  // answers availability normally.
  if (ex.holdAsk) {
    const unitType = holdUnitType(text, s.constraints.bhk);
    if (unitType) {
      return {
        kind: 'hold_propose',
        projectId: focus.projectId,
        projectName: focus.projectName,
        unitType,
        copy: `Shall I hold a *${unitType}* at *${focus.projectName}* for you for 24 hours? Reply yes to confirm.`,
        state: { awaitingConfirm: true, unitType, projectId: focus.projectId, projectName: focus.projectName },
      };
    }
  }

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
