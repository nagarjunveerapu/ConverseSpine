import { describe, expect, it } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { speakFailure } from '../src/engine/speak-failure.js';
import { embedderRouting } from '../src/engine/turn-routing/classify.js';
import {
  looksLikeSearchBrief,
  mapIntentToRouting,
  POLICY_INTENT_KEYS,
} from '../src/engine/turn-routing/embedder-map.js';
import { failureFromUnsupportedRouting } from '../src/engine/turn-routing/unsupported-outcome.js';
import type { TurnRoutingInput } from '../src/engine/turn-routing/types.js';
import type { EngineDeps } from '../src/engine/ports.js';
import { fakeDeps } from './fakes.js';

const INPUT: TurnRoutingInput = {
  text: 'buyer text',
  builder_id: 'brigade-group',
  phase: 'discover',
};

describe('embedding-owned failure routing', () => {
  const expected = {
    policy_prohibited: ['prohibited', 'protected_identity_filter'],
    policy_investment_metric: ['out_of_scope', 'investment_return'],
    policy_internal_instructions: ['out_of_scope', 'internal_instructions'],
    definition_bhk: ['definition', 'bhk'],
    definition_ready_to_move: ['definition', 'ready_to_move'],
    about_ai: ['about_us', 'identity'],
    about_data: ['about_us', 'data_collection'],
  } as const;

  it.each(Object.entries(expected))('%s maps only from an embedding verdict', (kind, target) => {
    const result = mapIntentToRouting(kind, 0.82, INPUT, 0.68, true);
    expect(result).toMatchObject({
      routing: 'unsupported',
      confidence: 'embedder',
      policy: target[0],
      subject: target[1],
    });
  });

  it('keeps the new policy classes dark when the Phase 2 flag is off', () => {
    for (const kind of POLICY_INTENT_KEYS) {
      expect(mapIntentToRouting(kind, 0.82, INPUT, 0.68, false)).toBeNull();
    }
  });

  it('does not bypass the embedding confidence threshold', () => {
    expect(mapIntentToRouting('policy_prohibited', 0.5, INPUT, 0.68, true)).toBeNull();
  });

  it('uses calibrated policy floors without lowering unrelated intents', () => {
    expect(
      mapIntentToRouting('policy_prohibited', 0.819, INPUT, 0.83, true),
    ).toMatchObject({
      routing: 'unsupported',
      policy: 'prohibited',
    });
    expect(
      mapIntentToRouting('definition_bhk', 0.819, INPUT, 0.83, true),
    ).toMatchObject({
      routing: 'unsupported',
      policy: 'definition',
    });
    expect(
      mapIntentToRouting('about_ai', 0.819, INPUT, 0.83, true),
    ).toBeNull();
  });

  it('does not bind definition_bhk on a search brief like 3 BHK in Mumbai', () => {
    expect(looksLikeSearchBrief('3 BHK in Mumbai')).toBe(true);
    expect(
      mapIntentToRouting(
        'definition_bhk',
        0.92,
        { ...INPUT, text: '3 BHK in Mumbai' },
        0.83,
        true,
      ),
    ).toBeNull();
    expect(
      mapIntentToRouting(
        'definition_bhk',
        0.92,
        { ...INPUT, text: 'what is BHK' },
        0.83,
        true,
      ),
    ).toMatchObject({ routing: 'unsupported', policy: 'definition', subject: 'bhk' });
  });

  it('does not let class-balanced definition boost steal a search-shaped BHK turn', async () => {
    const result = await embedderRouting(
      {
        SIL_ROUTING_TAU: '0.83',
        FAILURE_ROUTING: 'true',
        AI: { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) },
        INTENT_VECTORS: {
          query: async () => ({
            matches: [
              {
                id: 'definition',
                score: 0.91,
                metadata: { intent_kind: 'definition_bhk' },
              },
              {
                id: 'search',
                score: 0.86,
                metadata: { intent_kind: 'find_projects' },
              },
            ],
          }),
        },
      } as never,
      { ...INPUT, text: '3 BHK in Mumbai' },
    );
    expect(result.result).toMatchObject({ routing: 'search_pivot' });
    expect(result.top_kind).toBe('find_projects');
  });

  it('uses class-balanced BHK semantics without stealing search-shaped BHK turns', async () => {
    const classify = async (definitionScore: number) =>
      embedderRouting(
        {
          SIL_ROUTING_TAU: '0.83',
          FAILURE_ROUTING: 'true',
          AI: { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) },
          INTENT_VECTORS: {
            query: async (_vector: number[], options: { filter?: Record<string, unknown> }) => ({
              matches: options.filter?.intent_kind
                ? [
                    {
                      id: 'definition',
                      score: definitionScore,
                      metadata: { intent_kind: 'definition_bhk' },
                    },
                  ]
                : [
                    {
                      id: 'availability',
                      score: 0.874,
                      metadata: { intent_kind: 'get_availability' },
                    },
                  ],
            }),
          },
        } as never,
        { ...INPUT, text: 'what is this bhk you people say' },
      );

    await expect(classify(0.805)).resolves.toMatchObject({
      result: {
        routing: 'unsupported',
        subject: 'bhk',
      },
      top_kind: 'definition_bhk',
    });
    await expect(classify(0.739)).resolves.toMatchObject({
      result: {
        routing: 'answer_on_project',
        answer_topic: 'availability',
      },
      top_kind: 'get_availability',
    });
  });

  it('routes the existing discount intent through the same deterministic consequence', () => {
    expect(mapIntentToRouting('negotiate_price', 0.82, INPUT, 0.68, true)).toMatchObject({
      routing: 'unsupported',
      policy: 'out_of_scope',
      subject: 'discount',
    });
  });

  it('keeps project rental-yield intent answerable by the Desk FAQ', () => {
    expect(
      mapIntentToRouting('ask_investment_return', 0.82, INPUT, 0.68, true),
    ).toMatchObject({
      routing: 'answer_on_project',
      answer_topic: 'overview',
    });
  });

});

describe('single failure speaker', () => {
  it.each([
    ['protected_identity_filter', "I can't help filter homes or communities by caste or religion."],
    ['investment_return', "I can share project prices and factual details, but I can't calculate or promise CAGR"],
    ['bhk', 'BHK means Bedroom, Hall, and Kitchen.'],
    ['ready_to_move', 'Ready-to-move means construction is complete'],
    ['identity', "I'm Naya, an AI property advisor."],
    ['data_collection', 'I use the details you share to help with your property search'],
    ['unknown_request', "I'm not sure what you'd like help with."],
  ])('%s uses reviewed fixed copy', (subject, expectedPrefix) => {
    const reply = speakFailure({
      kind: 'unsupported',
      stage: 'route',
      subject,
    });
    expect(reply).toContain(expectedPrefix);
  });

  it('preserves semantic diagnostics internally while the speaker sees one Failure', () => {
    const routing = mapIntentToRouting('about_ai', 0.82, INPUT, 0.68, true);
    expect(routing).toBeTruthy();
    const failure = failureFromUnsupportedRouting(routing!);
    expect(failure).toMatchObject({
      kind: 'unsupported',
      stage: 'route',
      subject: 'identity',
      detail: { policy: 'about_us', intent_kind: 'about_ai', score: 0.82 },
    });
  });
});

describe('Phase 2 turn contract', () => {
  function harness(kind: string): EngineDeps {
    const deps = fakeDeps();
    deps.failureRouting = true;
    deps.failureSearch = true;
    deps.routingEnv = {
      SIL_EMBED_FIRST: 'true',
      FAILURE_ROUTING: 'true',
      AI: { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) },
      INTENT_VECTORS: {
        query: async () => ({
          matches: [
            {
              id: `fixture-${kind}`,
              score: 0.9,
              metadata: { intent_kind: kind },
            },
          ],
        }),
      },
    } as unknown as NonNullable<EngineDeps['routingEnv']>;
    return deps;
  }

  it('terminates before search or LLM composition and records one route failure', async () => {
    const deps = harness('policy_prohibited');
    let actionPlan: Record<string, unknown> | undefined;
    deps.crm.appendTurnLedger = async (entry) => {
      actionPlan = entry.actionPlan;
    };
    const result = await runEngineTurn(
      {
        convId: 'fv2-policy',
        builderId: 'lokations',
        text: 'show me areas where only my caste lives',
        channel: 'advisor_web',
      },
      deps,
    );

    expect(result.reply).toMatch(/can't help filter homes or communities by caste/i);
    expect(result.debug.tools).toEqual([]);
    expect(result.state.phase).toBe('discover');
    expect(actionPlan).toMatchObject({
      failures: [
        {
          kind: 'unsupported',
          stage: 'route',
          subject: 'protected_identity_filter',
        },
      ],
    });
  });

  it('leaves Phase 2 behavior dark when the flag is off', async () => {
    const deps = harness('about_ai');
    deps.failureRouting = false;
    if (deps.routingEnv) deps.routingEnv.FAILURE_ROUTING = 'false';
    const result = await runEngineTurn(
      {
        convId: 'fv2-dark',
        builderId: 'lokations',
        text: 'are you a bot',
        channel: 'advisor_web',
      },
      deps,
    );
    expect(result.reply).not.toBe("I'm Naya, an AI property advisor. I can help you discover projects, compare factual details, and plan visits.");
  });

  it('does not let unknown recovery steal pending destructive-scope resolution', async () => {
    const deps = harness('opt_out');
    deps.failureTools = true;
    let queryCount = 0;
    deps.routingEnv!.INTENT_VECTORS = {
      query: async () => ({
        matches: [
          {
            id: 'fixture',
            score: 0.9,
            metadata: {
              intent_kind: queryCount++ === 0 ? 'opt_out' : 'novel_unmapped',
            },
          },
        ],
      }),
    } as unknown as NonNullable<EngineDeps['routingEnv']>['INTENT_VECTORS'];

    await runEngineTurn(
      {
        convId: 'fv2-pending-owner',
        builderId: 'lokations',
        text: "don't call me, only chat here",
        channel: 'advisor_web',
      },
      deps,
    );
    const result = await runEngineTurn(
      {
        convId: 'fv2-pending-owner',
        builderId: 'lokations',
        text: 'keep the chat',
        channel: 'advisor_web',
      },
      deps,
    );

    expect(result.reply).toMatch(/keep your property search/i);
    expect(result.reply).not.toMatch(/rephrase it/i);
  });

  it('keeps 3 BHK in Mumbai on search / empty-coverage, not BHK definition', async () => {
    const deps = harness('definition_bhk');
    const result = await runEngineTurn(
      {
        convId: 'fv2-mumbai-bhk',
        builderId: 'lokations',
        text: '3 BHK in Mumbai',
        channel: 'advisor_web',
      },
      deps,
    );
    expect(result.reply).not.toMatch(/BHK means Bedroom/i);
    // Mumbai is outside the fake catalog — city-level cover bit from servedCities.
    expect(result.state.constraints.location).toBeUndefined();
    expect(result.debug.goal).toMatchObject({ kind: 'no_fit' });
    expect(result.reply).toMatch(/don't have anything in \*Mumbai\*/i);
    expect(result.reply).toMatch(/only serve .+ micro-markets/i);
    expect(result.reply).toMatch(/Bengaluru/i);
    expect(result.reply).not.toMatch(/currently cover/i);
  });
});
