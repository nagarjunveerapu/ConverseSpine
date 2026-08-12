import { describe, expect, it } from 'vitest';
import { mergeEvidencePatches } from '../src/engine/merge-evidence-patches.js';
import type { EvidenceSet } from '../src/engine/types.js';

describe('mergeEvidencePatches', () => {
  it('unions tools and preserves later patch field winners in caller order', () => {
    const a: EvidenceSet = {
      tools: ['pricing'],
      toolLatencyMs: { pricing: 10 },
      pricing: {
        projectName: 'A',
        components: [{ label: 'Base', value: '1' }],
      },
    };
    const b: EvidenceSet = {
      tools: ['mediaShare'],
      media: {
        assetKind: 'brochure',
        allowed: true,
        projectName: 'A',
        cdnUrl: 'https://example/brochure.pdf',
      },
    };
    const c: EvidenceSet = {
      tools: ['faqLookup'],
      toolFailureReason: { faqLookup: 'absent' },
      detail: {
        projectId: 'p1',
        name: 'A',
        microMarket: '',
        faqs: [{ questionKey: 'rera_number', question: 'RERA?', answer: 'PRM123' }],
      },
    };
    // Reverse settlement order must not change winners when caller passes [a,b,c].
    const merged = mergeEvidencePatches({ tools: [] }, [a, b, c]);
    expect(merged.tools.sort()).toEqual(['faqLookup', 'mediaShare', 'pricing']);
    expect(merged.pricing?.projectName).toBe('A');
    expect(merged.media?.assetKind).toBe('brochure');
    expect(merged.detail?.faqs?.[0]?.answer).toBe('PRM123');
    expect(merged.toolLatencyMs?.pricing).toBe(10);
    expect(merged.toolFailureReason?.faqLookup).toBe('absent');
  });

  it('does not wipe earlier fields with empty later patches', () => {
    const priced: EvidenceSet = {
      tools: ['pricing'],
      pricing: {
        projectName: 'Eldorado',
        components: [{ label: 'Base', value: '₹31 L' }],
      },
    };
    const empty: EvidenceSet = { tools: [] };
    const merged = mergeEvidencePatches({ tools: [] }, [priced, empty]);
    expect(merged.pricing?.projectName).toBe('Eldorado');
    expect(merged.tools).toEqual(['pricing']);
  });
});
