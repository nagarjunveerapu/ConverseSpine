import { describe, expect, it } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeData, fakeDeps } from './fakes.js';

/**
 * L05 on the live line, 16 turns:
 *    2 > i can pay 55000 a month
 *      < "At ₹55,000 a month — … that services about ₹63 L of loan, roughly
 *         ₹79 L of home with the usual 20% down."
 *    5 > what is the down payment on that
 *      < "I need a loan amount (for example, ₹85 lakh) before I can work that out."
 *    9 > what if i pay 30 percent upfront          … same
 *   10 > emi for 20 years                          … same
 *   12 > any pre-emi during construction           … same
 *
 * Four dead ends on a number the bot itself derived and spoke — and which was
 * still sitting in state as `budgetMaxInr: 7900000` while it asked. Whatever
 * the buyer says next, they have already said this.
 */
function harness(convId: string) {
  const deps = fakeDeps();
  deps.failureTools = true;
  const data = deps.data as ReturnType<typeof fakeData>;
  const turn = (text: string) =>
    runEngineTurn(
      {
        convId,
        builderId: 'lokations',
        text,
        buyerPhone: '+919999991150',
        channel: 'whatsapp',
      },
      deps,
    );
  return { deps, data, turn };
}

describe('a monthly figure survives the turn that gave it', () => {
  it('keeps the conversion on state', async () => {
    const { turn } = harness('emi-afford-state');
    const r = await turn('i can pay 55000 a month');

    expect(r.state.affordability).toMatchObject({ monthlyInr: 55_000, fromIncome: false });
    expect(r.state.affordability!.loanInr).toBeGreaterThan(0);
    // The search budget it also fed is unchanged — two consumers, one number.
    expect(r.state.constraints.budgetMaxInr).toBe(r.state.affordability!.priceInr);
  });

  it('answers a later EMI ask on it instead of asking for a loan amount', async () => {
    const { turn, data } = harness('emi-afford-recall');
    await turn('i can pay 55000 a month');
    await turn('tell me about Ayana');
    // The live condition: a project is open but its price basis does not
    // resolve, so the project-price leg has nothing to compute on.
    data.fail.priceBasis = 'absent';

    const r = await turn('what would the emi be for 20 years');

    expect(r.reply).not.toMatch(/need a loan amount/i);
    expect(r.reply).toMatch(/₹55,000 a month/);
    expect(r.reply).toMatch(/EMI/i);
  });

  it('still asks when the buyer has given no number at all', async () => {
    const { turn, data } = harness('emi-afford-empty');
    data.fail.priceBasis = 'absent';

    const r = await turn('calculate EMI at 8.5% for 20 years');

    // Nothing to recall — the honest ask is the right answer, and the recall
    // path must never invent a principal to avoid it.
    expect(r.reply).toMatch(/loan amount/i);
  });

  it('names a remembered budget as the buyer’s own, never as a project price', async () => {
    const { turn, data } = harness('emi-afford-budget');
    await turn('apartments under 80 lakhs');
    data.fail.priceBasis = 'absent';

    const r = await turn('what would the emi be for 20 years');

    if (/need a loan amount/i.test(r.reply)) return; // goal routed elsewhere; covered above
    expect(r.reply).not.toMatch(/₹80,00,000 project price/);
  });
});
