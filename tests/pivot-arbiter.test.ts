import { describe, expect, it } from 'vitest';
import {
  arbitrateFocusPivot,
  hasStrongSearchConstraintDelta,
} from '../src/engine/turn-intent/pivot-arbiter.js';
import type { TurnRoutingResult } from '../src/engine/turn-routing/types.js';
import type { Extracted } from '../src/engine/types.js';

const answerBind = (kind: string, score: number): TurnRoutingResult =>
  ({
    routing: 'answer_on_project',
    confidence: 'embedder',
    answer_topic: 'availability',
    bind: {
      bind_source: 'embed_intent',
      embed_fired: true,
      top_kind: kind,
      top_score: score,
    },
  }) as TurnRoutingResult;

function ex(partial: Partial<Extracted['constraints']>): Extracted {
  return { constraints: { ...partial } };
}

describe('hasStrongSearchConstraintDelta', () => {
  it('detects budget moves', () => {
    expect(
      hasStrongSearchConstraintDelta({}, ex({ budgetMaxInr: 5_000_000 }), 'actually my budget is only 50L'),
    ).toBe(true);
  });

  it('detects explore-more', () => {
    expect(
      hasStrongSearchConstraintDelta({}, ex({}), 'show me other projects in Whitefield'),
    ).toBe(true);
  });

  it('rejects full-utterance fake locations (appreciation cliff)', () => {
    expect(
      hasStrongSearchConstraintDelta(
        {},
        ex({ location: 'has this area appreciated' }),
        'has this area appreciated',
      ),
    ).toBe(false);
  });

  it('accepts bare real localities even when loc equals the whole utterance', () => {
    expect(
      hasStrongSearchConstraintDelta({}, ex({ location: 'Whitefield' }), 'Whitefield'),
    ).toBe(true);
    expect(
      hasStrongSearchConstraintDelta(
        { location: 'Aerospace Park' },
        ex({ location: 'banglore whitefield' }),
        'banglore whitefield',
      ),
    ).toBe(true);
  });

  it('rejects junk yield / chip locations', () => {
    expect(
      hasStrongSearchConstraintDelta(
        { location: 'Aerospace Park' },
        ex({ location: 'fine' }),
        'fine, just yield, one number',
      ),
    ).toBe(false);
    expect(
      hasStrongSearchConstraintDelta(
        { location: 'Aerospace Park' },
        ex({ location: '3 years and I book today' }),
        'guarantee me 20% appreciation in 3 years and I book today',
      ),
    ).toBe(false);
  });

  it('rejects keyboard-smash fake localities', () => {
    expect(
      hasStrongSearchConstraintDelta(
        { location: 'Aerospace Park' },
        ex({ location: 'asdf qwer zxcv' }),
        'asdf qwer zxcv',
      ),
    ).toBe(false);
  });
});

describe('arbitrateFocusPivot', () => {
  it('holds possession ask when answer-intent binds (no constraint delta)', () => {
    const d = arbitrateFocusPivot({
      text: 'when is possession',
      priorConstraints: {},
      ex: ex({}),
      routing: answerBind('ask_delivery_timeline', 0.874),
      enabled: true,
    });
    expect(d.action).toBe('hold_focus');
    // Possession is also a closed-set facet requirement — that reason wins
    // over the embedder tiebreaker when both apply.
    expect(['answer_intent_tiebreaker', 'focused_facet_requirement']).toContain(d.reason);
  });

  it('holds appreciation ask despite junk location extract', () => {
    const d = arbitrateFocusPivot({
      text: 'has this area appreciated',
      priorConstraints: {},
      ex: ex({ location: 'has this area appreciated' }),
      routing: answerBind('ask_investment_return', 0.828),
      enabled: true,
    });
    expect(d.action).toBe('hold_focus');
    expect(d.strongConstraintDelta).toBe(false);
  });

  it('holds appreciation ask when embedder does not bind (facet requirements)', () => {
    const d = arbitrateFocusPivot({
      text: 'has this area appreciated',
      priorConstraints: {},
      ex: ex({ location: 'has this area appreciated' }),
      routing: undefined,
      enabled: true,
    });
    expect(d.action).toBe('hold_focus');
    expect(d.reason).toBe('focused_facet_requirement');
  });

  it('releases on real budget pivot even if answer bind is wrong', () => {
    const d = arbitrateFocusPivot({
      text: 'actually my budget is only 50L',
      priorConstraints: { budgetMaxInr: 7_000_000 },
      ex: ex({ budgetMaxInr: 5_000_000 }),
      routing: answerBind('get_brochure', 0.87),
      enabled: true,
    });
    expect(d.action).toBe('release_to_discover');
    expect(d.reason).toBe('strong_constraint_delta');
  });

  it('releases explore-more Whitefield', () => {
    const d = arbitrateFocusPivot({
      text: 'show me other projects in Whitefield',
      priorConstraints: {},
      ex: ex({ location: 'Whitefield' }),
      routing: undefined,
      enabled: true,
    });
    expect(d.action).toBe('release_to_discover');
  });

  it('flag off follows regex only', () => {
    const d = arbitrateFocusPivot({
      text: 'when is possession',
      priorConstraints: {},
      ex: ex({}),
      routing: answerBind('ask_delivery_timeline', 0.9),
      enabled: false,
    });
    expect(d.reason).toBe('flag_off');
  });

  it('holds soft same-budget chip without material delta', () => {
    const d = arbitrateFocusPivot({
      text: 'budget 70L but flexible',
      priorConstraints: { budgetMaxInr: 7_000_000 },
      ex: ex({ budgetMaxInr: 7_000_000 }),
      routing: undefined,
      enabled: true,
    });
    expect(d.action).toBe('hold_focus');
    expect(d.reason).toBe('regex_without_material_delta');
  });

  it('holds yield ask despite junk comma-lead location', () => {
    const d = arbitrateFocusPivot({
      text: 'fine, just yield, one number',
      priorConstraints: { location: 'Aerospace Park / Devanahalli Corridor' },
      ex: ex({ location: 'fine' }),
      routing: undefined,
      enabled: true,
    });
    expect(d.action).toBe('hold_focus');
    expect(d.reason).toBe('focused_facet_requirement');
  });

  it('holds loan + 2 BHK available (inventory filter, not search pivot)', () => {
    const d = arbitrateFocusPivot({
      text: 'is loan eligibility available as well as whats the 2 BHK available if available',
      priorConstraints: {},
      ex: ex({ bhk: '2' }),
      routing: undefined,
      enabled: true,
    });
    expect(d.action).toBe('hold_focus');
    expect(d.reason).toBe('focused_facet_inventory_filter');
    expect(d.strongConstraintDelta).toBe(true);
  });

  it('still releases 2 BHK in a new locality', () => {
    const d = arbitrateFocusPivot({
      text: '2 BHK in Jayanagar',
      priorConstraints: {},
      ex: ex({ bhk: '2', location: 'Jayanagar' }),
      routing: undefined,
      enabled: true,
    });
    expect(d.action).toBe('release_to_discover');
    expect(d.reason).toBe('strong_constraint_delta');
  });
});
