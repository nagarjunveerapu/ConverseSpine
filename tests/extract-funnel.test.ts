import { describe, expect, it, vi } from 'vitest';
import { extractTurnAuthority, mergeExtractedAuthority } from '../src/engine/extract-authority.js';
import { extractFactsChip, extractFactsSync } from '../src/engine/facts.js';
import { hasTextOverride, isSlotWritable, resolveInputSource } from '../src/engine/ingress.js';
import { ingressFilledSlotsFromPreferences } from '../src/advisor/apply-preferences.js';
import { commitTo, initState } from '../src/engine/state.js';
import type { EngineLlm } from '../src/engine/ports.js';
import type { SemanticNluPort } from '../src/engine/adapters/semantic-nlu.js';

describe('resolveInputSource', () => {
  it('chip when action_id present', () => {
    expect(resolveInputSource('clear_bhk')).toBe('chip');
  });
  it('free_text when no action_id', () => {
    expect(resolveInputSource()).toBe('free_text');
    expect(resolveInputSource('')).toBe('free_text');
  });
});

describe('ingressFilledSlotsFromPreferences', () => {
  it('collects set preference keys', () => {
    const slots = ingressFilledSlotsFromPreferences({
      location: 'Whitefield',
      budget: '1.2 cr',
      bhk: '3 BHK',
      property_type: 'open to suggestions',
    });
    expect(slots).toEqual(['location', 'budget', 'bhk']);
  });
});

describe('text override', () => {
  it('detects override cues', () => {
    expect(hasTextOverride('actually near Coorg instead')).toBe(true);
    expect(hasTextOverride('show me options')).toBe(false);
  });
  it('re-opens ingress-filled slot', () => {
    const filled = new Set(['location'] as const);
    expect(isSlotWritable('location', filled, 'show options')).toBe(false);
    expect(isSlotWritable('location', filled, 'actually near Coorg')).toBe(true);
  });
});

describe('extractFactsChip', () => {
  it('returns dialogue signals only — no constraints', () => {
    const ex = extractFactsChip('yes');
    expect(ex.affirm).toBe(true);
    expect(ex.constraints).toEqual({});
  });
});

describe('extractFactsSync ingress mask', () => {
  it('ING-G01: skips location when UI filled', () => {
    const s = initState('c1', 'lokations');
    const filled = new Set(['location'] as const);
    const ex = extractFactsSync('show me options in Whitefield', s, {
      inputSource: 'free_text',
      ingressFilledSlots: filled,
    });
    expect(ex.constraints.location).toBeUndefined();
  });

  it('OVR-G01: override allows location parse', () => {
    const s = initState('c1', 'lokations');
    const filled = new Set(['location'] as const);
    const ex = extractFactsSync('actually near Coorg instead', s, {
      inputSource: 'free_text',
      ingressFilledSlots: filled,
    });
    expect(ex.constraints.location).toBe('Coorg');
  });
});

describe('extractTurnAuthority chip path', () => {
  it('CHIP-G01: chip skips enrich ladder', async () => {
    const enrich = vi.fn();
    const llm: EngineLlm = {
      extractSignals: vi.fn().mockResolvedValue([]),
      compose: vi.fn(),
    };
    const semantic: SemanticNluPort = { enrich };

    const result = await extractTurnAuthority(
      'Clear BHK',
      initState('c1', 'lokations'),
      'lokations',
      { llm, semantic, microMarkets: [] },
      { inputSource: 'chip' },
    );

    expect(result.provenance.path).toBe('chip_skip');
    expect(result.extracted.constraints).toEqual({});
    expect(enrich).not.toHaveBeenCalled();
    expect(llm.extractSignals).not.toHaveBeenCalled();
  });
});

describe('intent-first — phase0 regression', () => {
  it('breakdown of costs @ focused has price topic, no location', () => {
    const s = commitTo(initState('c1', 'lokations'), 'ayana', 'Ayana');
    const base = extractFactsSync('breakdown of costs', s);
    const enriched = {
      ...base,
      constraints: { ...base.constraints, location: 'Coorg' },
    };
    const merged = mergeExtractedAuthority(base, enriched);
    expect(merged.askTopics).toContain('price');
    expect(merged.constraints.location).toBeUndefined();
  });
});
