import { describe, expect, it } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';

/**
 * A size row prices THAT size. On the live line the first tap of the "2 BHK"
 * row answered "Pricing — Brigade Eldorado: ₹31 L" — the project's floor, not
 * the 2 BHK band — and the very same tap answered correctly a second time.
 * That gap is the signature of reading the buyer's size a turn too late, so
 * the assert is on what the pricing port was ASKED, not on the sentence.
 */
function harness(convId: string) {
  const deps = fakeDeps();
  const pricingCalls: Array<string | undefined> = [];
  const inner = deps.data.pricing.bind(deps.data);
  deps.data.pricing = async (b: string, nd: string, id: string, unitType?: string) => {
    pricingCalls.push(unitType);
    return inner(b, nd, id, unitType);
  };
  const turn = (text: string, actionId?: string) =>
    runEngineTurn(
      {
        convId,
        builderId: 'lokations',
        text,
        buyerPhone: '+919999999993',
        channel: 'whatsapp',
        ...(actionId ? { action_id: actionId } : {}),
      },
      deps,
    );
  return { pricingCalls, turn };
}

describe('a tapped size row prices that size', () => {
  it('carries the size on the turn that opens the project', async () => {
    const { pricingCalls, turn } = harness('wa-size-open');
    await turn('Hi');

    // One tap, doing both jobs: it names the project and asks for that size.
    await turn('2 BHK', 'wa.money.bhk.2@eldorado');

    expect(pricingCalls.length).toBeGreaterThan(0);
    expect(pricingCalls.at(-1)).toBe('2 BHK');
  });

  it('carries the size when the project was already open', async () => {
    const { pricingCalls, turn } = harness('wa-size-focused');
    await turn('Hi');
    await turn('Brigade Eldorado', 'wa.pick.eldorado');

    await turn('2 BHK', 'wa.money.bhk.2@eldorado');

    expect(pricingCalls.at(-1)).toBe('2 BHK');
  });
});
