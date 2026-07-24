import { describe, expect, it, vi } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { speakEducation } from '../src/engine/education.js';
import { buildLedgerWritePayload } from '../src/engine/ledger-write.js';
import { speakFailure } from '../src/engine/speak-failure.js';
import type { EngineDeps } from '../src/engine/ports.js';
import { fakeDeps } from './fakes.js';

function definitionHarness(kind: string): EngineDeps {
  const deps = fakeDeps();
  deps.failureRouting = true;
  deps.routingEnv = {
    SIL_EMBED_FIRST: 'true',
    FAILURE_ROUTING: 'true',
    AI: { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) },
    INTENT_VECTORS: {
      query: async () => ({
        matches: [
          {
            id: `fixture-${kind}`,
            score: 0.91,
            metadata: { intent_kind: kind },
          },
        ],
      }),
    },
  } as unknown as NonNullable<EngineDeps['routingEnv']>;
  return deps;
}

describe('buyer education KB resolver', () => {
  it('answers Wave-1 BHK literacy from educationSearch after definition routing', async () => {
    const deps = definitionHarness('definition_bhk');
    const result = await runEngineTurn(
      {
        convId: 'edu-bhk',
        builderId: 'lokations',
        text: 'what is this bhk you people say',
        channel: 'advisor_web',
      },
      deps,
    );
    expect(result.reply).toMatch(/Bedroom, Hall, and Kitchen/i);
    expect(result.reply).not.toMatch(/couldn't identify that location/i);
    expect(result.debug.tools).toContain('educationSearch');
    expect(result.debug.goal).toMatchObject({ kind: 'answer', topic: 'education' });
  });

  it('answers plotted-development literacy without searching', async () => {
    const deps = definitionHarness('definition_property_type');
    const result = await runEngineTurn(
      {
        convId: 'edu-plot',
        builderId: 'lokations',
        text: 'what is plotted development',
        channel: 'advisor_web',
      },
      deps,
    );
    expect(result.reply).toMatch(/plotted development/i);
    expect(result.debug.tools).toEqual(['educationSearch']);
  });

  it('speaks education no_data and enqueues on miss', async () => {
    const deps = definitionHarness('definition_documents');
    deps.data.educationSearch = async () => null;
    const enqueue = vi.fn(async () => {});
    deps.data.enqueueEducationMiss = enqueue;

    const result = await runEngineTurn(
      {
        convId: 'edu-miss',
        builderId: 'lokations',
        text: 'what is a khata extract pack in detail for aliens',
        channel: 'advisor_web',
      },
      deps,
    );

    expect(result.reply).toBe(
      "I don't have a short explainer for that yet — ask me about property types, buying steps, or buyer documents, or name a project.",
    );
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      buyerText: expect.stringMatching(/khata/i),
      source: 'education_miss',
    });
  });

  it('keeps search-shaped briefs on the search path', async () => {
    const deps = fakeDeps();
    deps.failureRouting = true;
    deps.failureSearch = true;
    const result = await runEngineTurn(
      {
        convId: 'edu-search-neg',
        builderId: 'lokations',
        text: 'Whitefield 70L 2BHK',
        channel: 'advisor_web',
      },
      deps,
    );
    expect(result.reply).not.toMatch(/short explainer for that yet/i);
    expect(result.reply).not.toMatch(/Bedroom, Hall, and Kitchen/i);
  });

  it('keeps policy refusals on policy (not education)', async () => {
    const deps = definitionHarness('policy_investment_metric');
    const result = await runEngineTurn(
      {
        convId: 'edu-policy-neg',
        builderId: 'lokations',
        text: 'what CAGR will I get',
        channel: 'advisor_web',
      },
      deps,
    );
    expect(result.reply).toMatch(/can't calculate or promise CAGR/i);
    expect(result.debug.tools).toEqual([]);
  });

  it('does not speak locality failure for definition turns', async () => {
    expect(speakFailure({ kind: 'no_data', stage: 'tool', subject: 'education_explainer' })).not.toMatch(
      /couldn't identify that location/i,
    );
    expect(
      speakEducation({
        entryId: 'x',
        topicKey: 'bhk',
        jurisdiction: 'india',
        question: 'q',
        answer: 'BHK means Bedroom, Hall, and Kitchen.',
        match: 'lookup',
      }),
    ).toMatch(/Bedroom, Hall, and Kitchen/);
  });

  it('records over-answer asked-vs-delivered telemetry on the ledger verify blob', () => {
    const payload = buildLedgerWritePayload({
      state: {
        builderId: 'lokations',
        phase: 'focused',
        turnCount: 2,
        constraints: {},
        discover: { lastOffered: [] },
        focus: { projectId: 'ayana', projectName: 'Ayana' },
      } as never,
      ex: { askTopics: ['overview'], constraints: {}, speechAct: 'answer' } as never,
      goal: { kind: 'answer', topic: 'overview', projectId: 'ayana' },
      evidence: {
        tools: ['projectDetail'],
        detail: {
          projectId: 'ayana',
          name: 'Ayana',
          microMarket: 'Sakleshpur',
          possession: '2028',
          faqs: [
            { questionKey: 'possession', question: 'When?', answer: '2028' },
            { questionKey: 'loan', question: 'Loan?', answer: 'Yes' },
          ],
        },
      },
      buyerText: 'when is possession?',
    });
    expect(payload.verify).toMatchObject({
      over_answer: {
        topics_asked: expect.arrayContaining(['overview', 'possession']),
        facts_delivered: expect.arrayContaining(['possession']),
        faq_keys_delivered: expect.arrayContaining(['possession', 'loan']),
        education_delivered: false,
      },
    });
  });
});
