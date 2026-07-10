import { describe, expect, it } from 'vitest';
import { projectRoutingFromSpeechAct } from '../src/engine/turn-routing/from-speech-act.js';
import { classifyTurnRouting, classifyTurnRoutingRules } from '../src/engine/turn-routing/classify.js';
import type { TurnRoutingInput } from '../src/engine/turn-routing/types.js';
import { classifySpeechAct } from '../src/engine/speech-act/resolve.js';

function base(partial: Partial<TurnRoutingInput>): TurnRoutingInput {
  return {
    text: '',
    builder_id: 'brigade-group',
    phase: 'discover',
    named_project_ids: [],
    ...partial,
  };
}

describe('SA-4 speech-act → routing projection', () => {
  it('answer + availability → answer_on_project', () => {
    const r = projectRoutingFromSpeechAct(
      base({
        text: '2 BHK configs',
        ask_topic: 'availability',
        speech_act: 'answer',
        focus: { project_id: 'eldorado', project_name: 'Brigade Eldorado' },
        phase: 'focused',
      }),
    );
    expect(r?.routing).toBe('answer_on_project');
    expect(r?.answer_topic).toBe('availability');
  });

  it('visit_book → visit_schedule_stop', () => {
    const r = projectRoutingFromSpeechAct(
      base({ text: 'come for the visit', speech_act: 'visit_book', named_project_ids: ['eldorado'] }),
    );
    expect(r?.routing).toBe('visit_schedule_stop');
  });

  it('compare → compare_offered', () => {
    const r = projectRoutingFromSpeechAct(base({ text: 'compare both', speech_act: 'compare' }));
    expect(r?.routing).toBe('compare_offered');
  });

  it('unknown returns null so rules/embedder gap-fill', () => {
    expect(projectRoutingFromSpeechAct(base({ text: 'hmm', speech_act: 'unknown' }))).toBeNull();
  });

  it('classifyTurnRouting prefers speech-act over bare rules when known', async () => {
    const input = base({
      text: 'legal status',
      ask_topic: 'legal',
      speech_act: 'answer',
      phase: 'focused',
      focus: { project_id: 'ayana', project_name: 'Ayana' },
    });
    const r = await classifyTurnRouting(undefined, input);
    expect(r.routing).toBe('answer_on_project');
    expect(r.answer_topic).toBe('legal');
    expect(r.confidence).toBe('rule');
  });

  it('visit follow-up beats speech-act overview (V02)', async () => {
    const input = base({
      text: 'what about Eldorado?',
      speech_act: 'answer',
      ask_topic: 'overview',
      phase: 'visit',
      named_project_ids: ['eldorado'],
      visit: { booked_count: 1, queued_count: 1, awaiting_confirm: false, project_id: 'cornerstone' },
    });
    const r = await classifyTurnRouting(undefined, input);
    expect(r.routing).toBe('visit_schedule_stop');
  });

  it('bare what about resolves to overview chip (not visit) without visit context', () => {
    const chip = classifySpeechAct({ text: 'what about Krishnaja?' });
    expect(chip.speechAct).toBe('answer');
    expect(chip.primary?.topic).toBe('overview');
  });

  it('what about visiting → visit_book', () => {
    const chip = classifySpeechAct({ text: 'what about visiting Eldorado?' });
    expect(chip.speechAct).toBe('visit_book');
  });

  it('rules still mark deferrable topics without speech_act', () => {
    const r = classifyTurnRoutingRules(
      base({ text: 'pricing', ask_topic: 'price', named_project_ids: ['eldorado'] }),
    );
    expect(r.routing).toBe('answer_on_project');
    expect(r.answer_topic).toBe('price');
  });
});
