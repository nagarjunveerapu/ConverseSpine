import { describe, expect, it } from 'vitest';
import { speakStickyClarify } from '../src/engine/clarify-outstanding.js';
import { decide as discoverDecide } from '../src/engine/phases/discover.js';
import { initState } from '../src/engine/state.js';
import { buildComposeRequest, fallbackReply } from '../src/engine/compose.js';

describe('speakStickyClarify', () => {
  it('discover: re-anchors to missing brief slots', () => {
    const copy = speakStickyClarify({ phase: 'discover', constraints: {} });
    expect(copy).toMatch(/couldn't make sense/i);
    expect(copy).toMatch(/locality|budget|BHK/i);
  });

  it('discover: filled brief does not hardcode locality/budget/BHK', () => {
    const copy = speakStickyClarify({
      phase: 'discover',
      constraints: { location: 'Whitefield', budgetMaxInr: 8_000_000, bhk: '3 BHK' },
    });
    expect(copy).toMatch(/couldn't make sense/i);
    expect(copy).not.toMatch(/locality, budget, or BHK/);
    expect(copy).not.toMatch(/please share your/i);
  });

  it('focused legal: sticky to RERA/OC', () => {
    const copy = speakStickyClarify({
      phase: 'focused',
      focusName: 'Ayana',
      priorTopics: ['legal'],
    });
    expect(copy).toMatch(/Still on legal for \*Ayana\*/);
    expect(copy).toMatch(/RERA/);
  });

  it('visit origin: starting area', () => {
    const copy = speakStickyClarify({
      phase: 'visit',
      visit: { lastAsk: 'origin', originAsked: true, projectId: 'a', projectName: 'Ayana' },
    });
    expect(copy).toMatch(/starting area/i);
  });
});

describe('discover noise → sticky clarify', () => {
  it('gibberish after greet clarifies requirements, does not re-orient', () => {
    const s = { ...initState('t', 'lokations'), turnCount: 1 };
    const goal = discoverDecide(s, { constraints: {} }, '3dsfoisuardo');
    expect(goal.kind).toBe('clarify_intent');
    const draft = fallbackReply(
      buildComposeRequest(goal, { tools: [] }, {
        constraints: {},
        alreadyShownSameSet: false,
        builderName: 'Lokations',
      }),
    );
    expect(draft).toMatch(/couldn't make sense/i);
    expect(draft).toMatch(/property|locality|budget|BHK/i);
  });
});
