/**
 * Focus-hold major-fix regression (growing suite).
 *
 * Rule for every major bot-lane / Wave fix going forward:
 *   1. Add the new fix phrases here (and in scenarios/buyer/W3-FOCUS-HOLD-*.json).
 *   2. Run ≥10 complex cases that start from a prior focused stage, then apply
 *      the new ask — bot must HOLD focus unless the case is an explicit pivot.
 *   3. Keep negative controls (budget/locality/explore) so we don't over-hold.
 *
 * Layers under test: pivot arbiter + answer contract (extractors). Live dig
 * transcripts use `npm run test:focus-hold` against dig/dev.
 */
import { describe, expect, it } from 'vitest';
import {
  answerRequirements,
  enforceAnswerContract,
  withAnswerRequirements,
} from '../src/engine/answer-contract.js';
import { arbitrateFocusPivot } from '../src/engine/turn-intent/pivot-arbiter.js';
import type { Extracted, TurnGoal } from '../src/engine/types.js';

const PROJECT = 'brigade-eldorado-naya-advisor';

function ex(partial: Partial<Extracted['constraints']> = {}): Extracted {
  return { constraints: { ...partial } };
}

function answerGoal(
  topic: TurnGoal extends { kind: 'answer'; topic: infer T } ? T : never,
  topics?: string[],
): Extract<TurnGoal, { kind: 'answer' }> {
  return {
    kind: 'answer',
    topic,
    projectId: PROJECT,
    ...(topics?.length ? { topics: topics as never } : {}),
  };
}

type HoldCase = {
  id: string;
  /** What the buyer already established (stage to preserve). */
  priorStage: string;
  text: string;
  priorConstraints?: Extracted['constraints'];
  extractConstraints?: Extracted['constraints'];
  expectAction: 'hold_focus' | 'release_to_discover';
  /** FactKeys the new ask must bind. */
  expectRequires?: string[];
  /** Topics that must survive withAnswerRequirements. */
  expectTopicsAny?: string[];
};

/**
 * Complex follow-ups after the buyer is already focused on Eldorado.
 * Cases 01–10+ are the Wave-3 / focus-hold bar; append new major fixes below.
 */
const HOLD_CASES: HoldCase[] = [
  {
    id: 'W3-FH-01',
    priorStage: 'focused Eldorado after overview',
    text: 'is loan eligibility available as well as whats the 2 BHK available if available',
    extractConstraints: { bhk: '2' },
    expectAction: 'hold_focus',
    expectRequires: ['loan_eligibility'],
    expectTopicsAny: ['legal', 'availability'],
  },
  {
    id: 'W3-FH-02',
    priorStage: 'focused after pricing chip',
    text: 'what is the price and connectivity?',
    expectAction: 'hold_focus',
    expectRequires: ['price'],
    expectTopicsAny: ['price'],
  },
  {
    id: 'W3-FH-03',
    priorStage: 'focused after legal snapshot',
    text: 'loan eligibility? also send photos',
    expectAction: 'hold_focus',
    expectRequires: ['loan_eligibility'],
    expectTopicsAny: ['legal', 'media'],
  },
  {
    id: 'W3-FH-04',
    priorStage: 'focused investment conversation',
    text: 'tell me about returns, also whats the cost here',
    expectAction: 'hold_focus',
    expectRequires: ['rental_yield', 'price'],
    expectTopicsAny: ['overview', 'price'],
  },
  {
    id: 'W3-FH-05',
    priorStage: 'focused location thread',
    text: 'nearby schools and when ready?',
    expectAction: 'hold_focus',
    expectRequires: ['possession'],
  },
  {
    id: 'W3-FH-06',
    priorStage: 'focused (0d possession cliff)',
    text: 'when is possession',
    expectAction: 'hold_focus',
    expectRequires: ['possession'],
  },
  {
    id: 'W3-FH-07',
    priorStage: 'focused corridor chat',
    text: 'has this area appreciated',
    extractConstraints: { location: 'has this area appreciated' },
    expectAction: 'hold_focus',
    expectRequires: ['appreciation'],
  },
  {
    id: 'W3-FH-08',
    priorStage: 'focused with soft budget 70L',
    text: 'actually my budget is only 50L',
    priorConstraints: { budgetMaxInr: 7_000_000 },
    extractConstraints: { budgetMaxInr: 5_000_000 },
    expectAction: 'release_to_discover',
  },
  {
    id: 'W3-FH-09',
    priorStage: 'focused Eldorado',
    text: '2 BHK in Jayanagar',
    extractConstraints: { bhk: '2', location: 'Jayanagar' },
    expectAction: 'release_to_discover',
  },
  {
    id: 'W3-FH-10',
    priorStage: 'focused Eldorado',
    text: 'show me other projects in Whitefield',
    extractConstraints: { location: 'Whitefield' },
    expectAction: 'release_to_discover',
  },
  {
    id: 'W3-FH-11',
    priorStage: 'focused after configs',
    text: 'is it RERA approved and can I get a loan?',
    expectAction: 'hold_focus',
    expectRequires: ['rera', 'loan_eligibility'],
    expectTopicsAny: ['legal'],
  },
  {
    id: 'W3-FH-12',
    priorStage: 'focused after price answer',
    text: 'fine, just yield, one number',
    priorConstraints: { location: 'Aerospace Park / Devanahalli Corridor' },
    extractConstraints: { location: 'fine' },
    expectAction: 'hold_focus',
    expectRequires: ['rental_yield'],
  },
  {
    id: 'W3-FH-13',
    priorStage: 'focused multi-facet thread',
    text: 'whats the 2 BHK available and loan eligibility for this project?',
    extractConstraints: { bhk: '2' },
    expectAction: 'hold_focus',
    expectRequires: ['loan_eligibility'],
    expectTopicsAny: ['legal', 'availability'],
  },
  {
    id: 'W3-FH-14',
    priorStage: 'focused after brochure ask',
    text: 'also send photos and tell me about banks',
    expectAction: 'hold_focus',
    expectRequires: ['loan_eligibility'],
    expectTopicsAny: ['legal', 'media'],
  },
];

describe('Focus-hold major-fix regression (≥10 complex prior-stage cases)', () => {
  it('suite has at least 10 scenarios including hold + pivot controls', () => {
    expect(HOLD_CASES.length).toBeGreaterThanOrEqual(10);
    expect(HOLD_CASES.filter((c) => c.expectAction === 'hold_focus').length).toBeGreaterThanOrEqual(7);
    expect(HOLD_CASES.filter((c) => c.expectAction === 'release_to_discover').length).toBeGreaterThanOrEqual(3);
  });

  for (const c of HOLD_CASES) {
    it(`${c.id}: ${c.priorStage} → «${c.text}» → ${c.expectAction}`, () => {
      const decision = arbitrateFocusPivot({
        text: c.text,
        priorConstraints: c.priorConstraints ?? {},
        ex: ex(c.extractConstraints ?? {}),
        routing: undefined,
        enabled: true,
      });
      expect(decision.action, `${c.id} arbiter`).toBe(c.expectAction);

      if (c.expectRequires?.length) {
        const req = answerRequirements(c.text);
        for (const key of c.expectRequires) {
          expect(req, `${c.id} requires ${key}`).toContain(key);
        }
        const seeded = answerGoal(
          c.expectTopicsAny?.includes('price') ? 'price' : 'overview',
          c.expectTopicsAny,
        );
        const next = withAnswerRequirements(seeded, c.text);
        expect(next.requires ?? []).toEqual(expect.arrayContaining(c.expectRequires));
        if (c.expectTopicsAny?.length) {
          const topics = next.topics?.length ? next.topics : [next.topic];
          for (const t of c.expectTopicsAny) {
            expect(topics, `${c.id} topics`).toContain(t);
          }
        }
      }
    });
  }

  it('W3-FH-05 sibling: possession miss must not kill location evidence', () => {
    const out = enforceAnswerContract(
      {
        kind: 'answer',
        topic: 'location',
        projectId: PROJECT,
        topics: ['location'],
        requires: ['possession'],
      },
      {
        tools: [],
        location: {
          projectName: 'Brigade Eldorado',
          microMarket: 'Devanahalli',
          schools: [{ name: 'ABC International', distanceKm: 3 }],
        },
      },
    );
    expect(out.failure).toBeUndefined();
    expect(out.notices?.some((n) => n.subject === 'possession')).toBe(true);
    expect(out.location?.schools?.[0]?.name).toMatch(/ABC/i);
  });
});
