import { describe, expect, it } from 'vitest';
import { pickFocusUnit, focusUnitTypeForProject } from '../src/engine/focus-unit.js';
import {
  applyIntentRecovery,
  needsIntentRecovery,
  parseIntentRecoveryResult,
} from '../src/engine/intent-recovery.js';
import { wantsCostBreakdown } from '../src/engine/facts.js';

describe('focus-unit pin (Ivory memory)', () => {
  const units = [
    { unitType: '2 BHK (Ivory)', priceDisplay: '₹68 L', sizeDisplay: '948 sqft' },
    { unitType: '3 BHK (Ivory)', priceDisplay: '₹95 L', sizeDisplay: '1200 sqft' },
    { unitType: '3 BHK+Study (Fairmont)', priceDisplay: '₹1.1 Cr' },
  ];

  it('pins Ivory from buyer text', () => {
    const pin = pickFocusUnit('brigade-orchards', units, '2 bhk ivory if you have');
    expect(pin?.unitType).toBe('2 BHK (Ivory)');
    expect(focusUnitTypeForProject(pin, 'brigade-orchards')).toBe('2 BHK (Ivory)');
  });

  it('pins single listed unit when no text cue', () => {
    const pin = pickFocusUnit('p1', [units[0]!], undefined);
    expect(pin?.unitType).toBe('2 BHK (Ivory)');
  });
});

describe('intent recovery', () => {
  it('needs recovery when extract is empty', () => {
    expect(needsIntentRecovery({ constraints: {} }, 'thoda mehengaa lag raha hai')).toBe(true);
    // Wrong-class price topic + evaluative cue still needs recovery.
    expect(
      needsIntentRecovery(
        { constraints: {}, askTopic: 'price', askTopics: ['price'] },
        'thoda mehengaa lag raha hai',
      ),
    ).toBe(true);
    expect(
      needsIntentRecovery(
        { constraints: {}, askTopic: 'price', askTopics: ['price'] },
        "what's the price per sqft",
      ),
    ).toBe(false);
  });

  it('applies objection_price and prefer_cheaper', () => {
    const ex = applyIntentRecovery(
      { constraints: {} },
      { confidence: 'llm', labels: ['objection_price', 'prefer_cheaper'] },
    );
    expect(ex.objection).toBe(true);
    expect(ex.objectionTopic).toBe('price');
    expect(ex.transition).toBe('see_others');
  });

  it('parses JSON labels', () => {
    const r = parseIntentRecoveryResult(
      '{"labels":["visit_answer"],"confidence":"llm","abstain_reason":null}',
    );
    expect(r?.labels).toEqual(['visit_answer']);
  });
});

describe('all-in price cue', () => {
  it('matches full price with all charges', () => {
    expect(wantsCostBreakdown('full price with all charges not just bsp')).toBe(true);
  });
});
