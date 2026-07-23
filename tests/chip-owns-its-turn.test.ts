import { describe, expect, it } from 'vitest';
import { classifyTurnRouting } from '../src/engine/turn-routing/classify.js';
import { buildTurnRoutingInput } from '../src/engine/turn-routing/types.js';
import type { TurnRoutingInput } from '../src/engine/turn-routing/types.js';
import type { ConversationState, Extracted } from '../src/engine/types.js';

/**
 * A chip tap is a BUTTON with a constant payload. Its meaning is decided at the
 * source, so the deterministic lane owns it and the embedding never runs.
 *
 * This is not the regex gate coming back. The old gate inspected the TEXT and
 * pre-empted the embedding on free speech. This keys on the input SOURCE — a
 * fact the SPA carries (`action_id`) — and applies only where a human never
 * composed a sentence. Free text still goes to the embedding first.
 */
/** Embed-first env with a live-shaped embedder that finds nothing — so a free
 *  text turn genuinely REACHES the embedding and then falls through, which is
 *  what distinguishes it from a chip turn that never got there. */
const ON = {
  SIL_EMBED_FIRST: 'true',
  AI: { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) },
  INTENT_VECTORS: { query: async () => ({ matches: [] }) },
} as never;

const base: TurnRoutingInput = {
  text: 'what is the price',
  builder_id: 'naya-advisor',
  phase: 'discover',
  named_project_ids: [],
};

describe('chip turns never reach the embedding', () => {
  it('a chip tap resolves deterministically and does not fire the embedder', async () => {
    const r = await classifyTurnRouting(ON, { ...base, input_source: 'chip' });
    expect(r.bind?.embed_fired).toBe(false);
    expect(r.bind?.embed_gate).toBe('chip');
    expect(r.bind?.bind_source).not.toBe('embed_intent');
  });

  it('the SAME text as free text is NOT short-circuited', async () => {
    // Same words, different door. This is the guard that stops the chip lane
    // quietly becoming a text gate: if this ever reports gate 'chip', the
    // branch has started keying on words instead of provenance.
    const r = await classifyTurnRouting(ON, { ...base, input_source: 'free_text' });
    expect(r.bind?.embed_gate).not.toBe('chip');
  });

  it('an unlabelled turn is treated as free text, never as a chip', async () => {
    // Absent provenance must fail toward the embedding, not away from it —
    // otherwise a caller that forgets to label silently loses understanding.
    const r = await classifyTurnRouting(ON, base);
    expect(r.bind?.embed_gate).not.toBe('chip');
  });
});

describe('buildTurnRoutingInput carries the source', () => {
  const state = {
    builderId: 'naya-advisor',
    phase: 'discover',
    discover: { lastOffered: [] },
  } as unknown as ConversationState;
  const ex = { constraints: {} } as Extracted;

  it('threads chip through so routing can see it', () => {
    expect(buildTurnRoutingInput(state, ex, 'hi', 'chip').input_source).toBe('chip');
    expect(buildTurnRoutingInput(state, ex, 'hi', 'free_text').input_source).toBe('free_text');
  });

  it('omits it when the caller has none rather than inventing one', () => {
    expect(buildTurnRoutingInput(state, ex, 'hi').input_source).toBeUndefined();
  });
});
