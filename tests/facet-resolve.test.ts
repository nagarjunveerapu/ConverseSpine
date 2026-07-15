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

  // Review AB-1 note 2: the Dubai/abroad NRI clause requires an invest/buy verb, so
  // a pure location search that merely mentions Dubai must NOT bind nri_buying.
  it('nri_buying does not bind a pure location brief mentioning a city', () => {
    expect(resolveFaqQuestionKeys('apartments in Dubai')).not.toContain('nri_buying');
    expect(resolveFaqQuestionKeys('projects near the US consulate')).not.toContain('nri_buying');
    expect(key1('I want to buy from Dubai')).toBe('nri_buying'); // the real intent still binds
  });

  // Review AB-1 note 1: gst is specific, but confirm it doesn't steal a pure legal ask.
  it('gst binds a GST ask, not an unrelated legal turn', () => {
    expect(key1('how much GST do I pay?')).toBe('gst_registration');
    expect(resolveFaqQuestionKeys('is the title clear?')).not.toContain('gst_registration');
  });

  it('binds the 192-run stragglers', () => {
    expect(key1('how is water and power there?')).toBe('water_power'); // D2.16
    expect(key1('is it MUDA or DTCP approved?')).toBe('plan_approval'); // C2.5
    expect(key1('can I start construction immediately?')).toBe('construction_rules'); // C2.7
    expect(key1('who is the operator?')).toBe('revenue_model'); // D2.5 / E.3
    expect(key1('is the payout guaranteed?')).toBe('revenue_model'); // D2.8
    expect(key1('tell me about the coffee and pepper crops')).toBe('plantation_details'); // D2.9
    expect(key1('do I have to manage the farm myself?')).toBe('plantation_details'); // D2.10
    expect(resolveFaqQuestionKeys('how big is the township?')).toContain('township_scale'); // B9.4
    expect(resolveFaqQuestionKeys('how big is the community?')).toContain('community_size'); // F.8
  });
});

describe('AB-1 — cost-component asks get THE component, not the whole card', () => {
  const ELDORADO_COMPONENTS = [
    { label: 'Base Selling Price', value: '₹9,000 – ₹10,500 per sqft' },
    { label: 'Car Parking (Mandatory)', value: '₹5,00,000 per slot' },
    { label: 'Club Membership (One-time)', value: '₹1,50,000' },
    { label: 'Floor Rise Premium', value: '₹75/sqft/floor above 5th' },
    { label: 'Stamp Duty', value: '5' },
    { label: 'Registration Charges', value: '1' },
    { label: 'GST @ 5%', value: '5' },
  ];

  function priceReq(buyerText: string): ComposeRequest {
    return {
      goal: { kind: 'answer', topic: 'price', projectId: 'eldorado' },
      evidence: {
        tools: ['pricing'],
        pricing: { projectName: 'Brigade Eldorado', components: ELDORADO_COMPONENTS },
      },
      context: {
        constraints: {},
        alreadyShownSameSet: false,
        builderName: 'Naya',
        buyerText,
        focusProjectName: 'Brigade Eldorado',
      },
    };
  }

  it('club membership fee → the club line, not base price (B3.3)', () => {
    const reply = fallbackReply(priceReq('club membership fee?'));
    expect(reply).toMatch(/Club Membership/);
    expect(reply).not.toMatch(/9,000/); // base price must not lead a club ask
  });

  it('floor rise charges → the floor-rise line (B3.5)', () => {
    const reply = fallbackReply(priceReq('floor rise charges?'));
    expect(reply).toMatch(/Floor Rise/);
    expect(reply).not.toMatch(/Club Membership/);
  });

  it('stamp duty and registration → both statutory lines (B3.7)', () => {
    const reply = fallbackReply(priceReq('stamp duty and registration?'));
    expect(reply).toMatch(/Stamp Duty/);
    expect(reply).toMatch(/Registration Charges/);
    expect(reply).not.toMatch(/Car Parking/);
  });

  it('a generic price ask keeps the full card', () => {
    const reply = fallbackReply(priceReq("what's the price?"));
    expect(reply).toMatch(/Base Selling Price/);
  });

  // Review AB-1 note 3: parking is BOTH a FAQ key and a cost-sheet row. When the
  // cost sheet carries it, the pricing component owns the answer — the buyer must
  // see the ₹ figure, not an honest-miss for a FAQ row that doesn't exist.
  it('parking charges lead with the cost-sheet component (costSheetOwns)', () => {
    const reply = fallbackReply(priceReq('what are the parking charges?'));
    expect(reply).toMatch(/Car Parking/);
    expect(reply).toMatch(/5,00,000/);
    expect(reply).not.toMatch(/don't have|not on file/i);
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
