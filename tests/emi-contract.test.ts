import { describe, expect, it } from 'vitest';
import { computeEmi } from '../src/engine/emi.js';
import { extractFactsSync, parseEmiPrincipal } from '../src/engine/facts.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { initState } from '../src/engine/state.js';
import { fakeDeps } from './fakes.js';

describe('EMI principal extraction', () => {
  it.each([
    ['emi at 85L for 20 years at 8.5%', 8_500_000],
    ['calculate EMI on a loan of 1.2 crore', 12_000_000],
    ['₹65 lakh principal emi', 6_500_000],
  ])('extracts a monetary principal from %s', (text, expected) => {
    expect(parseEmiPrincipal(text)).toBe(expected);
  });

  it.each([
    'calculate EMI at 8.5% for 20 years',
    'what is the EMI for a 5 year loan',
    'my budget is 85L, what is the EMI?',
    'I have 13L down payment, calculate EMI',
  ])('does not turn rate, tenure, budget, or deposit into principal: %s', (text) => {
    expect(parseEmiPrincipal(text)).toBeUndefined();
  });

  it('keeps explicit EMI principal out of search constraints', () => {
    const ex = extractFactsSync(
      'emi at 85L for 20 years at 8.5%',
      initState('emi-extract', 'lokations'),
      { failureTools: true },
    );
    expect(ex.emiPrincipalInr).toBe(8_500_000);
    expect(ex.constraints.budgetMaxInr).toBeUndefined();
  });

  it('keeps the pre-Phase-1 extraction shape when the flag is off', () => {
    const ex = extractFactsSync(
      'emi at 85L for 20 years at 8.5%',
      initState('emi-extract-off', 'lokations'),
    );
    expect(ex.emiPrincipalInr).toBeUndefined();
    expect(ex.emiContractV1).toBeUndefined();
    expect(ex.constraints.budgetMaxInr).toBe(8_500_000);
  });
});

describe('EMI computation authority', () => {
  it('uses a stated principal as the loan amount, not an 80% property-price basis', () => {
    const outcome = computeEmi({
      principalInr: 8_500_000,
      projectPriceInr: 5_200_000,
      ratePercent: 8.5,
      tenureYears: 20,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toMatchObject({
      basisKind: 'explicit_principal',
      principalFormatted: '₹85,00,000',
      basisFormatted: '₹85,00,000',
      ratePercent: 8.5,
      tenureYears: 20,
    });
    expect(outcome.value.downPaymentFormatted).toBeUndefined();
  });

  it('labels focused-project price and 80% LTV explicitly', () => {
    const outcome = computeEmi({ projectPriceInr: 5_000_000 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toMatchObject({
      basisKind: 'project_price',
      basisFormatted: '₹50,00,000',
      principalFormatted: '₹40,00,000',
      downPaymentFormatted: '₹10,00,000',
      ltvPercent: 80,
    });
  });

  it('returns missing_input instead of a substitute amount', () => {
    expect(computeEmi({ ratePercent: 8.5, tenureYears: 20 })).toEqual({
      ok: false,
      failure: {
        kind: 'missing_input',
        stage: 'tool',
        subject: 'emi.principal',
      },
    });
  });
});

describe('EMI turn contract', () => {
  it('does not activate the new context-free EMI goal when the flag is off', async () => {
    const deps = fakeDeps();
    const result = await runEngineTurn(
      {
        convId: 'emi-contract-off',
        builderId: 'lokations',
        buyerPhone: '+919999991100',
        text: 'calculate EMI at 8.5% for 20 years',
      },
      deps,
    );
    expect(result.debug.goal.kind).not.toBe('emi_calculate');
  });

  it('answers from explicit principal even when a different project is focused', async () => {
    const deps = fakeDeps();
    deps.failureTools = true;
    const turn = (text: string) =>
      runEngineTurn(
        {
          convId: 'emi-explicit-turn',
          builderId: 'lokations',
          buyerPhone: '+919999991101',
          text,
        },
        deps,
      );

    await turn('Ayana');
    const result = await turn('emi at 85L for 20 years at 8.5%');
    expect(result.debug.goal.kind).toBe('emi_calculate');
    expect(result.reply).toMatch(/₹85,00,000 loan/i);
    expect(result.reply).toMatch(/8\.5%.*20 years/i);
    expect(result.state.constraints.budgetMaxInr).toBeUndefined();
  });

  it('asks for a loan amount when no explicit or focused-project basis exists', async () => {
    const deps = fakeDeps();
    deps.failureTools = true;
    const result = await runEngineTurn(
      {
        convId: 'emi-missing-turn',
        builderId: 'lokations',
        buyerPhone: '+919999991102',
        text: 'calculate EMI at 8.5% for 20 years',
      },
      deps,
    );
    expect(result.debug.goal.kind).toBe('emi_calculate');
    expect(result.reply).toMatch(/need a loan amount/i);
    expect(result.debug.tools).not.toContain('priceBasis');
  });

  it('keeps project-anchored EMI and names price, principal, LTV, rate, and tenure', async () => {
    const deps = fakeDeps();
    deps.failureTools = true;
    const turn = (text: string) =>
      runEngineTurn(
        {
          convId: 'emi-focused-turn',
          builderId: 'lokations',
          buyerPhone: '+919999991103',
          text,
        },
        deps,
      );

    await turn('Ayana');
    const result = await turn('what is the EMI?');
    expect(result.reply).toMatch(/80% loan/i);
    expect(result.reply).toMatch(/principal/i);
    expect(result.reply).toMatch(/project price/i);
    expect(result.reply).toMatch(/8\.5%.*20 years/i);
  });
});
