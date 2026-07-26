/**
 * THE WIRE — the intent verdict gets a vote.
 *
 * Measured on dev before this existed, focused on Brigade Eldorado, six fresh
 * conversations per phrasing:
 *
 *   "when is possession"           sil=ask_delivery_timeline 0.874   kept 0/6
 *   "what is the possession date"  sil=ask_delivery_timeline 0.880   kept 6/6
 *
 * Same intent, same confidence, and `embedder-map.ts` had already mapped
 * `ask_delivery_timeline -> availability`. The first phrasing still went
 * shopping, because `decideGoal(s, ex, visitCtx, text)` has no routing
 * parameter and only the extract gets a vote.
 *
 * These probes pin the CONTRACT of the blade, not the phrasing: it may only
 * ever turn a lost turn into an answer, and must be inert everywhere else.
 * The phrasing pair is measured live — a unit test with a fake embedder would
 * only be asserting my own fixture.
 */
import { describe, expect, it } from 'vitest';
import { rescueFocusedAnswer } from '../../src/engine/turn-routing/goal-rescue.js';
import { initState } from '../../src/engine/state.js';
import type { ConversationState, TurnGoal } from '../../src/engine/types.js';
import type { TurnRoutingResult } from '../../src/engine/turn-routing/types.js';

const focused = (): ConversationState => ({
  ...initState('c1', 'naya-advisor'),
  focus: { projectId: 'brigade-eldorado', projectName: 'Brigade Eldorado' },
});

const bind = (intent: string, score: number): TurnRoutingResult =>
  ({ routing: 'focused_question', confidence: 'embedder', embedder_intent_kind: intent, embedder_score: score }) as TurnRoutingResult;

const RECOMMEND: TurnGoal = { kind: 'recommend' };

describe('a lost turn comes back', () => {
  it('a high-confidence answer intent on a focused project answers instead of shopping', () => {
    const r = rescueFocusedAnswer(RECOMMEND, bind('ask_delivery_timeline', 0.874), focused(), true);
    expect(r.goal).toEqual({ kind: 'answer', topic: 'availability', projectId: 'brigade-eldorado' });
    expect(r.rescued).toEqual({ intent: 'ask_delivery_timeline', score: 0.874, topic: 'availability' });
  });

  it('uses the topic routing already resolved when it carries one', () => {
    const routing = { ...bind('get_price', 0.9), answer_topic: 'price' } as TurnRoutingResult;
    expect(rescueFocusedAnswer(RECOMMEND, routing, focused(), true).goal).toMatchObject({ topic: 'price' });
  });

  it('returns no requires — the caller runs the same answer contract as any other goal', () => {
    // Skipping that would let a rescued turn invent a fact instead of declining.
    const r = rescueFocusedAnswer(RECOMMEND, bind('get_price', 0.9), focused(), true);
    expect(r.goal).not.toHaveProperty('requires');
  });
});

describe('it cannot make anything worse', () => {
  it('is inert when the flag is off', () => {
    expect(rescueFocusedAnswer(RECOMMEND, bind('get_price', 0.99), focused(), false).rescued).toBeUndefined();
  });

  it('never touches a goal that already resolved', () => {
    // The whole safety argument: it only ever fires on the shortlist, so a turn
    // that answers today cannot change.
    const answer: TurnGoal = { kind: 'answer', topic: 'price', projectId: 'p1' };
    for (const g of [answer, { kind: 'greet' } as TurnGoal, { kind: 'visit_recall' } as TurnGoal]) {
      expect(rescueFocusedAnswer(g, bind('get_price', 0.99), focused(), true).goal).toBe(g);
    }
  });

  it('does not fire without a focus — there is no project to answer about', () => {
    const cold = initState('c1', 'naya-advisor');
    expect(rescueFocusedAnswer(RECOMMEND, bind('get_price', 0.99), cold, true).rescued).toBeUndefined();
  });

  it('does not fire below tau_high', () => {
    // 0.77 < ROUTING_TAU_HIGH. A weak bind overriding a shortlist would be a
    // worse failure than the one being fixed — the buyer gets projects today.
    expect(rescueFocusedAnswer(RECOMMEND, bind('ask_delivery_timeline', 0.77), focused(), true).rescued).toBeUndefined();
  });

  it('does not fire for a policy or definition intent, however confident', () => {
    for (const k of ['policy_investment_metric', 'definition_bhk', 'about_ai', 'policy_prohibited']) {
      expect(rescueFocusedAnswer(RECOMMEND, bind(k, 0.99), focused(), true).rescued).toBeUndefined();
    }
  });

  it('does not fire on an unknown intent kind', () => {
    expect(rescueFocusedAnswer(RECOMMEND, bind('some_new_kind', 0.99), focused(), true).rescued).toBeUndefined();
  });

  it('does not fire when routing produced no bind at all', () => {
    expect(rescueFocusedAnswer(RECOMMEND, undefined, focused(), true).rescued).toBeUndefined();
    const noScore = { routing: 'focused_question', confidence: 'abstain' } as TurnRoutingResult;
    expect(rescueFocusedAnswer(RECOMMEND, noScore, focused(), true).rescued).toBeUndefined();
  });
});

describe('every answer intent the map owns can actually rescue', () => {
  it('resolves a topic for each — an intent with no topic must not fire', () => {
    // If a kind is in ANSWER_INTENTS but missing from INTENT_TO_TOPIC, the
    // rescue silently declines rather than defaulting to 'overview'. This
    // asserts the two tables actually agree today.
    const kinds = ['get_price', 'get_legal_info', 'get_availability', 'get_unit_configs',
      'get_brochure', 'get_media', 'get_amenities', 'get_location_info', 'ask_delivery_timeline',
      'get_project_info', 'ask_about_builder', 'compute_emi', 'get_payment_plan',
      'negotiate_price', 'ask_investment_return'];
    for (const k of kinds) {
      expect(rescueFocusedAnswer(RECOMMEND, bind(k, 0.9), focused(), true).rescued, k).toBeDefined();
    }
  });
});
