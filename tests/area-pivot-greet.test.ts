import { describe, expect, it, vi } from 'vitest';
import { extractLocation, extractFactsSync } from '../src/engine/facts.js';
import { extractTurnAuthority } from '../src/engine/extract-authority.js';
import { buildComposeRequest, fallbackReply } from '../src/engine/compose.js';
import { decide } from '../src/engine/phases/discover.js';
import { initState } from '../src/engine/state.js';
import type { EngineLlm } from '../src/engine/ports.js';
import type { SemanticNluPort } from '../src/engine/adapters/semantic-nlu.js';
import type { Extracted } from '../src/engine/types.js';

describe('builder-named greet', () => {
  it('names the builder on first greet', () => {
    const req = buildComposeRequest(
      { kind: 'greet' },
      { tools: [] },
      {
        builderName: 'Brigade Group',
        buyerName: '',
        constraints: {},
        channel: 'api',
      },
    );
    const reply = fallbackReply(req);
    expect(reply).toMatch(/Brigade Group/i);
    expect(reply).toMatch(/welcome|you'?re with/i);
  });
});

describe('same-budget must not become a locality', () => {
  it('extracts Sarjapur, not same', () => {
    expect(
      extractLocation('do you have any apartments in same budget in Sarjapur area?'),
    ).toBe('Sarjapur');
  });
});

describe('area pivot vs project-pick sinkhole', () => {
  function boardState() {
    const base = initState('c', 'brigade-group');
    return {
      ...base,
      constraints: {
        bhk: '2 BHK',
        location: 'Nelamangala',
        budgetMaxInr: 8_000_000,
        propertyType: 'apartment',
      },
      discover: {
        ...base.discover,
        oriented: true,
        lastOffered: [
          { projectId: 'brigade-eldorado', name: 'Brigade Eldorado', microMarket: 'Devanahalli' },
          { projectId: 'brigade-cornerstone', name: 'Brigade Cornerstone', microMarket: 'Devanahalli' },
        ],
      },
    };
  }

  it('What about Sarjapur? extracts place and recommends search, not clarify pick', () => {
    expect(extractLocation('What about Sarjapur?')).toBe('Sarjapur');
    const s = boardState();
    const withSearch: Extracted = {
      ...extractFactsSync('What about Sarjapur?', s),
      speechAct: 'search',
      constraints: { location: 'Sarjapur' },
    };
    expect(decide(s, withSearch, 'What about Sarjapur?').kind).toBe('recommend');
  });

  it('Sarjapur area? is a place', () => {
    expect(extractLocation('Sarjapur area?')).toBe('Sarjapur');
  });

  it('authority forces search when overview/answer would wipe the place', async () => {
    const s = boardState();
    const llm: EngineLlm = {
      extractSignals: vi.fn().mockResolvedValue([]),
      compose: vi.fn(),
    };
    const semantic: SemanticNluPort = {
      enrich: async (_t, _b, base) => ({
        ...base,
        speechAct: 'answer',
        transition: 'want_details',
        askTopic: 'overview',
        askTopics: ['overview'],
        constraints: { ...base.constraints, location: undefined },
      }),
    };
    const { extracted } = await extractTurnAuthority(
      'What about Sarjapur?',
      s,
      'brigade-group',
      { llm, semantic, microMarkets: [] },
      { inputSource: 'free_text' },
    );
    expect(extracted.speechAct).toBe('search');
    expect(extracted.constraints.location).toMatch(/Sarjapur/i);
    expect(decide(s, extracted, 'What about Sarjapur?').kind).toBe('recommend');
  });
});
