import { describe, expect, it } from 'vitest';
import { detectTypeComparisonKnowledge } from '../src/engine/facts.js';
import { typeComparisonReply } from '../src/engine/compose.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';

/**
 * AB-7 — a property-TYPE knowledge ask ("apartment or plot — what's the difference?")
 * is definitional/advisory, not a search. It was dumping a project list; it must
 * answer with the generic type taxonomy instead.
 */
describe('AB-7 — detectTypeComparisonKnowledge', () => {
  it('recognises a type-difference / which-is-better ask', () => {
    expect(detectTypeComparisonKnowledge("apartment or plot - what's the difference?")).toEqual({
      types: expect.arrayContaining(['apartment', 'plot']),
      investment: false,
    });
    expect(detectTypeComparisonKnowledge('apartment or plantation - which is better for investment?')).toMatchObject({
      investment: true,
    });
    expect(detectTypeComparisonKnowledge('plot vs villa')).toMatchObject({
      types: expect.arrayContaining(['plot', 'villa']),
    });
  });

  it('is NOT triggered by a plain type search (one type, no knowledge cue)', () => {
    expect(detectTypeComparisonKnowledge('show me villas')).toBeNull();
    expect(detectTypeComparisonKnowledge('apartments in Whitefield')).toBeNull();
    expect(detectTypeComparisonKnowledge('plotted developments in North Bangalore')).toBeNull();
  });
});

describe('AB-7 — typeComparisonReply', () => {
  it('explains each asked type and never quotes a project or price', () => {
    const reply = typeComparisonReply(['apartment', 'plot'], false);
    expect(reply).toMatch(/apartment/i);
    expect(reply).toMatch(/plot/i);
    expect(reply).not.toMatch(/₹|Brigade|Ayana|Desire/);
  });
  it('adds a factual investment framing when asked', () => {
    expect(typeComparisonReply(['apartment', 'plantation'], true)).toMatch(/rental income|appreciation|crop revenue/i);
  });
});

describe('AB-7 — end-to-end: a type-knowledge ask answers, does not recommend', () => {
  it('does not dump a project list', async () => {
    const r = await runEngineTurn(
      { convId: 'ab7', builderId: 'lokations', text: "apartment or plot - what's the difference?", buyerPhone: '+919999999971' },
      fakeDeps(),
    );
    expect(r.reply).toMatch(/difference/i);
    expect(r.reply).not.toMatch(/Here's what fits/);
    expect(r.debug.goal.kind).not.toBe('recommend');
  });
});
