import { describe, expect, it } from 'vitest';
import { commitTo, initState } from '../src/engine/state.js';
import { extractFactsSync } from '../src/engine/facts.js';
import * as focused from '../src/engine/phases/focused.js';
import type { TurnRoutingResult } from '../src/engine/turn-routing/types.js';
import type { AnswerTopic, ConversationState } from '../src/engine/types.js';

/**
 * Taught-lane fill — a focused facet ask the keyword lanes can't read
 * ("ameneties?") must take the intent embedder's bound topic instead of
 * collapsing to an overview repeat. Deterministic extraction keeps precedence.
 */
function focusedState(): ConversationState {
  return commitTo(initState('c1', 'lokations'), 'ayana', 'Ayana');
}

function withRouting(
  s: ConversationState,
  topic: AnswerTopic,
  bindSource: 'embed_intent' | 'regex' | 'none',
): ConversationState {
  const lastRouting: TurnRoutingResult = {
    routing: 'answer_on_project',
    confidence: 'embedder',
    answer_topic: topic,
    bind: { bind_source: bindSource, embed_fired: bindSource === 'embed_intent' },
  };
  return { ...s, rti: { ...s.rti, lastRouting } };
}

describe('focused taught-lane fill', () => {
  it('typo ask + embed_intent bind → the taught facet topic, not overview', () => {
    const s = withRouting(focusedState(), 'amenities', 'embed_intent');
    const ex = extractFactsSync('ameneties?', s);
    const goal = focused.decide(s, ex, 'ameneties?');
    expect(goal).toMatchObject({ kind: 'answer', topic: 'amenities' });
  });

  it('extracted topic keeps precedence over the embedder', () => {
    const s = withRouting(focusedState(), 'amenities', 'embed_intent');
    const ex = extractFactsSync('what is the price?', s);
    const goal = focused.decide(s, ex, 'what is the price?');
    expect(goal).toMatchObject({ kind: 'answer', topic: 'price' });
  });

  it('no embed bind (below τ) → overview unchanged', () => {
    const s = withRouting(focusedState(), 'amenities', 'none');
    const ex = extractFactsSync('ameneties?', s);
    const goal = focused.decide(s, ex, 'ameneties?');
    expect(goal).toMatchObject({ kind: 'answer', topic: 'overview' });
  });

  it('a text-bound FAQ key keeps precedence — "when is possession?" stays on the overview path that serves its FAQ', () => {
    // Gate row B5.1: the fill flipping this to the availability template
    // dumped a configuration list instead of the possession answer.
    const s = withRouting(focusedState(), 'availability', 'embed_intent');
    const ex = extractFactsSync('when is possession?', s);
    const goal = focused.decide(s, ex, 'when is possession?');
    expect((goal as { topic?: string }).topic).not.toBe('availability');
  });

  it('a taught bind upgrades a generic want-details turn — overview is a default, not evidence', () => {
    // An embed bind only exists because a human taught this phrasing; the
    // overview fallback carries no signal, so the taught topic wins.
    const s = withRouting(focusedState(), 'amenities', 'embed_intent');
    const ex = extractFactsSync('tell me more', s);
    const goal = focused.decide(s, ex, 'tell me more');
    expect(goal).toMatchObject({ kind: 'answer', topic: 'amenities' });
  });
});
