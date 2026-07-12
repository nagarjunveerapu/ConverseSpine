import type { AnswerTopic, ConversationState, Extracted, TurnGoal } from '../types.js';

// ── Unit-hold trigger (Phase 4 launch ops) ───────────────────────────────────
// Deterministic lexical gate, same family as visit.ts's BARE_AFFIRM: an
// explicit ask to hold/reserve/block a unit. "book"-family words are excluded
// when the sentence is about a visit ("book a visit Saturday").
const HOLD_VERB = /\b(?:hold|reserve|block|book)\b/i;
const HOLD_OBJECT = /\b(?:[1-9]\s*(?:bhk|bed)|unit|flat|apartment|villa|plot|home|house|one|it)\b/i;
const VISIT_WORDS = /\b(?:visit|site|tour|appointment|slot|come|drop by)\b/i;
const BHK_OF = /([1-9])\s*(?:bhk|bed)/i;

function holdIntent(text: string): boolean {
  return HOLD_VERB.test(text) && HOLD_OBJECT.test(text) && !VISIT_WORDS.test(text);
}

/** The unit TYPE to hold: named in the ask ("2 bhk"), else the buyer's stated preference. */
function holdUnitType(text: string, s: ConversationState): string | null {
  const m = text.match(BHK_OF);
  if (m) return `${m[1]} BHK`;
  const bhk = s.constraints.bhk;
  if (bhk && /^[1-9]$/.test(bhk.trim())) return `${bhk.trim()} BHK`;
  if (bhk?.trim()) return bhk.trim();
  return null;
}

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

  // Explicit ask to hold/reserve a unit → propose (only when we can resolve
  // the TYPE; otherwise fall through and answer availability normally).
  if (text && holdIntent(text)) {
    const unitType = holdUnitType(text, s);
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
