import { describe, expect, it } from 'vitest';
import * as discover from '../src/engine/phases/discover.js';
import { initState } from '../src/engine/state.js';
import { buildComposeRequest, fallbackReply } from '../src/engine/compose.js';
import type { Extracted } from '../src/engine/types.js';

/**
 * Below-threshold routing. When the engine cannot route what the buyer asked,
 * the remaining fallbacks (greet / orient / an objection with zero reframe
 * angles) all have GENERATIVE compose contracts, so reaching them empty-handed
 * is what made the bot invent. Three live failures this guards:
 *
 *   "is my money safe with this builder?"  -> "Hey there! 👋 Welcome to Naya Advisor"
 *   "will prices go up next year?"         -> portfolio pitch + invented
 *                                             "great choice going for an investment property"
 *   "something green near the hills"       -> read as a location objection, answered with
 *                                             "the hills offer better views and natural cooling"
 *
 * Recognition coverage is raised in the embedding lane; this is the floor for
 * when coverage misses — ask, never guess.
 */
function ex(over: Partial<Extracted> = {}): Extracted {
  return { constraints: {}, ...over } as Extracted;
}

describe('below-threshold clarify_intent', () => {
  it('an unrouted question on turn 0 asks instead of greeting', () => {
    const s = initState('c1', 'naya-advisor'); // turnCount 0
    expect(discover.decide(s, ex({ isQuestion: true }))).toMatchObject({ kind: 'clarify_intent' });
  });

  it('an unrouted question later asks instead of pitching the portfolio', () => {
    const s = { ...initState('c1', 'naya-advisor'), turnCount: 3 };
    expect(discover.decide(s, ex({ isQuestion: true }))).toMatchObject({ kind: 'clarify_intent' });
  });

  it('still greets a genuine opener that asked nothing', () => {
    const s = initState('c1', 'naya-advisor');
    expect(discover.decide(s, ex())).toMatchObject({ kind: 'greet' });
  });

  it('smalltalk is understood, not a miss', () => {
    const s = { ...initState('c1', 'naya-advisor'), turnCount: 2 };
    expect(discover.decide(s, ex({ isQuestion: true, smalltalk: true }))).not.toMatchObject({
      kind: 'clarify_intent',
    });
  });

  it('a question we DID route never reaches the clarify fallback', () => {
    const s = { ...initState('c1', 'naya-advisor'), turnCount: 2 };
    const goal = discover.decide(s, ex({ isQuestion: true, askTopic: 'price' }));
    expect(goal).not.toMatchObject({ kind: 'clarify_intent' });
  });

  it('a narrowing constraint still wins — search beats clarifying', () => {
    const s = {
      ...initState('c1', 'naya-advisor'),
      constraints: { bhk: '3 BHK', location: 'Devanahalli' },
    };
    expect(discover.decide(s, ex({ isQuestion: true }))).toMatchObject({ kind: 'recommend' });
  });

  it('the reply asserts nothing — no figures, no places, no claims', () => {
    const out = fallbackReply(
      buildComposeRequest(
        { kind: 'clarify_intent' },
        { tools: [] },
        { constraints: {}, alreadyShownSameSet: false, builderName: 'Naya' },
      ),
    );
    expect(out).toMatch(/\?$/); // ends in a question
    expect(out).not.toMatch(/₹|\d/); // no prices, no numbers
    expect(out).toMatch(/rather get that right than guess/i);
  });
});
