import { describe, expect, it } from 'vitest';
import { hydrateStateFromFeedForward, mapLedgerPrior } from '../src/engine/ledger-read.js';
import { initState } from '../src/engine/state.js';

describe('mapLedgerPrior', () => {
  it('returns null for missing prior', () => {
    expect(mapLedgerPrior(null)).toBeNull();
    expect(mapLedgerPrior(undefined)).toBeNull();
  });

  it('maps P2a-shaped prior into TurnFeedForward', () => {
    const ff = mapLedgerPrior({
      turn_index: 4,
      composer: 'converse_engine',
      reply_text: 'Want pricing on a specific size?',
      awaiting_response: true,
      offered_project_ids: ['eldorado'],
      disclosed_facts: [{ kind: 'price', statement: 'from 1.2 Cr', project_id: 'eldorado', source_tool: 'give_pricing' }],
      action_plan: { kind: 'answer', topic: 'availability' },
      resolved_intent: { speech_act: 'answer', ask_topics: ['availability'] },
      snapshot_in: {
        phase: 'focused',
        focus: { project_id: 'eldorado', name: 'Brigade Eldorado' },
        pending_prompt: {
          kind: 'offer_pricing',
          project_id: 'eldorado',
          project_name: 'Brigade Eldorado',
          topic: 'price',
          asked_at_turn: 4,
        },
      },
    });
    expect(ff).toMatchObject({
      priorTurnIndex: 4,
      priorGoalKind: 'answer',
      priorTopics: ['availability'],
      awaitingResponse: true,
      pendingPrompt: { kind: 'offer_pricing', topic: 'price' },
      focus: { projectId: 'eldorado', projectName: 'Brigade Eldorado' },
      phase: 'focused',
    });
    expect(ff!.priorReplyExcerpt).toContain('Want pricing');
    expect(ff!.disclosedFacts).toHaveLength(1);
  });
});

describe('hydrateStateFromFeedForward', () => {
  it('gap-fills rti + focus when KV is empty', () => {
    const base = initState('c1', 'brigade-group');
    const ff = mapLedgerPrior({
      turn_index: 3,
      composer: 'converse_engine',
      reply_text: 'Want pricing on a specific size?',
      awaiting_response: true,
      action_plan: { kind: 'answer', topic: 'price' },
      resolved_intent: { ask_topics: ['price'] },
      snapshot_in: {
        phase: 'focused',
        focus: { project_id: 'eldorado', name: 'Brigade Eldorado' },
        pending_prompt: { kind: 'offer_pricing', topic: 'price', asked_at_turn: 3 },
      },
    });
    const next = hydrateStateFromFeedForward(base, ff);
    expect(next.phase).toBe('focused');
    expect(next.focus).toEqual({ projectId: 'eldorado', projectName: 'Brigade Eldorado' });
    expect(next.rti?.pendingPrompt?.kind).toBe('offer_pricing');
    expect(next.rti?.lastGoalKind).toBe('answer');
    expect(next.rti?.lastReplyExcerpt).toContain('Want pricing');
    expect(next.feedForward?.priorTopics).toEqual(['price']);
  });

  it('does not overwrite live KV pendingPrompt or focus', () => {
    const base = {
      ...initState('c1', 'brigade-group'),
      phase: 'focused' as const,
      focus: { projectId: 'buena', projectName: 'Buena Vista' },
      rti: {
        pendingPrompt: { kind: 'offer_project' as const, project_id: 'buena', asked_at_turn: 2 },
        lastReplyExcerpt: 'live excerpt',
        lastGoalKind: 'recommend',
      },
    };
    const ff = mapLedgerPrior({
      turn_index: 3,
      composer: 'converse_engine',
      reply_text: 'ledger reply',
      awaiting_response: true,
      action_plan: { kind: 'answer' },
      snapshot_in: {
        phase: 'focused',
        focus: { project_id: 'eldorado', name: 'Brigade Eldorado' },
        pending_prompt: { kind: 'offer_pricing', asked_at_turn: 3 },
      },
    });
    const next = hydrateStateFromFeedForward(base, ff);
    expect(next.focus?.projectId).toBe('buena');
    expect(next.rti?.pendingPrompt?.kind).toBe('offer_project');
    expect(next.rti?.lastReplyExcerpt).toBe('live excerpt');
    expect(next.rti?.lastGoalKind).toBe('recommend');
    expect(next.feedForward?.priorTurnIndex).toBe(3);
  });
});
