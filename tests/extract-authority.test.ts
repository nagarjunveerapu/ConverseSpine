import { describe, expect, it } from 'vitest';
import {
  bridgeUnknownConfigAsk,
  mergeExtractedAuthority,
} from '../src/engine/extract-authority.js';
import {
  extractFactsSync,
  looksLikeConfigAsk,
  matchOfferedName,
} from '../src/engine/facts.js';
import { commitTo, initState, recordOffered } from '../src/engine/state.js';
import type { ChipResolution } from '../src/engine/speech-act/types.js';
import type { Extracted } from '../src/engine/types.js';

const UNKNOWN_CHIP: ChipResolution = {
  speechAct: 'unknown',
  primary: null,
  secondary: null,
  chipPathIds: [],
};

describe('mergeExtractedAuthority', () => {
  it('regex topics win over enriched topics', () => {
    const base: Extracted = {
      constraints: {},
      askTopic: 'price',
      askTopics: ['price'],
    };
    const enriched: Extracted = {
      constraints: {},
      askTopic: 'legal',
      askTopics: ['legal'],
    };
    const merged = mergeExtractedAuthority(base, enriched);
    expect(merged.askTopics).toEqual(['price']);
    expect(merged.askTopic).toBe('price');
  });

  it('fills topics from enrich only when regex left them empty', () => {
    const base: Extracted = { constraints: {} };
    const enriched: Extracted = {
      constraints: {},
      askTopic: 'price',
      askTopics: ['price'],
    };
    const merged = mergeExtractedAuthority(base, enriched);
    expect(merged.askTopics).toEqual(['price']);
  });

  it('does not apply enriched location on detail ask (price topic)', () => {
    const base: Extracted = {
      constraints: {},
      askTopics: ['price'],
      askTopic: 'price',
    };
    const enriched: Extracted = {
      constraints: { location: 'Coorg' },
      askTopics: ['price'],
      askTopic: 'price',
    };
    const merged = mergeExtractedAuthority(base, enriched);
    expect(merged.constraints.location).toBeUndefined();
  });

  it('applies enriched location when discover turn has no topics', () => {
    const base: Extracted = { constraints: {} };
    const enriched: Extracted = {
      constraints: { location: 'Whitefield' },
    };
    const merged = mergeExtractedAuthority(base, enriched);
    expect(merged.constraints.location).toBe('Whitefield');
  });

  it('regex location wins over enriched location', () => {
    const base: Extracted = {
      constraints: { location: 'Coorg' },
    };
    const enriched: Extracted = {
      constraints: { location: 'Whitefield' },
    };
    const merged = mergeExtractedAuthority(base, enriched);
    expect(merged.constraints.location).toBe('Coorg');
  });
});

describe('extractFactsSync + merge — focused breakdown unchanged', () => {
  it('phase0 regression: breakdown does not gain location via merge', () => {
    const s = commitTo(initState('c1', 'lokations'), 'ayana', 'Ayana');
    const base = extractFactsSync('breakdown of costs', s);
    const enriched: Extracted = {
      ...base,
      constraints: { ...base.constraints, location: 'Coorg' },
    };
    const merged = mergeExtractedAuthority(base, enriched);
    expect(merged.askTopics).toContain('price');
    expect(merged.constraints.location).toBeUndefined();
  });
});

describe('looksLikeConfigAsk + bridgeUnknownConfigAsk', () => {
  it('matches options / 2BHK (not bare option|bhk word-boundary)', () => {
    expect(looksLikeConfigAsk('what options are there for 2BHK in Eldorado')).toBe(true);
    expect(looksLikeConfigAsk('tell me about Eldorado')).toBe(false);
  });

  it('seeds availability on chip miss when shortlist name + config lexicon', () => {
    const base: Extracted = {
      constraints: {},
      namedProjects: [{ projectId: 'eldorado', name: 'Brigade Eldorado' }],
    };
    const bridged = bridgeUnknownConfigAsk(
      base,
      'what options are there for 2BHK in Eldorado',
      UNKNOWN_CHIP,
    );
    expect(bridged.askTopics).toEqual(['availability']);
  });

  it('does not seed when chip already resolved', () => {
    const resolved: ChipResolution = {
      speechAct: 'answer',
      primary: {
        id: 'chip.answer.price',
        act: 'answer',
        topic: 'price',
        source: 'free_text',
        confidence: 'rule',
      },
      secondary: null,
      chipPathIds: ['chip.answer.price'],
    };
    const bridged = bridgeUnknownConfigAsk(
      {
        constraints: {},
        namedProjects: [{ projectId: 'eldorado', name: 'Brigade Eldorado' }],
      },
      'what options are there for 2BHK in Eldorado',
      resolved,
    );
    expect(bridged.askTopics).toBeUndefined();
  });
});

describe('matchOfferedName — embedded shortlist in longer config asks', () => {
  const offered = [
    { projectId: 'orchards', name: 'Brigade Orchards' },
    { projectId: 'eldorado', name: 'Brigade Eldorado' },
  ];

  it('finds Eldorado inside "options for 2BHK in Eldorado"', () => {
    expect(matchOfferedName('what options are there for 2BHK in Eldorado', offered)).toBe(
      'Brigade Eldorado',
    );
  });

  it('still rejects long text without a shortlist token', () => {
    expect(matchOfferedName('what options are there for 2BHK near the airport', offered)).toBeUndefined();
  });

  it('resolveNamed collects multi shortlist names for visit lines', () => {
    let s = initState('c1', 'brigade-group');
    s = {
      ...s,
      discover: {
        ...s.discover,
        lastOffered: [
          { projectId: 'ayana', name: 'Ayana' },
          { projectId: 'krishnaja', name: 'Krishnaja Greens' },
        ],
      },
    };
    const ex = extractFactsSync('visit ayana and krishnaja', s);
    expect(ex.namedProjects?.map((p) => p.projectId).sort()).toEqual(['ayana', 'krishnaja']);
    expect(ex.transition).toBe('want_visit');
  });

  it('extractFactsSync names Eldorado + leaves topics empty for embedder/bridge', () => {
    let s = initState('c1', 'brigade-group');
    s = recordOffered(s, [
      {
        projectId: 'orchards',
        name: 'Brigade Orchards',
        microMarket: 'Devanahalli',
        startingPriceInr: 6_800_000,
        startingPriceDisplay: '₹68 L',
        matchReasons: [],
      },
      {
        projectId: 'eldorado',
        name: 'Brigade Eldorado',
        microMarket: 'Aerospace Park',
        startingPriceInr: 5_750_000,
        startingPriceDisplay: '₹57.5 L',
        matchReasons: [],
      },
    ]);
    const ex = extractFactsSync('what options are there for 2BHK in Eldorado', s);
    expect(ex.namedProjects?.[0]?.name ?? ex.pickName).toMatch(/Eldorado/i);
    // Chip aliases do not fire — novel phrasing stays topic-empty for bridge/INTENT
    expect(ex.askTopics ?? []).not.toContain('availability');
  });
});
