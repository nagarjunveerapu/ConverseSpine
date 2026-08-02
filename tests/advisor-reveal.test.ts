import { describe, expect, it } from 'vitest';
import { normalizeRevealPhone, resolveSourceRouting } from '../src/advisor/handle-reveal.js';

describe('resolveSourceRouting', () => {
  it('reads source_* from bot_hints_json', () => {
    const r = resolveSourceRouting({
      advisorProjectId: 'ayana-naya-advisor',
      botHintsJson: JSON.stringify({
        source_builder_id: 'lokations',
        source_project_id: 'ayana',
      }),
      projectName: 'Ayana',
    });
    expect(r).toEqual({
      sourceBuilderId: 'lokations',
      sourceProjectId: 'ayana',
      projectName: 'Ayana',
    });
  });

  it('falls back to stripped project id when hint project missing', () => {
    const r = resolveSourceRouting({
      advisorProjectId: 'brigade-eldorado-naya-advisor',
      botHintsJson: JSON.stringify({ source_builder_id: 'brigade-group' }),
      projectName: 'Brigade Eldorado',
    });
    expect(r).toEqual({
      sourceBuilderId: 'brigade-group',
      sourceProjectId: 'brigade-eldorado',
      projectName: 'Brigade Eldorado',
    });
  });

  it('errors when source_builder_id missing', () => {
    const r = resolveSourceRouting({
      advisorProjectId: 'ayana-naya-advisor',
      botHintsJson: '{}',
    });
    expect(r).toEqual({ error: 'source_builder_missing' });
  });

  it('rejects invalid hints JSON', () => {
    const r = resolveSourceRouting({
      advisorProjectId: 'ayana-naya-advisor',
      botHintsJson: '{',
    });
    expect(r).toEqual({ error: 'bot_hints_invalid' });
  });
});

describe('normalizeRevealPhone', () => {
  it('accepts 10-digit local and +91 forms', () => {
    expect(normalizeRevealPhone('9876543210')).toBe('+919876543210');
    expect(normalizeRevealPhone('+91 98765 43210')).toBe('+919876543210');
    expect(normalizeRevealPhone('919876543210')).toBe('+919876543210');
  });

  it('rejects short numbers', () => {
    expect(normalizeRevealPhone('12345')).toBeNull();
  });
});
