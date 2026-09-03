import type { AnswerTopic, ThreadState, Extracted, TurnGoal } from '../types.js';
import { currentShortlist, discourseEntities, focusedRef } from '../entity-store.js';
import { splitComposeTopics } from '../facts.js';
import { resolveFaqQuestionKeys } from '../faq-keys.js';
import { holdUnitType } from '../hold-intent.js';
import { BARE_BHK_CONFIG_RE } from '../turn-routing/intent-authority.js';
import { DECLINE } from '../turn-intent/dialogue-acts.js';
import { resolvePendingFork } from '../pending-fork.js';

/** Unique projects the buyer can honestly compare / deictically address. */
function discourseProjectCount(s: ThreadState): number {
  const ids = new Set<string>();
  for (const e of discourseEntities(s)) ids.add(e.projectId);
  for (const o of currentShortlist(s)) ids.add(o.projectId);
  const f = focusedRef(s);
  if (f) ids.add(f.projectId);
  return ids.size;
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

export function decide(s: ThreadState, ex: Extracted, text = ''): TurnGoal {
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

  if (ex.recallConstraints) return { kind: 'recall_constraints' };
  if (ex.recall) return { kind: 'visit_recall' };
  if (
    ex.emiContractV1 &&
    ex.emiPrincipalInr !== undefined &&
    (ex.askTopic === 'emi' || ex.askTopics?.includes('emi'))
  ) {
    return { kind: 'emi_calculate' };
  }
  // !ex.holdAsk: a hold ask that couldn't resolve a type still must not become
  // a visit — fall through to answer availability instead.
  if (ex.transition === 'want_visit' && !ex.holdAsk) return { kind: 'propose_visit', projectId: focus.projectId };
  if (ex.objection) return { kind: 'objection', topic: ex.objectionTopic ?? 'custom', projectId: focus.projectId };

  // Soft decline of a pending CTA / last offer — short ack + NBA, never overview
  // or legal dump (ADV-H03 / HIN-06). RTI often clears pendingPrompt on decline,
  // so also read lastReplyExcerpt for the offered fork.
  // Closed DECLINE text wins even when the embedder inventively stamped askTopics
  // (HIN-06: "nahi chahiye" → get_legal_info → legal dump).
  const lastExcerpt = s.rti?.lastReplyExcerpt ?? '';
  const closedDecline = DECLINE.test(text.trim()) || !!ex.decline;
  const declinedPendingCta =
    closedDecline &&
    !ex.isQuestion &&
    !ex.objection &&
    !ex.recall &&
    !(ex.namedProjects?.length) &&
    (s.rti?.pendingPrompt?.kind === 'offer_pricing' ||
      /\bwant (?:pricing|me to|details|loan|a (?:site )?visit|work out)\b/i.test(lastExcerpt) ||
      /\bor shall i\b/i.test(lastExcerpt) ||
      /\bwant (?:the|a) (?:configurations?|cost breakdown|payment)\b/i.test(lastExcerpt));
  if (declinedPendingCta) {
    return { kind: 'advance', reason: 'cta_decline' };
  }

  // W2 — bare affirm handling. Precedence (review note 3): RTI/chip prompts
  // outrank everything here (an advisor chip's yes belongs to RTI — guarded
  // inside bareAffirm); the just-asked hold window ranked above (hold_booked);
  // warm_ack/recall/visit/objection keep their existing priority above this.
  const bareAffirmBase =
    !!ex.affirm &&
    !ex.decline &&
    !ex.isQuestion &&
    !ex.askTopic &&
    !ex.askTopics?.length &&
    !ex.objection &&
    !ex.recall &&
    !ex.recallConstraints &&
    !(ex.namedProjects?.length);

  // The bot's own closer was a FORK, and a fork takes more answers than yes.
  // "both", "neither", "the second one", or naming a fork by word all used to
  // fall straight through to a verbatim repeat of the card that asked.
  const fork = resolvePendingFork(text, s.rti?.pendingPrompt);
  if (fork && !ex.isQuestion && !(ex.namedProjects?.length) && !ex.objection) {
    if (fork.kind === 'none') return { kind: 'advance', reason: 'cta_decline' };
    return { kind: 'answer', topic: fork.topic, projectId: focus.projectId };
  }

  // P4-CTA defense: pending offer_pricing blocks bareAffirm below, so a missed
  // RTI seedAskTopic used to fall through to overview. Consume the CTA here.
  if (bareAffirmBase && s.rti?.pendingPrompt?.kind === 'offer_pricing') {
    return {
      kind: 'answer',
      topic: s.rti.pendingPrompt.topic ?? 'price',
      projectId: focus.projectId,
    };
  }
  // Pending dropped but last reply still offered pricing — same speech act.
  if (
    bareAffirmBase &&
    !s.rti?.pendingPrompt &&
    /\bwant pricing\b/i.test(s.rti?.lastReplyExcerpt ?? '')
  ) {
    return { kind: 'answer', topic: 'price', projectId: focus.projectId };
  }

  // The nudge we sent last turn WAS a question — "Shall I set up a visit to X,
  // or hold a unit for you while you decide?" — and nothing armed a prompt for
  // it, because a visit is not an answer topic. So the yes it asked for fell
  // through to the same nudge, and the buyer said yes to it at turns 3, 10 and
  // 15 of the same conversation. A bare yes takes the first fork offered; the
  // hold stays available on the words.
  if (bareAffirmBase && !s.rti?.pendingPrompt && s.rti?.lastGoalKind === 'advance') {
    return { kind: 'propose_visit', projectId: focus.projectId };
  }

  const bareAffirm = bareAffirmBase && !s.rti?.pendingPrompt;

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
    const compareIds = ex.compareProjectIds ?? [];
    // <2 resolved compare ids AND <2 discourse projects → clarify, don't fake a compare
    // by answering overview/compare on the single focus.
    if (compareIds.length < 2 && discourseProjectCount(s) < 2) {
      return {
        kind: 'clarify_discourse',
        reason: 'need_pair_to_compare',
        projectName: focus.projectName,
      };
    }
    const pid = compareIds.length >= 2 ? compareIds[0]! : focus.projectId;
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
  // Closed size token after visit book (focused + postVisitAck) — same as visit/handoff.
  if (primary === 'overview' && BARE_BHK_CONFIG_RE.test(text.trim())) {
    primary = 'availability';
  }
  // P3-B: if extract already set a facet topic, never fall through to overview.
  if (primary === 'overview') {
    const facet =
      (ex.askTopic && FACET_TOPICS.has(ex.askTopic) ? ex.askTopic : undefined) ??
      topics.find((t) => FACET_TOPICS.has(t));
    if (facet) primary = facet;
  }
  // Taught-lane fill: the keyword lanes are typo-blind ("ameneties?" extracts
  // nothing) but the intent embedder bound a taught answer kind ≥ τ this turn
  // (lastRouting is stamped before goal selection). primary === 'overview'
  // already means extract surfaced NO facet topic (P3-B promoted any facet
  // above) — overview here is a default, not evidence, so a human-taught
  // facet bind outranks it. Every deterministic signal keeps precedence:
  // extracted facet topics above, AND a text-bound FAQ key here — "when is
  // possession?" reaches its possession FAQ through the overview path, and
  // the fill flipping it to the availability template dumped configs at the
  // buyer instead (192-Q gate row B5.1).
  const taught = s.rti?.lastRouting;
  if (
    primary === 'overview' &&
    taught?.routing === 'answer_on_project' &&
    taught.bind?.bind_source === 'embed_intent' &&
    taught.answer_topic &&
    FACET_TOPICS.has(taught.answer_topic) &&
    resolveFaqQuestionKeys(text).length === 0
  ) {
    primary = taught.answer_topic;
  }
  // Multi from extract stays; a lone overview default yields to a promoted primary
  // (taught-lane / P3-B). Never drop a real multi-set.
  // Preserve extract/taught primary order — do NOT re-sort via TOPIC_ORDER
  // (unionAskTopics), or embedder price leapfrogs location (P1 residual-22).
  let composeSet: AnswerTopic[];
  if (topics.length > 1) {
    const head = primary;
    const rest = topics.filter((t) => t !== head);
    if (head !== 'overview' && !topics.includes(head)) {
      composeSet = [head, ...rest];
    } else {
      composeSet = topics[0] === head ? topics : [head, ...rest];
    }
  } else {
    composeSet = [primary];
  }
  const { active, parked } = splitComposeTopics(composeSet);
  const chosen = active[0] ?? primary;
  return {
    kind: 'answer',
    topic: chosen,
    projectId: focus.projectId,
    ...(active.length > 1 ? { topics: active } : {}),
    ...(parked.length ? { parkedTopics: parked } : {}),
    // `overview` reached by fallback is the engine shrugging. When the buyer
    // asked something specific, say we don't have it — do not recite the card.
    ...(chosen === 'overview' && isUnrecognisedAsk(ex, text) ? { unrecognised: true } : {}),
  };
}

/** Did the buyer ASK for the overview, or is overview just where we landed? */
const OVERVIEW_REQUEST =
  /\b(?:tell me (?:about|more)|details?|overview|more info|information|about (?:this|the) (?:project|property)|kya hai|batao|full details)\b/i;

function isUnrecognisedAsk(ex: Extracted, text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // An explicit overview request, a details transition, or a bare project pick
  // all EARN the card.
  if (ex.transition === 'want_details') return false;
  if (ex.askTopic === 'overview' || ex.askTopics?.includes('overview')) return false;
  if (ex.namedProjects?.length || ex.pickName) return false;
  if (OVERVIEW_REQUEST.test(t)) return false;
  // A specific question with nothing extracted — that is a miss, not an answer.
  return ex.isQuestion === true || /\?/.test(t) || t.split(/\s+/).length >= 4;
}
