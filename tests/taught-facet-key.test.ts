import { describe, expect, it } from 'vitest';
import { taughtFaqKey } from '../src/engine/faq-keys.js';

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
