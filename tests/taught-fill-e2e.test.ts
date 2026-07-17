import { describe, expect, it } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';

/**
 * Full-path regression for the taught lane: a focused typo ask the keyword
 * lanes can't read ("ameneties?") + a taught vector binding ≥ τ must answer
 * the bound facet topic — never repeat the overview card (the frustration
 * loop caught in live testing Jul 16).
 */
function depsWithTaughtEmbedder() {
  const deps = fakeDeps();
  (deps as { routingEnv?: unknown }).routingEnv = {
    AI: { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) },
    INTENT_VECTORS: {
      query: async () => ({
        matches: [
          { id: 'ph_taught_1', score: 0.89, metadata: { intent_kind: 'get_amenities' } },
        ],
      }),
    },
  };
  return deps;
}

describe('taught lane end-to-end (focused typo facet ask)', () => {
  it('answers the taught topic instead of repeating the overview', async () => {
    const deps = depsWithTaughtEmbedder();
    const turn = (text: string) =>
      runEngineTurn(
        { convId: 'tf-e2e', builderId: 'lokations', text, buyerPhone: '+919999999992', channel: 'advisor_web' },
        deps,
      );
    await turn('coorg, 50 Lakhs');
    const focusTurn = await turn('tell me about Ayana');
    expect(focusTurn.state.phase).toBe('focused');

    const r = await turn('ameneties?');
    expect(r.debug.goal).toMatchObject({ kind: 'answer', topic: 'amenities' });
  });
});
