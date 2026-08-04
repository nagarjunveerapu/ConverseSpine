import { describe, expect, it, vi } from 'vitest';
import {
  handleAdvisorReveal,
  normalizeRevealPhone,
  resolveSourceRouting,
} from '../src/advisor/handle-reveal.js';
import type { ConverseRuntime } from '../src/runtime/deps.js';

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

describe('handleAdvisorReveal upsert payload', () => {
  it('upserts lead on source builder with source=naya_advisor', async () => {
    const upsertLead = vi.fn().mockResolvedValue({
      ok: true,
      conversation_id: 'conv:a5-test',
      created: true,
    });
    const appendMessage = vi.fn().mockResolvedValue(undefined);
    const getProject = vi.fn().mockResolvedValue({
      project_id: 'brigade-eldorado-naya-advisor',
      name: 'Brigade Eldorado',
      bot_hints_json: JSON.stringify({
        source_builder_id: 'brigade-group',
        source_project_id: 'brigade-eldorado',
      }),
    });

    const rt = {
      crm: { getProject, upsertLead },
      engine: { crm: { appendMessage } },
    } as unknown as ConverseRuntime;

    const resp = await handleAdvisorReveal(rt, {
      session_id: 'sess-a5',
      project_id: 'brigade-eldorado-naya-advisor',
      buyer_phone: '9876543210',
      buyer_name: 'Priya',
      visit_label: 'Saturday 11:00',
      preferences: { bhk: '2 BHK', budget: '₹80L' },
    });

    expect(resp).toMatchObject({
      status: 'ok',
      source_builder_id: 'brigade-group',
      source_project_id: 'brigade-eldorado',
      conversation_id: 'conv:a5-test',
      created: true,
    });
    expect(upsertLead).toHaveBeenCalledWith(
      expect.objectContaining({
        builder_id: 'brigade-group',
        project_id: 'brigade-eldorado',
        buyer_phone: '+919876543210',
        buyer_name: 'Priya',
        channel: 'advisor_web',
        source: 'naya_advisor',
        source_detail: 'advisor_reveal',
        bhk_preference: '2 BHK',
        budget_inr: '₹80L',
        visit_date_pref: 'Saturday 11:00',
      }),
    );
    expect(upsertLead.mock.calls[0]![0].builder_id).not.toBe('naya-advisor');
  });
});
