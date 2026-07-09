import { describe, expect, it } from 'vitest';
import { mergeExtractedAuthority } from '../src/engine/extract-authority.js';
import { extractFactsSync } from '../src/engine/facts.js';
import { commitTo, initState } from '../src/engine/state.js';
import type { Extracted } from '../src/engine/types.js';

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
