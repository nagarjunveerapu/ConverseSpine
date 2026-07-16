import { describe, it, expect } from 'vitest';
import { silDecision } from '../src/understanding/capture.js';
import { nayadeskCrm } from '../src/engine/adapters/nayadesk.js';
import type { NayaDeskClient } from '../src/crm/nayadesk-client.js';
import type { TurnRoutingResult } from '../src/engine/turn-routing/types.js';

describe('silDecision — the three lanes', () => {
  it('embed lane → top_kind + clamped score', () => {
    const routing: TurnRoutingResult = {
      routing: 'answer_question',
      confidence: 'embedder',
      bind: { bind_source: 'embed_intent', embed_fired: true, top_kind: 'get_price', top_score: 0.83 },
    } as TurnRoutingResult;
    expect(silDecision(routing)).toEqual({ intent: 'get_price', score: 0.83, bindSource: 'embed_intent' });
  });

  it('regex lane → the routed kind (no embed score)', () => {
    const routing: TurnRoutingResult = {
      routing: 'visit_schedule_stop',
      confidence: 'rule',
      bind: { bind_source: 'regex', embed_fired: false, embed_gate: 'visit_rule' },
    } as TurnRoutingResult;
    expect(silDecision(routing)).toEqual({ intent: 'visit_schedule_stop', score: 0, bindSource: 'regex' });
  });

  it('none lane → keeps the below-τ best guess for the board', () => {
    const routing: TurnRoutingResult = {
      routing: 'defer',
      confidence: 'rule',
      bind: {
        bind_source: 'none', embed_fired: true, miss_reason: 'below_tau',
        top_kind: 'get_availability', top_score: 0.71,
      },
    } as TurnRoutingResult;
    expect(silDecision(routing)).toEqual({ intent: 'get_availability', score: 0.71, bindSource: 'none' });
  });

  it('no routing / no bind → empty (excluded from the captured metric)', () => {
    expect(silDecision(undefined)).toEqual({ intent: '', score: 0, bindSource: '' });
  });

  it('score clamps to [0,1]', () => {
    const routing = {
      routing: 'defer', confidence: 'rule',
      bind: { bind_source: 'none', embed_fired: true, top_score: 1.2 },
    } as unknown as TurnRoutingResult;
    expect(silDecision(routing).score).toBe(1);
  });
});

describe('nayadeskCrm — enqueueIntentReview wiring', () => {
  function fakeClient() {
    const calls: Array<Record<string, unknown>> = [];
    return {
      calls,
      client: {
        enqueueIntentReview: async (payload: Record<string, unknown>) => {
          calls.push(payload);
          return { ok: true, queue_id: 'rq_test' };
        },
      } as unknown as NayaDeskClient,
    };
  }

  it('flag OFF (default) → the port method is absent, capture cannot fire', () => {
    const { client } = fakeClient();
    const crm = nayadeskCrm(client);
    expect(crm.enqueueIntentReview).toBeUndefined();
  });

  it('flag ON → maps to the Desk snake_case schema, never sets legacy voter fields', async () => {
    const { client, calls } = fakeClient();
    const crm = nayadeskCrm(client, { understandingCapture: true });
    expect(crm.enqueueIntentReview).toBeDefined();
    await crm.enqueueIntentReview!({
      builderId: 'lokations',
      conversationId: 'conv_1',
      buyerPhone: '+9199999',
      turnIndex: 3,
      buyerText: 'price of Brigade Oasis?',
      botReply: 'Brigade Oasis starts at ₹71L…',
      recentMessages: [{ role: 'user', text: 'hi' }, { role: 'bot', text: 'hello!' }],
      silIntent: 'get_price',
      silScore: 0.83,
      silBindSource: 'embed_intent',
      speechAct: 'ask_fact',
      language: '',
    });
    expect(calls).toHaveLength(1);
    const p = calls[0]!;
    expect(p).toMatchObject({
      builder_id: 'lokations',
      conversation_id: 'conv_1',
      buyer_phone: '+9199999',
      turn_index: 3,
      buyer_text: 'price of Brigade Oasis?',
      bot_reply: 'Brigade Oasis starts at ₹71L…',
      sil_intent: 'get_price',
      sil_score: 0.83,
      sil_bind_source: 'embed_intent',
      speech_act: 'ask_fact',
      source: 'auto_turn',
    });
    // The legacy consensus miner keys on these — they must stay unset so the
    // bot's own confidence can never auto-promote itself (no self-labeling).
    expect(p).not.toHaveProperty('embedder_intent');
    expect(p).not.toHaveProperty('embedder_confidence');
    expect(p).not.toHaveProperty('embedder_abstained');
    expect(p).not.toHaveProperty('llm_intent');
  });
});
