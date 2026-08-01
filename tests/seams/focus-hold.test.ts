/**
 * THE WIRE — the intent verdict gets a vote before the subject is deleted.
 *
 * `turn.ts:343` applies an LLM classifier whose `release_focus` /
 * `broaden_constraints` deletes the conversation's subject. The embedding
 * verdict is not computed until line 927 — ~580 lines later. Measured on dev,
 * focused on Brigade Eldorado, six fresh conversations each:
 *
 *   "when is possession"           ask_delivery_timeline 0.874   kept 0/6
 *   "what is the possession date"  ask_delivery_timeline 0.880   kept 6/6
 *
 * These probes pin the CONTRACT: the wire may only ever WITHHOLD a release,
 * and must be silent everywhere else. The phrasing pair is measured live —
 * asserting it here against a fake embedder would only assert my own fixture.
 */
import { describe, expect, it } from 'vitest';
import { holdsFocusAgainstRelease } from '../../src/engine/turn-routing/focus-hold.js';
import type { TurnRoutingResult } from '../../src/engine/turn-routing/types.js';

/** The LIVE shape. The wire reads `bind`, the same field the Understanding
 *  board reads. Two earlier drafts read `embedder_score` instead and never
 *  fired in production while every unit probe passed — so this fixture is
 *  deliberately the real shape, not the convenient one. */
const bind = (intent: string, score: number): TurnRoutingResult =>
  ({
    routing: 'focused_question',
    confidence: 'embedder',
    bind: { bind_source: 'embed_intent', embed_fired: true, top_kind: intent, top_score: score },
  }) as TurnRoutingResult;

describe('the subject survives an ask about it', () => {
  it('a high-confidence answer intent contradicts the release', () => {
    const d = holdsFocusAgainstRelease(bind('ask_delivery_timeline', 0.874), true);
    expect(d.hold).toBe(true);
    expect(d.reason).toEqual({ intent: 'ask_delivery_timeline', score: 0.874, topic: 'overview' });
  });

  it('prefers the topic routing already resolved', () => {
    const routing = { ...bind('get_price', 0.9), answer_topic: 'price' } as TurnRoutingResult;
    expect(holdsFocusAgainstRelease(routing, true).reason?.topic).toBe('price');
  });

  it('holds for every answer intent the map owns', () => {
    // If a kind is in ANSWER_INTENTS but missing from INTENT_TO_TOPIC the wire
    // declines rather than defaulting to 'overview'. This asserts the two
    // tables actually agree today.
    for (const k of [
      'get_price', 'get_legal_info', 'get_availability', 'get_unit_configs',
      'get_brochure', 'get_media', 'get_amenities', 'get_location_info',
      'ask_delivery_timeline', 'get_project_info', 'ask_about_builder',
      'compute_emi', 'get_payment_plan', 'negotiate_price', 'ask_investment_return',
    ]) {
      expect(holdsFocusAgainstRelease(bind(k, 0.9), true).hold, k).toBe(true);
    }
  });
});

describe('it can only withhold a release, never cause one', () => {
  it('is inert when the flag is off', () => {
    expect(holdsFocusAgainstRelease(bind('get_price', 0.99), false).hold).toBe(false);
  });

  it('does not hold below tau_high', () => {
    // 0.77 < ROUTING_TAU_HIGH. A weak bind pinning a buyer to a project they
    // were trying to leave is a worse failure than the one being fixed.
    expect(holdsFocusAgainstRelease(bind('ask_delivery_timeline', 0.77), true).hold).toBe(false);
  });

  it('does not hold for a policy, definition or about intent, however confident', () => {
    for (const k of ['policy_investment_metric', 'definition_bhk', 'about_ai', 'policy_prohibited']) {
      expect(holdsFocusAgainstRelease(bind(k, 0.99), true).hold, k).toBe(false);
    }
  });

  it('does not hold on an unknown intent kind', () => {
    expect(holdsFocusAgainstRelease(bind('some_new_kind', 0.99), true).hold).toBe(false);
  });

  it('does not hold when routing produced no bind at all', () => {
    expect(holdsFocusAgainstRelease(undefined, true).hold).toBe(false);
    const abstain = { routing: 'focused_question', confidence: 'abstain' } as TurnRoutingResult;
    expect(holdsFocusAgainstRelease(abstain, true).hold).toBe(false);
  });

  it('does not hold when the bind carries no score', () => {
    const noScore = {
      routing: 'focused_question',
      confidence: 'embedder',
      bind: { bind_source: 'embed_intent', embed_fired: true, top_kind: 'get_price' },
    } as TurnRoutingResult;
    expect(holdsFocusAgainstRelease(noScore, true).hold).toBe(false);
  });

  it('does not hold on a REGEX bind — that is the lane being checked', () => {
    // Letting the extract lane vote on whether to trust the extract would be
    // circular, and it is the lane that produced the release.
    const regex = {
      routing: 'focused_question',
      confidence: 'rule',
      bind: { bind_source: 'regex', embed_fired: false, top_kind: 'get_price', top_score: 0.99 },
    } as TurnRoutingResult;
    expect(holdsFocusAgainstRelease(regex, true).hold).toBe(false);
  });
});
