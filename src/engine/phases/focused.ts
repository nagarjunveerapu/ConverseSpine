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
  // downgrades the window after the turn), mirroring the visit confirm gate.
  if (s.hold?.awaitingConfirm && ex.affirm && !ex.decline) {
    return {
      kind: 'hold_booked',
      projectId: s.hold.projectId ?? focus.projectId,
      projectName: s.hold.projectName ?? focus.projectName,
      unitType: s.hold.unitType ?? '',
    };
  }

  // Explicit ask to hold/reserve a unit — stamped as ex.holdAsk by the extract
  // funnel (hold-intent.ts). MUST rank above recall/want_visit/objection: the
  // real embedder mis-tags "hold a 2 bhk for me" as want_visit, which stole the
  // turn on dev (HOLD-01/04/05 → visit_ask). holdIntent already excludes visit
  // words, so a resolvable hold ask is unambiguous. Falls through only when the
  // TYPE can't be resolved (then it answers availability normally).
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

  if (
    s.postVisitAckPending &&
    (ex.postVisitAck || (ex.affirm && !ex.askTopic && !ex.isQuestion) || ex.smalltalk)
  ) {
    return { kind: 'warm_ack' };
  }

  if (ex.recall) return { kind: 'visit_recall' };
  // !ex.holdAsk: a hold ask that couldn't resolve a type still must not become
  // a visit — fall through to answer availability instead.
  if (ex.transition === 'want_visit' && !ex.holdAsk) return { kind: 'propose_visit', projectId: focus.projectId };
  if (ex.objection) return { kind: 'objection', topic: ex.objectionTopic ?? 'custom', projectId: focus.projectId };

  // W2 — bare affirm handling. Precedence (review note 3): RTI/chip prompts
  // outrank everything here (an advisor chip's yes belongs to RTI — guarded
  // inside bareAffirm); the just-asked hold window ranked above (hold_booked);
  // warm_ack/recall/visit/objection keep their existing priority above this.
  const bareAffirm =
    !!ex.affirm && !ex.decline && !ex.isQuestion && !ex.askTopic && !ex.askTopics?.length &&
    !ex.objection && !ex.recall && !(ex.namedProjects?.length) && !s.rti?.pendingPrompt;

  // (a) Downgraded hold offer still fresh (≤6 turns): RE-PROPOSE — never book
  // off a stale yes ("hold it → digression → yes"), per HOLD-05.
  if (
    bareAffirm &&
    s.hold && !s.hold.awaitingConfirm && s.hold.unitType &&
    s.turnCount - (s.hold.offeredAtTurn ?? 0) <= 6
  ) {
    const unitType = s.hold.unitType;
    const projectName = s.hold.projectName ?? focus.projectName;
    const asQueue = s.hold.queue === true; // W7 — a digressed waitlist offer re-offers as waitlist
    return {
      kind: 'hold_propose',
      projectId: s.hold.projectId ?? focus.projectId,
      projectName,
      unitType,
      copy: asQueue
        ? `Just to confirm — join the waitlist for the next *${unitType}* at *${projectName}*? Reply yes.`
        : `Just to confirm — hold a *${unitType}* at *${projectName}* for 24 hours? Reply yes.`,
      state: {
        awaitingConfirm: true,
        unitType,
        projectId: s.hold.projectId ?? focus.projectId,
        projectName,
        ...(asQueue ? { queue: true } : {}),
      },
    };
  }

  // (b) Bare affirm with NOTHING pending: advance the deal — never re-answer
  // the previous topic (the verbatim-repeat failure mode caught on dev).
  if (bareAffirm) {
    return { kind: 'advance', reason: 'same_set' };
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
