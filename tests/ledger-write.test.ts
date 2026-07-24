import { describe, expect, it } from 'vitest';
import { buildLedgerWritePayload } from '../src/engine/ledger-write.js';
import { commitTo, initState } from '../src/engine/state.js';
import type { Extracted } from '../src/engine/types.js';

describe('buildLedgerWritePayload — P2a / SA-5', () => {
  it('records speech_act, ask_topics, snapshot focus, and action_plan', () => {
    let state = commitTo(initState('c1', 'brigade-group'), 'brigade-eldorado', 'Brigade Eldorado');
    state = {
      ...state,
      turnCount: 4,
      constraints: { bhk: '2 BHK', location: 'North Bangalore' },
      discover: {
        ...state.discover,
        lastOffered: [
          { projectId: 'brigade-eldorado', name: 'Brigade Eldorado' },
          { projectId: 'brigade-orchards', name: 'Brigade Orchards' },
        ],
      },
      rti: {
        pendingPrompt: {
          kind: 'offer_pricing',
          project_id: 'brigade-eldorado',
          topic: 'price',
          asked_at_turn: 3,
        },
        lastUiMode: 'focused',
      },
    };

    const ex: Extracted = {
      constraints: { bhk: '2 BHK' },
      transition: 'none',
      askTopic: 'availability',
      askTopics: ['availability'],
      speechAct: 'answer',
      chipPathIds: ['chip.answer.availability'],
    };

    const payload = buildLedgerWritePayload({
      state,
      ex,
      goal: { kind: 'answer', topic: 'availability', projectId: 'brigade-eldorado' },
      evidence: {
        tools: ['listUnits', 'detail'],
        units: [{ unitType: '2 BHK', priceDisplay: '₹57L', sizeDisplay: '740 sqft' }],
      },
      inputSource: 'free_text',
      extractProvenance: {
        path: 'free_text_funnel',
        fields: { askTopics: 'chip_resolve' },
        speech_act: 'answer',
        chip_path_ids: ['chip.answer.availability'],
      },
      grounding: 'pass',
      failures: [
        {
          kind: 'relaxed',
          stage: 'search',
          subject: 'recommendation',
          dimensions: ['size'],
          detail: { rawBuyerText: 'must not persist' },
        },
      ],
    });

    expect(payload.resolved_intent.speech_act).toBe('answer');
    expect(payload.resolved_intent.ask_topics).toEqual(['availability']);
    expect(payload.action_plan).toMatchObject({
      kind: 'answer',
      topic: 'availability',
      project_id: 'brigade-eldorado',
      failures: [
        {
          kind: 'relaxed',
          stage: 'search',
          subject: 'recommendation',
          dimensions: ['size'],
        },
      ],
    });
    expect(JSON.stringify(payload.action_plan)).not.toContain('rawBuyerText');
    expect(payload.snapshot_in).toMatchObject({
      phase: 'focused',
      focus: { project_id: 'brigade-eldorado', name: 'Brigade Eldorado' },
      input_source: 'free_text',
      pending_prompt: { kind: 'offer_pricing' },
    });
    expect(payload.offered_project_ids).toContain('brigade-eldorado');
    expect(payload.tool_runs.map((t) => t.name)).toEqual(['listUnits', 'detail']);
    expect(payload.verify).toMatchObject({
      grounding: 'pass',
      over_answer: {
        topics_asked: ['availability'],
        education_delivered: false,
      },
    });
    expect(payload.disclosed_facts.some((f) => f.kind === 'availability')).toBe(true);
  });
});
