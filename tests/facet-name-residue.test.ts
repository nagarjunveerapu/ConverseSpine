import { describe, expect, it } from 'vitest';
import { facetNameResidue, buyerCuedOtherProject } from '../src/engine/project_switch.js';

/**
 * AB-5 — a facet ask ("can I see the 2 BHK floor plan?") left dialogue/type noise
 * as the "name residue" ("can i", "villa sizes"), so hasExplicitProjectCue treated
 * it as a cue to a named OTHER project. That let an embedder HALLUCINATION (Century
 * Breeze) survive the focus scrub and answer the facet on the wrong project.
 */
describe('AB-5 — facetNameResidue strips dialogue + type words', () => {
  it('a pure facet ask leaves NO name residue', () => {
    expect(facetNameResidue('can I see the 2 BHK floor plan?')).toBe('');
    expect(facetNameResidue('what are the 4 BHK villa sizes and prices?')).toBe('');
    expect(facetNameResidue('send me the brochure')).toBe('');
    expect(facetNameResidue('is it plotted?')).toBe('');
  });

  it('a real project name still survives as residue', () => {
    expect(facetNameResidue('brochure for Krishnaja Greens')).toContain('krishnaja');
    expect(facetNameResidue('what about Krishnaja?')).toContain('krishnaja');
    expect(facetNameResidue('pricing on Eldorado')).toContain('eldorado');
  });
});

describe('AB-5 — buyerCuedOtherProject: facet asks do not cue a switch', () => {
  const pool = [{ name: 'Brigade Eldorado' }, { name: 'Krishnaja Greens' }, { name: 'Ayana' }];

  it('facet asks with no named project → not cued', () => {
    expect(buyerCuedOtherProject('can I see the 2 BHK floor plan?', pool)).toBe(false);
    expect(buyerCuedOtherProject('what are the 4 BHK villa sizes and prices?', pool)).toBe(false);
    expect(buyerCuedOtherProject('send me the brochure', pool)).toBe(false);
  });

  it('an explicitly named project → cued', () => {
    expect(buyerCuedOtherProject('brochure for Krishnaja Greens', pool)).toBe(true);
    expect(buyerCuedOtherProject('tell me about Ayana', pool)).toBe(true);
    expect(buyerCuedOtherProject('pricing on Eldorado', pool)).toBe(true);
  });
});
