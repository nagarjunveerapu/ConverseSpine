/**
 * Adversarial cracks: sticky focus + split_day same-day force (live dig transcript).
 * Expand when a new phrasing soft-exits visit or keeps a sticky pack on hub asks.
 */
import { describe, expect, it } from 'vitest';
import { isCompareAmongOfferedTurn } from '../src/engine/turn-intent/compare-intent.js';
import { decide, shouldExitVisitForIntent } from '../src/engine/phases/visit.js';
import { initState } from '../src/engine/state.js';

const now = new Date('2026-07-06T10:00:00+05:30');

function splitVisit(overrides: Record<string, unknown> = {}) {
  return {
    ...initState('t', 'brigade-group'),
    phase: 'visit' as const,
    focus: { projectId: 'orchards', projectName: 'Brigade Orchards' },
    visit: {
      projectId: 'orchards',
      projectName: 'Brigade Orchards',
      queued: [{ projectId: 'cornerstone-utopia', projectName: 'Brigade Cornerstone Utopia' }],
      lastAsk: 'split_day' as const,
      splitOffered: true,
      originText: 'Anantapur',
      originAsked: true,
      tripOrdered: true,
      ...overrides,
    },
  };
}

const FALSE_COMPARE = {
  constraints: {},
  askTopic: 'compare' as const,
  compareProjectIds: ['orchards', 'cornerstone-utopia'],
};

describe('ADX: hub compare phrasing (must not stay focused overview)', () => {
  const hub = [
    'which location is better?',
    'which area is better?',
    'which is better Cornerstone or Eldorado?',
    'Cornerstone or Eldorado which is better',
    'which side is better for me?',
    'what location is better?',
    'compare these two on location',
  ];
  for (const text of hub) {
    it(`compare-among-offered: ${text}`, () => {
      expect(isCompareAmongOfferedTurn(text)).toBe(true);
    });
  }

  it('focused facet asks stay out of compare-among-offered', () => {
    expect(isCompareAmongOfferedTurn('Starting prices for Brigade Cornerstone')).toBe(false);
    expect(isCompareAmongOfferedTurn('Legal status for Brigade Orchards')).toBe(false);
    expect(isCompareAmongOfferedTurn('Tell me about Brigade Orchards')).toBe(false);
  });
});

describe('ADX: split_day soft-exit hold (false compare / wantsMore)', () => {
  const stay = [
    'I want to plan for both on the same day',
    'same day',
    'the same day please',
    'both same day',
    'all same day',
    'force all same day',
    'force same day',
    'lets do both on the same day',
    'plan both same day',
    'OK',
    'yes',
    'next day',
    'different day',
    'split is fine',
  ];

  for (const text of stay) {
    it(`stays in visit on: ${text}`, () => {
      expect(
        shouldExitVisitForIntent(FALSE_COMPARE, text, undefined, splitVisit().visit),
      ).toBe(false);
    });
  }

  it('still soft-exits real compare digression mid split_day', () => {
    expect(
      shouldExitVisitForIntent(
        FALSE_COMPARE,
        'compare Eldorado and Orchards on price',
        undefined,
        splitVisit().visit,
      ),
    ).toBe(true);
  });
});

describe('ADX: decide force path — never digress to answer/media', () => {
  const forcePhrases = [
    'I want to plan for both on the same day',
    'both on the same day',
    'same day',
    'force all same day',
    'lets do both same day',
    'dono same day please',
    'donon same day',
  ];

  for (const text of forcePhrases) {
    it(`decide stays on visit goals for: ${text}`, () => {
      const goal = decide(splitVisit(), { constraints: {}, transition: 'none' }, {
        text,
        now,
        siteVisitHours: 'Mon–Sun, 9am–7pm',
        driveFromPriorMin: 180,
      });
      expect(goal.kind).not.toBe('answer');
      expect(['visit_propose', 'visit_ask', 'visit_booked']).toContain(goal.kind);
      if (goal.kind === 'visit_propose' || goal.kind === 'visit_ask' || goal.kind === 'visit_booked') {
        expect(goal.state.preferredDayHint === 'same_forced' || goal.state.splitOffered === false).toBe(
          true,
        );
        expect(String(goal.copy ?? '').toLowerCase()).not.toMatch(/brochure/);
      }
    });
  }

  it('accept split → preferredDayHint next, still visit_ask', () => {
    const goal = decide(splitVisit(), { constraints: {}, transition: 'none' }, {
      text: 'OK next day is fine',
      now,
      siteVisitHours: 'Mon–Sun, 9am–7pm',
      driveFromPriorMin: 180,
    });
    expect(goal.kind).not.toBe('answer');
    if (goal.kind === 'visit_propose' || goal.kind === 'visit_ask' || goal.kind === 'visit_booked') {
      expect(goal.state.preferredDayHint).toBe('next');
      expect(goal.state.splitOffered).toBe(false);
    }
  });
});

describe('ADX: hardened natural force after split offer', () => {
  const force = [
    'do both today',
    'one day for both',
    "don't split",
    'no need to split',
    'force it',
    'squeeze both in',
    'back to back same trip',
    'dono same day please',
    "don't split — I want both same day",
  ];

  for (const text of force) {
    it(`forces same day (not accept-split / not soft-exit): ${text}`, () => {
      expect(
        shouldExitVisitForIntent(FALSE_COMPARE, text, undefined, splitVisit().visit),
      ).toBe(false);
      const goal = decide(splitVisit(), { constraints: {}, transition: 'none' }, {
        text,
        now,
        siteVisitHours: 'Mon–Sun, 9am–7pm',
        driveFromPriorMin: 180,
      });
      expect(goal.kind).not.toBe('answer');
      if (goal.kind === 'visit_propose' || goal.kind === 'visit_ask' || goal.kind === 'visit_booked') {
        expect(goal.state.preferredDayHint).toBe('same_forced');
        expect(goal.state.splitOffered).toBe(false);
      }
    });
  }

  it('"split is fine" still accepts the split (next day), not force', () => {
    const goal = decide(splitVisit(), { constraints: {}, transition: 'none' }, {
      text: 'split is fine',
      now,
      siteVisitHours: 'Mon–Sun, 9am–7pm',
      driveFromPriorMin: 180,
    });
    expect(goal.kind).not.toBe('answer');
    if (goal.kind === 'visit_propose' || goal.kind === 'visit_ask' || goal.kind === 'visit_booked') {
      expect(goal.state.preferredDayHint).toBe('next');
    }
  });

  it('VISIT_EMBED_ACTS_ONLY must not block closed split_day force phrases', () => {
    const goal = decide(splitVisit(), { constraints: {}, transition: 'none' }, {
      text: 'I want to plan for both on the same day',
      now,
      siteVisitHours: 'Mon–Sun, 9am–7pm',
      driveFromPriorMin: 180,
      embedActsOnly: true,
    });
    expect(goal.kind).not.toBe('answer');
    if (goal.kind === 'visit_propose' || goal.kind === 'visit_ask' || goal.kind === 'visit_booked') {
      expect(goal.state.preferredDayHint).toBe('same_forced');
    }
  });

  it('day ask + false media/brochure stamp must NOT defer to brochure', () => {
    const goal = decide(
      splitVisit({ lastAsk: 'day', splitOffered: false, tripOrdered: true }),
      { constraints: {}, askTopic: 'media', askTopics: ['media'], transition: 'none' },
      {
        text: 'I want to plan for both on the same day',
        now,
        siteVisitHours: 'Mon–Sun, 9am–7pm',
        embedActsOnly: true,
        embedderIntentKind: 'get_brochure',
      },
    );
    expect(goal.kind).not.toBe('answer');
    if (goal.kind === 'visit_propose' || goal.kind === 'visit_ask' || goal.kind === 'visit_booked') {
      expect(goal.state.preferredDayHint).toBe('same_forced');
    }
  });

  it('day ask (no split offer / geo miss): both-same-day stays + forces, no soft-exit', () => {
    const visit = splitVisit({
      lastAsk: 'day',
      splitOffered: false,
      tripOrdered: true,
      preferredDayHint: undefined,
    }).visit;
    expect(shouldExitVisitForIntent(FALSE_COMPARE, 'I want to plan for both on the same day', undefined, visit)).toBe(
      false,
    );
    const goal = decide(
      {
        ...splitVisit({ lastAsk: 'day', splitOffered: false, tripOrdered: true }),
      },
      { constraints: {}, transition: 'none' },
      {
        text: 'I want to plan for both on the same day',
        now,
        siteVisitHours: 'Mon–Sun, 9am–7pm',
        embedActsOnly: true,
      },
    );
    expect(goal.kind).not.toBe('answer');
    if (goal.kind === 'visit_propose' || goal.kind === 'visit_ask' || goal.kind === 'visit_booked') {
      expect(goal.state.preferredDayHint).toBe('same_forced');
      expect(String(goal.copy ?? '').toLowerCase()).not.toMatch(/brochure|within ₹|no_fit|nothing in/);
    }
  });
});
