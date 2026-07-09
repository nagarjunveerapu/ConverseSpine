import { describe, expect, it } from 'vitest';
import {
  classifySpeechAct,
  resolveActionIdToChipPath,
  resolveFreeTextToChipPaths,
} from '../src/engine/speech-act/index.js';
import { applyChipPathSeeds, stampSpeechAct } from '../src/engine/extract-authority.js';
import type { Extracted } from '../src/engine/types.js';

describe('resolveFreeTextToChipPaths — catalog examples', () => {
  it('can you compare the projects → Compare', () => {
    const r = resolveFreeTextToChipPaths('can you compare the projects');
    expect(r.speechAct).toBe('compare');
    expect(r.primary?.id).toBe('chip.compare');
    expect(r.chipPathIds).toEqual(['chip.compare']);
  });

  it('are there any legal issues? → Legal + Objection', () => {
    const r = resolveFreeTextToChipPaths('are there any legal issues?');
    expect(r.speechAct).toBe('answer');
    expect(r.primary?.id).toBe('chip.answer.legal');
    expect(r.primary?.topic).toBe('legal');
    expect(r.secondary?.id).toBe('chip.object');
    expect(r.chipPathIds).toEqual(['chip.answer.legal', 'chip.object']);
  });

  it('plot sizes offered? → Configurations / availability', () => {
    const r = resolveFreeTextToChipPaths('plot sizes offered?');
    expect(r.speechAct).toBe('answer');
    expect(r.primary?.id).toBe('chip.answer.availability');
    expect(r.primary?.topic).toBe('availability');
  });

  it('ok lets do a site visit → Book visit', () => {
    const r = resolveFreeTextToChipPaths('ok lets do a site visit');
    expect(r.speechAct).toBe('visit_book');
    expect(r.primary?.id).toBe('chip.visit_book');
  });

  it('tell me about my visits → My visits', () => {
    const r = resolveFreeTextToChipPaths('tell me about my visits');
    expect(r.speechAct).toBe('visit_recall');
    expect(r.primary?.id).toBe('chip.visit_recall');
  });

  it('come for the visit → visit_book not recall', () => {
    const r = resolveFreeTextToChipPaths('come for the visit');
    expect(r.speechAct).toBe('visit_book');
  });

  it('any discount? → object', () => {
    const r = resolveFreeTextToChipPaths('any discount?');
    expect(r.speechAct).toBe('object');
  });

  it('unmatched free text → unknown (embedder/LLM later)', () => {
    const r = resolveFreeTextToChipPaths('hmm interesting');
    expect(r.speechAct).toBe('unknown');
    expect(r.primary).toBeNull();
  });
});

describe('resolveActionIdToChipPath — chip tap', () => {
  it('compare_projects action_id → compare', () => {
    const r = resolveActionIdToChipPath('compare_projects');
    expect(r.speechAct).toBe('compare');
    expect(r.primary?.source).toBe('action_id');
  });

  it('legal action_id → answer legal', () => {
    const r = resolveActionIdToChipPath('legal');
    expect(r.speechAct).toBe('answer');
    expect(r.primary?.topic).toBe('legal');
  });

  it('recovery relax_* → search', () => {
    const r = resolveActionIdToChipPath('relax_bhk:drop');
    expect(r.speechAct).toBe('search');
  });
});

describe('classifySpeechAct — action_id wins over free text', () => {
  it('action_id outranks typed label', () => {
    const r = classifySpeechAct({
      text: 'can you compare the projects',
      actionId: 'answer_legal',
    });
    expect(r.speechAct).toBe('answer');
    expect(r.primary?.topic).toBe('legal');
  });

  it('free text when no action_id', () => {
    const r = classifySpeechAct({ text: 'can you compare the projects' });
    expect(r.speechAct).toBe('compare');
  });
});

describe('applyChipPathSeeds', () => {
  it('seeds askTopics from chip when extract empty', () => {
    const r = resolveFreeTextToChipPaths('plot sizes offered?');
    const seeded = applyChipPathSeeds({ constraints: {} }, r);
    expect(seeded.askTopics).toEqual(['availability']);
    expect(seeded.askTopic).toBe('availability');
  });

  it('seeds recall; legal+issues does not set objection primary', () => {
    const legal = resolveFreeTextToChipPaths('are there any legal issues?');
    expect(legal.secondary?.id).toBe('chip.object');
    const seeded = applyChipPathSeeds({ constraints: {}, askTopics: ['legal'], askTopic: 'legal' }, legal);
    expect(seeded.objection).toBeUndefined();
    expect(seeded.askTopic).toBe('legal');

    const recall = resolveFreeTextToChipPaths('my visits');
    const seededRecall = applyChipPathSeeds({ constraints: {} }, recall);
    expect(seededRecall.recall).toBe(true);
  });

  it('visit_book clears legacy recall flag from "the visit"', () => {
    const r = resolveFreeTextToChipPaths('come for the visit');
    expect(r.speechAct).toBe('visit_book');
    const seeded = applyChipPathSeeds(
      { constraints: {}, recall: true, transition: 'none' },
      r,
    );
    expect(seeded.recall).toBeUndefined();
    expect(seeded.transition).toBe('want_visit');
  });

  it('stampSpeechAct writes speechAct + chipPathIds', () => {
    const r = resolveFreeTextToChipPaths('can you compare the projects');
    const stamped = stampSpeechAct({ constraints: {} } as Extracted, r);
    expect(stamped.speechAct).toBe('compare');
    expect(stamped.chipPathIds).toEqual(['chip.compare']);
  });
});

describe('SA-1 permissions', () => {
  it('answer act strips propertyType from plot sizes extract', async () => {
    const { applySpeechActPermissions } = await import('../src/engine/speech-act/permissions.js');
    const r = resolveFreeTextToChipPaths('what plot sizes are offered?');
    expect(r.speechAct).toBe('answer');
    const stripped = applySpeechActPermissions(
      { constraints: { propertyType: 'plot' }, askTopic: 'availability', askTopics: ['availability'] },
      r,
    );
    expect(stripped.constraints.propertyType).toBeUndefined();
    expect(stripped.askTopics).toEqual(['availability']);
  });

  it('search act keeps propertyType', async () => {
    const { applySpeechActPermissions } = await import('../src/engine/speech-act/permissions.js');
    const r = resolveFreeTextToChipPaths('show me more projects');
    const kept = applySpeechActPermissions({ constraints: { propertyType: 'apartment' } }, r);
    expect(kept.constraints.propertyType).toBe('apartment');
  });

  it('plot sizes is not a focused search pivot', async () => {
    const { isFocusedSearchPivot } = await import('../src/engine/turn-intent/focused-intent.js');
    expect(isFocusedSearchPivot('what plot sizes are offered?')).toBe(false);
    expect(isFocusedSearchPivot('Bangalore projects')).toBe(true);
  });
});
