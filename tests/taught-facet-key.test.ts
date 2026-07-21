import { describe, expect, it } from 'vitest';
import { taughtFaqKey } from '../src/engine/faq-keys.js';
import { classifyTurnRouting } from '../src/engine/turn-routing/classify.js';

const BOUND = {
  routing: 'answer_on_project',
  embedder_facet: 'resale_value',
  bind: { bind_source: 'embed_intent' },
} as const;

describe('taughtFaqKey — taught facet → FAQ key, every deterministic lane wins', () => {
  it('a ≥τ embed bind carrying a taught facet returns the key', () => {
    expect(taughtFaqKey(BOUND, 'can i sell the plot later?')).toBe('resale_value');
  });

  it('text-bound FAQ keys disable the taught key entirely', () => {
    // "possession" binds its own key deterministically — the taught facet
    // must never override what the buyer's words already pinned.
    expect(taughtFaqKey(BOUND, 'when is possession?')).toBeUndefined();
  });

  it('only an embed_intent bind counts — regex/none lanes carry no teach', () => {
    expect(
      taughtFaqKey({ ...BOUND, bind: { bind_source: 'regex' } }, 'can i sell it?'),
    ).toBeUndefined();
    expect(taughtFaqKey({ ...BOUND, bind: undefined }, 'can i sell it?')).toBeUndefined();
  });

  it('only answer routings consume a facet (search/visit binds do not)', () => {
    expect(
      taughtFaqKey({ ...BOUND, routing: 'search_pivot' }, 'can i sell it?'),
    ).toBeUndefined();
    expect(taughtFaqKey(undefined, 'can i sell it?')).toBeUndefined();
  });

  it('index noise is rejected — empty, off-format, oversize facets', () => {
    expect(taughtFaqKey({ ...BOUND, embedder_facet: '' }, 'x')).toBeUndefined();
    expect(taughtFaqKey({ ...BOUND, embedder_facet: undefined }, 'x')).toBeUndefined();
    expect(taughtFaqKey({ ...BOUND, embedder_facet: 'Resale Value!' }, 'x')).toBeUndefined();
    expect(taughtFaqKey({ ...BOUND, embedder_facet: 'x'.repeat(61) }, 'x')).toBeUndefined();
  });
});

describe('score-tie arbitration — the facet-carrying teach wins', () => {
  it('identical phrasings taught under several doors: equal score, the copy with a facet binds', async () => {
    // Live dev showed this: "ameneties?" taught on three doors, only one copy
    // carries the facet, and Vectorize returns the twins at the same score.
    const env = {
      AI: { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) },
      INTENT_VECTORS: {
        query: async () => ({
          matches: [
            { id: 'ph_other_door', score: 0.89, metadata: { intent_kind: 'get_amenities' } },
            { id: 'ph_this_door', score: 0.89, metadata: { intent_kind: 'get_amenities', facet: 'amenities' } },
          ],
        }),
      },
    };
    const result = await classifyTurnRouting(env as never, {
      text: 'ameneties?',
      builder_id: 'naya-advisor',
      phase: 'focused',
      named_project_ids: [],
    });
    expect(result.routing).toBe('answer_on_project');
    expect(result.embedder_facet).toBe('amenities');
    expect(result.bind?.facet).toBe('amenities');
  });
});
