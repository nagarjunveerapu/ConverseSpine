import { describe, expect, it } from 'vitest';
import {
  answerRequirements,
  enforceAnswerContract,
  withAnswerRequirements,
} from '../src/engine/answer-contract.js';
import { runEngineTurn } from '../src/engine/turn.js';
import type { EvidenceSet, TurnGoal } from '../src/engine/types.js';
import { fakeDeps } from './fakes.js';

describe('answer delivery contract', () => {
  it('extracts explicit fact keys rather than trusting a broad topic bucket', () => {
    expect(answerRequirements('what is the carpet area and RERA number?')).toEqual([
      'carpet_area',
      'rera',
    ]);
    // Stamp duty used to extract nothing, so "what about stamp duty?" was
    // answered with the headline price and the contract never noticed. It is a
    // cost-sheet atom now; a club fee still is not modelled, and claiming it
    // would be worse than missing it.
    expect(answerRequirements('show the stamp duty and club fee')).toEqual(['stamp_duty']);
    expect(answerRequirements('what is the club fee')).toEqual([]);
    expect(answerRequirements('what is the per sqft rate?')).toEqual(['price_per_sqft']);
  });

  it('turns a full miss terminal and a partial miss into notices', () => {
    const base: Extract<TurnGoal, { kind: 'answer' }> = {
      kind: 'answer',
      topic: 'price',
      projectId: 'ayana',
    };
    const evidence: EvidenceSet = {
      tools: ['projectDetail'],
      detail: {
        projectId: 'ayana',
        name: 'Ayana',
        microMarket: 'Sakleshpur',
        reraNumber: 'PRM/KA/RERA/123',
      },
    };

    const carpetOnly = enforceAnswerContract(
      withAnswerRequirements(base, 'what is the carpet area?'),
      evidence,
    );
    expect(carpetOnly.failure).toMatchObject({
      kind: 'no_data',
      stage: 'compose',
      subject: 'carpet_area',
    });

    const partial = enforceAnswerContract(
      withAnswerRequirements(
        { ...base, topics: ['price', 'legal'] },
        'what is the carpet area and RERA number?',
      ),
      evidence,
    );
    expect(partial.failure).toBeUndefined();
    expect(partial.deliveredFacts).toContain('rera');
    expect(partial.notices).toMatchObject([
      { kind: 'no_data', subject: 'carpet_area' },
    ]);
  });

  it('counts an approved possession FAQ as delivered structured evidence', () => {
    const goal = withAnswerRequirements(
      {
        kind: 'answer',
        topic: 'availability',
        projectId: 'eldorado',
      },
      'when is possession?',
    );
    const result = enforceAnswerContract(goal, {
      tools: ['faqLookup'],
      detail: {
        projectId: 'eldorado',
        name: 'Brigade Eldorado',
        microMarket: 'North Bangalore',
        faqs: [
          {
            questionKey: 'possession',
            question: 'When is possession?',
            answer: 'Possession is scheduled for Dec 2027.',
          },
        ],
      },
    });
    expect(result.failure).toBeUndefined();
    expect(result.deliveredFacts).toContain('possession');
  });

  it('declines rental yield / ROI as no_data — no catalog atom exists', () => {
    expect(answerRequirements('what is the rental yield?')).toContain('rental_yield');
    expect(answerRequirements('what ROI can I expect?')).toContain('rental_yield');
    // Past-tense / corridor phrasing — Advisor dig cliff when embedder abstains
    expect(answerRequirements('has this area appreciated')).toContain('appreciation');
    // legit facets are untouched by the new pattern
    expect(answerRequirements('what is the price?')).toEqual(['price']);
    const out = enforceAnswerContract(
      withAnswerRequirements(
        { kind: 'answer', topic: 'overview', projectId: 'eldorado' },
        'what is the rental yield on Brigade Eldorado?',
      ),
      {
        tools: ['projectDetail'],
        detail: { projectId: 'eldorado', name: 'Brigade Eldorado', microMarket: 'North Bangalore' },
      },
    );
    expect(out.failure).toMatchObject({ kind: 'no_data', subject: 'rental_yield' });
  });

  it('delivers price from config prices on the detail — no false decline when the pricing quote flaked (C9)', () => {
    const goal = withAnswerRequirements(
      { kind: 'answer', topic: 'overview', projectId: 'eldorado' },
      'and the price?',
    );
    // no evidence.pricing (the quote missed) but the detail carries config prices
    const out = enforceAnswerContract(goal, {
      tools: ['projectDetail'],
      detail: {
        projectId: 'eldorado',
        name: 'Brigade Eldorado',
        microMarket: 'North Bangalore',
        configurations: [{ unitType: '2 BHK', priceDisplay: '₹1.2 Cr', priceMinInr: 12000000 }],
      },
    });
    expect(out.failure).toBeUndefined();
    expect(out.deliveredFacts).toContain('price');
  });
});

describe('Phase 4 turn behavior', () => {
  async function focusedHarness(id: string, failureAnswer = true) {
    const deps = fakeDeps();
    deps.failureAnswer = failureAnswer;
    const turn = (text: string) =>
      runEngineTurn(
        {
          threadId: id,
          builderId: 'lokations',
          text,
          buyerPhone: '+919999999991',
          channel: 'advisor_web',
        },
        deps,
      );
    await turn('tell me about Ayana');
    return { deps, turn };
  }

  it('does not answer carpet area with unrelated pricing components', async () => {
    const { deps, turn } = await focusedHarness('fv4-carpet');
    let actionPlan: Record<string, unknown> | undefined;
    deps.crm.appendTurnLedger = async (entry) => {
      actionPlan = entry.actionPlan;
    };
    const result = await turn('what is the carpet area?');
    expect(result.reply).toMatch(/don't have carpet area on file/i);
    expect(result.reply).not.toMatch(/stamp duty|registration|base price/i);
    expect(actionPlan).toMatchObject({
      failures: [
        { kind: 'no_data', stage: 'compose', subject: 'carpet_area' },
      ],
    });
  });

  it('answers supported atoms and names unsupported atoms on the same turn', async () => {
    const { turn } = await focusedHarness('fv4-partial');
    const result = await turn('what is the RERA number and carpet area?');
    expect(result.reply).toMatch(/don't have carpet area on file/i);
    expect(result.reply).toMatch(/PRM\/KA\/RERA/i);
    expect(result.reply).not.toMatch(/stamp duty|registration/i);
  });

  it('keeps ordinary pricing answers intact when price evidence is delivered', async () => {
    const { turn } = await focusedHarness('fv4-price');
    const result = await turn('what is the price?');
    expect(result.reply).toMatch(/Ayana|₹/i);
    expect(result.reply).not.toMatch(/don't have price/i);
  });

  it('keeps Phase 4 dark when its flag is off', async () => {
    const { turn } = await focusedHarness('fv4-dark', false);
    const result = await turn('what is the carpet area?');
    expect(result.reply).not.toMatch(/don't have carpet area on file/i);
  });

  it('declines rental yield instead of fabricating a % or rents (C1 boundary)', async () => {
    const { turn } = await focusedHarness('fv4-yield');
    const result = await turn('what is the rental yield?');
    // The refusal, stated as the policy it is — not as "not on file", which
    // claimed an absence while 16 estimate-bearing FAQ rows sat behind the C1
    // gate. See tests/seams/intel-gated-decline.test.ts.
    expect(result.reply).toMatch(/(?:can'?t|don'?t|won'?t)\s+quote|can'?t source/i);
    // the fabrication that leaked live: a yield % and per-month rent figures
    expect(result.reply).not.toMatch(/\d+\s*%|per\s+month|\/month/i);
  });
});
