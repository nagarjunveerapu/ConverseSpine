import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyTurnRouting } from '../src/engine/turn-routing/classify.js';
import type { TurnRoutingInput } from '../src/engine/turn-routing/types.js';

/**
 * Guard: the live turn path must receive the WHOLE intent-layer config.
 *
 * `deps.routingEnv` was `Pick<Env, 'AI' | 'INTENT_VECTORS'>`. Every SIL_* var
 * was therefore undefined inside classifyTurnRouting, so the learned projection
 * applied through /api/sil/probe (which passes the full Env) and was INERT in
 * the actual bot. Nothing failed: a narrowed Pick type-checks perfectly, the
 * embedder still returned scores, they were just raw-model scores.
 *
 * This is the third instance of the same failure shape — config that exists,
 * is read somewhere, and never reaches the code path that matters.
 */
const SIL_VARS = [
  'SIL_EMBED_MODEL',
  'SIL_INTENT_PROJECTION',
  'SIL_ROUTING_TAU',
  'SIL_EMBED_FIRST',
] as const;

describe('routingEnv carries the whole intent-layer config', () => {
  it('runtime/deps.ts forwards every SIL_* var classifyTurnRouting reads', () => {
    const deps = readFileSync('src/runtime/deps.ts', 'utf8');
    const block = /routingEnv:[\s\S]*?:\s*undefined,/.exec(deps)?.[0] ?? '';
    expect(block, 'routingEnv assignment not found in deps.ts').not.toBe('');
    const missing = SIL_VARS.filter((v) => !block.includes(v));
    expect(missing, `routingEnv drops ${missing.join(', ')} — the live turn path would silently run raw`)
      .toEqual([]);
  });

  it('ports.ts types routingEnv wide enough to hold them', () => {
    const ports = readFileSync('src/engine/ports.ts', 'utf8');
    const decl = /routingEnv\?:[\s\S]*?>;/.exec(ports)?.[0] ?? '';
    const missing = SIL_VARS.filter((v) => !decl.includes(v));
    expect(missing, `routingEnv type omits ${missing.join(', ')}`).toEqual([]);
  });
});

const base: TurnRoutingInput = {
  text: 'what is the price',
  builder_id: 'naya-advisor',
  phase: 'discover',
  named_project_ids: [],
};

describe('embed-first is off by default and state rules still win', () => {
  it('without the flag, an unset env falls through to the rule ladder', async () => {
    const r = await classifyTurnRouting(undefined, base);
    expect(r.bind?.embed_gate).toBe('no_env');
    expect(r.bind?.bind_source).not.toBe('embed_intent');
  });

  it('a pending visit confirmation beats the embedding even when embed-first is on', async () => {
    // "yes" carries no recoverable meaning — only conversation state resolves
    // it. This must never be handed to a sentence embedding.
    const r = await classifyTurnRouting(
      { SIL_EMBED_FIRST: 'true' } as never,
      { ...base, text: 'yes', visit: { awaiting_confirm: true } } as TurnRoutingInput,
    );
    expect(r.routing).toBe('visit_confirm');
    expect(r.bind?.embed_fired).toBe(false);
  });
});
