import { describe, expect, it } from 'vitest';
import { extractLocation } from '../src/engine/facts.js';
import { speakStickyClarify } from '../src/engine/clarify-outstanding.js';
import { isAskNextStepText } from '../src/engine/ask-next-step-detect.js';
import { isPlausiblePlaceLabel } from '../src/engine/placeability.js';
import { buildComposeRequest, fallbackReply } from '../src/engine/compose.js';
import { decide as discoverDecide } from '../src/engine/phases/discover.js';
import { initState } from '../src/engine/state.js';

describe('recall_constraints', () => {
  it('discover routes prefs recall before recommend/overview', () => {
    const s = {
      ...initState('t', 'brigade-group'),
      turnCount: 2,
      constraints: {
        location: 'North Bangalore',
        budgetMaxInr: 10_000_000,
        bhk: '2 BHK',
        purpose: 'self_use' as const,
      },
      discover: { oriented: true, ignoredProbes: 0, asked: {} },
    };
    const goal = discoverDecide(
      s,
      {
        constraints: {},
        recallConstraints: true,
        transition: 'none',
      },
      'wait what was my budget again and which area did I pick?',
    );
    expect(goal.kind).toBe('recall_constraints');
  });

  it('compose echoes brief slots, not a project overview', () => {
    const draft = fallbackReply(
      buildComposeRequest(
        { kind: 'recall_constraints' },
        { tools: [] },
        {
          constraints: {
            location: 'North Bangalore',
            budgetMaxInr: 10_000_000,
            bhk: '2 BHK',
          },
          alreadyShownSameSet: false,
          builderName: 'Naya Advisor',
          channel: 'advisor_web',
        },
      ),
    );
    expect(draft).toMatch(/North Bangalore/i);
    expect(draft).toMatch(/1\s*Cr|₹1/i);
    expect(draft).toMatch(/2 BHK/i);
    expect(draft).not.toMatch(/Eldorado/i);
  });
});

describe('location extract — chip chrome', () => {
  it('keeps Whitefield and drops ignore-the-chip tail', () => {
    expect(extractLocation('actually looking in Whitefield instead — ignore the chip')).toBe(
      'Whitefield',
    );
  });

  it('rejects open the board as a locality', () => {
    expect(extractLocation('open the board')).toBeUndefined();
    expect(isPlausiblePlaceLabel('the board')).toBe(false);
  });
});

describe('sticky clarify — filled brief', () => {
  it('does not invent locality/budget/BHK when hard slots are filled', () => {
    const copy = speakStickyClarify({
      phase: 'discover',
      constraints: {
        location: 'North Bangalore',
        budgetMaxInr: 10_000_000,
        bhk: '2 BHK',
      },
    });
    expect(copy).toBeTruthy();
    expect(copy).not.toMatch(/share your locality/i);
    expect(copy).not.toMatch(/locality, budget, or BHK/i);
    expect(copy).toMatch(/brief|matches|name/i);
  });
});

describe('ask_next_step board chrome', () => {
  it('treats open the board as next-step, not a place ask', () => {
    expect(isAskNextStepText('open the board')).toBe(true);
    expect(isAskNextStepText('show shortlist')).toBe(true);
  });
});
