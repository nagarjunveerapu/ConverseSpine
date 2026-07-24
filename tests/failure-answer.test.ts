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
    expect(answerRequirements('show the stamp duty and club fee')).toEqual([]);
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
});

describe('Phase 4 turn behavior', () => {
  async function focusedHarness(id: string, failureAnswer = true) {
    const deps = fakeDeps();
    deps.failureAnswer = failureAnswer;
    const turn = (text: string) =>
      runEngineTurn(
        {
          convId: id,
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
});
