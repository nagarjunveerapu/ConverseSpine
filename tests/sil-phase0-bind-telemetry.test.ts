import { describe, expect, it } from 'vitest';
import { classifyTurnRouting } from '../src/engine/turn-routing/classify.js';
import type { TurnRoutingInput } from '../src/engine/turn-routing/types.js';

/**
 * SIL Phase 0 — bind_source telemetry (SEMANTIC_INTENT_LAYER_LLD §3.3).
 * Every classifyTurnRouting path must stamp `bind` so the fire-rate and the
 * gate that suppressed the embedder are measurable per turn. The routing
 * DECISION itself is unchanged in Phase 0 — these tests pin that too.
 */

function baseInput(text: string, overrides: Partial<TurnRoutingInput> = {}): TurnRoutingInput {
  return {
    text,
    builder_id: 'naya',
    phase: 'discover',
    named_project_ids: [],
    ...overrides,
  };
}

function fakeEnv(matches: { id: string; score: number; intent_kind: string }[]) {
  return {
    AI: {
      run: async () => ({ data: [[0.1, 0.2, 0.3]] }),
    },
    INTENT_VECTORS: {
      query: async () => ({
        matches: matches.map((m) => ({
          id: m.id,
          score: m.score,
          metadata: { intent_kind: m.intent_kind },
        })),
      }),
    },
    // classifyTurnRouting only touches AI.run and INTENT_VECTORS.query.
  } as never;
}

describe('SIL Phase 0 — bind telemetry stamps every path', () => {
  it('a known speech act gates the embedder and says so (act_known, not silent)', async () => {
    const r = await classifyTurnRouting(
      fakeEnv([]),
      baseInput('tell me more', { speech_act: 'affirm' }),
    );
    expect(r.bind).toEqual({ bind_source: 'none', embed_fired: false, embed_gate: 'act_known' });
  });

  it('a rule-bound turn is bind_source=regex with the gate named', async () => {
    const r = await classifyTurnRouting(
      fakeEnv([]),
      baseInput('what about pricing?', { ask_topic: 'price' }),
    );
    expect(r.bind?.bind_source).toBe('regex');
    expect(r.bind?.embed_fired).toBe(false);
    expect(['rule_bound', 'speech_act']).toContain(r.bind?.embed_gate);
  });

  it('unknown act + no rule → embedder fires; a strong match binds with score and margin', async () => {
    const env = fakeEnv([
      { id: 'v1', score: 0.91, intent_kind: 'ask_price' },
      { id: 'v2', score: 0.62, intent_kind: 'ask_visit' },
    ]);
    const r = await classifyTurnRouting(env, baseInput('whats the damage for a unit here'));
    expect(r.bind?.embed_fired).toBe(true);
    expect(r.bind?.top_kind).toBe('ask_price');
    expect(r.bind?.top_score).toBeCloseTo(0.91);
    expect(r.bind?.margin).toBeCloseTo(0.29);
    // decision path: a bound embedder result carries bind_source=embed_intent
    if (r.confidence === 'embedder') expect(r.bind?.bind_source).toBe('embed_intent');
  });

  it('embedder fires but stays below τ_high → bind_source=none, telemetry still recorded', async () => {
    const env = fakeEnv([{ id: 'v1', score: 0.41, intent_kind: 'ask_price' }]);
    const r = await classifyTurnRouting(env, baseInput('hmm something vague'));
    expect(r.routing).toBe('defer');
    expect(r.bind).toMatchObject({
      bind_source: 'none',
      embed_fired: true,
      top_kind: 'ask_price',
      top_score: 0.41,
    });
  });

  it('no routing env at all → gate recorded as no_env', async () => {
    const r = await classifyTurnRouting(undefined, baseInput('hmm something vague'));
    expect(r.bind).toEqual({ bind_source: 'none', embed_fired: false, embed_gate: 'no_env' });
  });

  it('duplicate row returned by both scope queries does not fake a zero margin', async () => {
    // same id appears in the builder-scoped and the global query
    const env = {
      AI: { run: async () => ({ data: [[0.1]] }) },
      INTENT_VECTORS: {
        query: async () => ({
          matches: [
            { id: 'dup', score: 0.9, metadata: { intent_kind: 'ask_price' } },
            { id: 'other', score: 0.7, metadata: { intent_kind: 'ask_visit' } },
          ],
        }),
      },
    } as never;
    const r = await classifyTurnRouting(env, baseInput('whats the damage'));
    // two scope queries × same rows → dedupe keeps margin = 0.9 − 0.7, not 0
    expect(r.bind?.margin).toBeCloseTo(0.2);
  });
});
