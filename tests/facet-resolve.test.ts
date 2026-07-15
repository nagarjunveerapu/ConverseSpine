import { describe, expect, it } from 'vitest';
import { resolveFaqQuestionKeys } from '../src/engine/faq-keys.js';
import { isInventoryAsk } from '../src/engine/facts.js';
import { fallbackReply } from '../src/engine/compose.js';
import type { ComposeRequest } from '../src/engine/types.js';

/**
 * AB-1 — the reply must lead with the exact atom the buyer asked for.
 *
 * 45% of the approved FAQ corpus was orphaned: no resolver pattern reached it, so
 * "as an NRI how can I invest?" got an overview card while the written nri_buying
 * answer sat approved in Desk. And "is there any inventory left?" answered with a
 * configuration card — on-topic, but not the availability FACT (the founder's
 * rejection case: grade the answer, not the topic).
 */
describe('AB-1 — resolver reaches the orphaned corpus', () => {
  const key1 = (t: string) => resolveFaqQuestionKeys(t)[0];

  it('binds the founder-flagged NRI ask', () => {
    expect(key1('as an NRI how can I invest?')).toBe('nri_buying');
    expect(key1('can NRIs buy here?')).toBe('nri_buying');
    expect(key1('I want to buy from Dubai')).toBe('nri_buying');
  });

  it('binds the previously-dead facet keys', () => {
    expect(key1('how much GST do I pay?')).toBe('gst_registration');
    expect(key1('what is the booking process?')).toBe('booking_process');
    expect(key1('is the khata clear?')).toBe('khata');
    expect(key1('is there a corner plot premium?')).toBe('plc_premium'); // C2.8 exact facet
    expect(key1('what utilities are on the plot?')).toBe('utilities'); // C2.10 exact facet
    expect(key1('can I customize the villa?')).toBe('customization'); // F.5 exact facet
    expect(key1('is it vastu compliant?')).toBe('vastu');
    expect(key1('what if the operator shuts down?')).toBe('operator_shutdown_risk');
    expect(key1('can I list it on airbnb?')).toBe('airbnb');
    expect(resolveFaqQuestionKeys('how many units in the project?')).toContain('total_units_and_towers');
  });

  it('"is it ready to move?" is a possession ask, not a config dump (B5.2)', () => {
    expect(key1('is it ready to move?')).toBe('possession');
    expect(key1('ready to move in?')).toBe('possession');
  });

  it('does not over-bind: plain overview asks resolve nothing', () => {
    expect(resolveFaqQuestionKeys('tell me about Brigade Eldorado')).toEqual([]);
    expect(resolveFaqQuestionKeys('show me villas')).toEqual([]);
  });
});

describe('AB-1 — isInventoryAsk', () => {
  it('recognises live-stock questions', () => {
    expect(isInventoryAsk('is there any inventory left?')).toBe(true); // B2.4
    expect(isInventoryAsk('how many 2 BHKs are left?')).toBe(true);
    expect(isInventoryAsk('any units still available?')).toBe(true);
    expect(isInventoryAsk('is it sold out?')).toBe(true);
  });
  it('a configurations ask is not an inventory ask', () => {
    expect(isInventoryAsk('what configurations do you have?')).toBe(false);
    expect(isInventoryAsk('what sizes are offered?')).toBe(false);
  });
});

function availabilityReq(
  buyerText: string,
  units: Array<{ unitType: string; priceDisplay: string; holdableUnits?: number }>,
): ComposeRequest {
  return {
    goal: { kind: 'answer', topic: 'availability', projectId: 'eldorado' },
    evidence: { tools: ['listUnits'], units },
    context: {
      constraints: {},
      alreadyShownSameSet: false,
      builderName: 'Naya',
      buyerText,
      focusProjectName: 'Brigade Eldorado',
    },
  };
}

describe('AB-1 — inventory ask composes the availability fact', () => {
  it('leads with live counts when holdable data exists', () => {
    const reply = fallbackReply(
      availabilityReq('is there any inventory left?', [
        { unitType: '2 BHK', priceDisplay: '₹57.5L', holdableUnits: 3 },
        { unitType: '3 BHK', priceDisplay: '₹95L', holdableUnits: 1 },
      ]),
    );
    expect(reply).toMatch(/still open/i);
    expect(reply).toMatch(/3 × 2 BHK/);
    expect(reply).toMatch(/1 × 3 BHK/);
  });

  it('never claims sold-out on all-zero counts — 0 also means "not tracked"', () => {
    const reply = fallbackReply(
      availabilityReq('is there any inventory left?', [
        { unitType: '2 BHK', priceDisplay: '₹57.5L', holdableUnits: 0 },
        { unitType: '3 BHK', priceDisplay: '₹95L', holdableUnits: 0 },
      ]),
    );
    expect(reply).not.toMatch(/sold out|no units left|nothing left/i);
    expect(reply).toMatch(/team confirms exact availability/i);
  });

  it('a plain configurations ask keeps the config list', () => {
    const reply = fallbackReply(
      availabilityReq('what configurations do you have?', [
        { unitType: '2 BHK', priceDisplay: '₹57.5L', holdableUnits: 3 },
      ]),
    );
    expect(reply).toMatch(/Available configurations/);
  });
});
