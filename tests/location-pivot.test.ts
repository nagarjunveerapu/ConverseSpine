import { describe, expect, it } from 'vitest';
import { extractFacts } from '../src/engine/facts.js';
import { noopEngineLlm } from '../src/engine/adapters/llm.js';
import type { ConversationState } from '../src/engine/types.js';

/**
 * "Actually show me something in Whitefield instead" used to be ignored.
 *
 * `facts.ts` guarded location extraction with `!constraints.location &&
 * … && isSlotWritable(…)`. The first clause short-circuited, so the override
 * path was unreachable: once a location was in state, nothing the buyer typed
 * could replace it. They kept getting the old area, with no sign anything had
 * been missed.
 *
 * The SPA grew eleven regexes (`extractLooseLocationPivot`) to paper over this
 * from the browser. This fixes it where it belongs.
 */
function stateWith(location?: string): ConversationState {
  return {
    convId: 'c1',
    builderId: 'naya-advisor',
    phase: 'discover',
    turnCount: 1,
    constraints: location ? { location } : {},
    discover: { lastOffered: [], oriented: true, ignoredProbes: 0 },
  } as unknown as ConversationState;
}

/** No LLM: the pivot must work on the deterministic path alone, since that is
 *  the path a returning buyer's follow-up actually takes. */
const LLM = noopEngineLlm();
const locationOf = async (text: string, inState?: string) =>
  (await extractFacts(text, stateWith(inState), LLM)).constraints.location;

describe('an explicit override re-opens the location slot', () => {
  it('replaces a location the buyer explicitly pivots away from', async () => {
    expect(await locationOf('actually show me something in Whitefield instead', 'Devanahalli'))
      .toBe('Whitefield');
  });

  it('accepts each override word the ingress contract recognises', async () => {
    for (const phrase of [
      'actually I want Whitefield',
      'show me Whitefield instead',
      'change to Whitefield',
      'switch to Whitefield',
    ]) {
      expect(await locationOf(phrase, 'Devanahalli'), phrase).toBe('Whitefield');
    }
  });
});

describe('the guard still holds where it should', () => {
  it('does NOT clear a good location when the override carries no place', async () => {
    // "actually, change something" is an override word with nothing to put in
    // the slot. Emptying the location here would be worse than ignoring it.
    expect(await locationOf('actually can you change something', 'Devanahalli'))
      .toBeUndefined();
  });

  it('does NOT drift the location on an ordinary follow-up', async () => {
    // No override word: a passing mention must not silently re-target the
    // search. This is the behaviour the original guard was protecting.
    expect(await locationOf('what is the price', 'Devanahalli')).toBeUndefined();
  });

  it('still fills an empty slot with no override word needed', async () => {
    expect(await locationOf('3 BHK in Whitefield')).toBe('Whitefield');
  });
});
