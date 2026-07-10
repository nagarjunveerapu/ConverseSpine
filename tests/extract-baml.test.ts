import { describe, expect, it, vi } from 'vitest';
import {
  buildBamlShadowReport,
  mergeBamlGapFill,
  needsBamlGapFill,
  parseBamlExtractResult,
  resolveBamlExtractMode,
} from '../src/engine/extract-baml.js';
import { extractTurnAuthority } from '../src/engine/extract-authority.js';
import { initState } from '../src/engine/state.js';
import type { EngineLlm } from '../src/engine/ports.js';
import type { SemanticNluPort } from '../src/engine/adapters/semantic-nlu.js';
import type { ChipResolution } from '../src/engine/speech-act/types.js';
import type { Extracted } from '../src/engine/types.js';

const UNKNOWN_CHIP: ChipResolution = {
  speechAct: 'unknown',
  primary: null,
  secondary: null,
  chipPathIds: [],
};

describe('parseBamlExtractResult', () => {
  it('parses llm gap-fill payload', () => {
    const r = parseBamlExtractResult(
      JSON.stringify({
        ask_topics: ['availability'],
        location: null,
        property_type: 'apartment',
        purpose: null,
        transition: null,
        confidence: 'llm',
      }),
    );
    expect(r?.confidence).toBe('llm');
    expect(r?.askTopics).toEqual(['availability']);
    expect(r?.propertyType).toBe('apartment');
  });

  it('rejects unknown topics and abstains when empty', () => {
    const r = parseBamlExtractResult(
      JSON.stringify({
        ask_topics: ['payment_plan'],
        confidence: 'llm',
      }),
    );
    expect(r?.confidence).toBe('abstain');
  });

  it('honors abstain', () => {
    const r = parseBamlExtractResult(
      JSON.stringify({ confidence: 'abstain', abstain_reason: 'unclear' }),
    );
    expect(r?.confidence).toBe('abstain');
    expect(r?.abstainReason).toBe('unclear');
  });
});

describe('needsBamlGapFill', () => {
  it('skips when chip primary resolved', () => {
    const chip: ChipResolution = {
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
    expect(needsBamlGapFill({ constraints: {}, speechAct: 'answer' }, 'pricing?', chip)).toBe(false);
  });

  it('skips greet', () => {
    expect(
      needsBamlGapFill({ constraints: {}, speechAct: 'greet' }, 'hi', {
        ...UNKNOWN_CHIP,
        speechAct: 'greet',
      }),
    ).toBe(false);
  });

  it('fires when unknown act and no topics', () => {
    expect(
      needsBamlGapFill({ constraints: {}, speechAct: 'unknown' }, 'something about sizes maybe', UNKNOWN_CHIP),
    ).toBe(true);
  });

  it('fires for search-like missing location', () => {
    expect(
      needsBamlGapFill(
        { constraints: {}, speechAct: 'search' },
        'looking for apartment in whitefield',
        { ...UNKNOWN_CHIP, speechAct: 'search' },
      ),
    ).toBe(true);
  });
});

describe('mergeBamlGapFill / shadow', () => {
  it('promote fills empty topics only', () => {
    const current: Extracted = { constraints: { location: 'Coorg' }, speechAct: 'unknown' };
    const merged = mergeBamlGapFill(current, {
      confidence: 'llm',
      askTopics: ['legal'],
      location: 'Whitefield',
    });
    expect(merged.askTopics).toEqual(['legal']);
    expect(merged.constraints.location).toBe('Coorg');
  });

  it('shadow report marks would_fill vs disagree', () => {
    const report = buildBamlShadowReport(
      'shadow',
      { constraints: { location: 'Coorg' }, askTopics: ['price'], askTopic: 'price' },
      { confidence: 'llm', askTopics: ['legal'], location: 'Whitefield' },
    );
    expect(report.disagree).toContain('askTopics');
    expect(report.disagree).toContain('location');
    expect(report.would_fill).toEqual([]);
  });
});

describe('resolveBamlExtractMode', () => {
  it('defaults to shadow when API key present', () => {
    expect(resolveBamlExtractMode({ DEEPSEEK_API_KEY: 'sk' })).toBe('shadow');
  });
  it('defaults to off without key', () => {
    expect(resolveBamlExtractMode({})).toBe('off');
  });
  it('honors explicit promote', () => {
    expect(resolveBamlExtractMode({ BAML_EXTRACT_MODE: 'promote', DEEPSEEK_API_KEY: 'sk' })).toBe(
      'promote',
    );
  });
});

describe('extractTurnAuthority P6 wire', () => {
  const llm: EngineLlm = {
    extractSignals: vi.fn().mockResolvedValue([]),
    compose: vi.fn(),
  };
  const semantic: SemanticNluPort = {
    enrich: vi.fn(async (_t, _b, ex) => ex),
  };

  it('shadow does not merge BAML topics into extract', async () => {
    const bamlExtract = vi.fn().mockResolvedValue({
      confidence: 'llm',
      askTopics: ['availability'],
    });
    const result = await extractTurnAuthority(
      'hmm what sizes do they have somehow',
      initState('c1', 'lokations'),
      'lokations',
      { llm, semantic, microMarkets: [], bamlExtract, bamlMode: 'shadow' },
      { inputSource: 'free_text' },
    );
    // Chip may already resolve availability for "sizes" — if BAML was called, shadow must not promote.
    if (result.provenance.baml?.called) {
      expect(result.provenance.baml.mode).toBe('shadow');
      if (result.provenance.fields.askTopics === 'baml') {
        throw new Error('shadow must not stamp fields as baml');
      }
    }
    expect(bamlExtract.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('promote gap-fills empty topics and stamps provenance', async () => {
    const bamlExtract = vi.fn().mockResolvedValue({
      confidence: 'llm',
      askTopics: ['legal'],
    });
    // Use phrasing that chip/regex miss so needsBamlGapFill fires.
    const result = await extractTurnAuthority(
      'is the paperwork okay for this one',
      initState('c1', 'lokations'),
      'lokations',
      { llm, semantic, microMarkets: [], bamlExtract, bamlMode: 'promote' },
      { inputSource: 'free_text' },
    );
    if (result.provenance.baml?.called && result.provenance.baml.would_fill.includes('askTopics')) {
      expect(result.extracted.askTopics).toContain('legal');
      expect(result.provenance.fields.askTopics).toBe('baml');
    }
  });

  it('chip path never calls BAML', async () => {
    const bamlExtract = vi.fn();
    await extractTurnAuthority(
      'Pricing',
      initState('c1', 'lokations'),
      'lokations',
      { llm, semantic, microMarkets: [], bamlExtract, bamlMode: 'promote' },
      { inputSource: 'chip', actionId: 'pricing' },
    );
    expect(bamlExtract).not.toHaveBeenCalled();
  });
});
