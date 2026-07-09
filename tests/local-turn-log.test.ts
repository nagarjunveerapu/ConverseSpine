import { describe, expect, it } from 'vitest';
import { buildTurnLogSnapshot } from '../src/observability/turn-log-snapshot.js';
import { extractFactsSync } from '../src/engine/facts.js';
import { commitTo, initState } from '../src/engine/state.js';

describe('buildTurnLogSnapshot', () => {
  it('includes switch_intent when focused buyer names another project', () => {
    const shortlist = [
      { projectId: 'ayana', name: 'Ayana' },
      { projectId: 'krishnaja', name: 'Krishnaja Greens' },
    ];
    let state = commitTo(initState('log-test', 'lokations'), 'ayana', 'Ayana');
    state = {
      ...state,
      turnCount: 6,
      discover: { ...state.discover, lastOffered: shortlist },
    };
    const text = 'I also want to know about Krishnaja greens';
    const ex = {
      ...extractFactsSync(text, state),
      namedProjects: [{ projectId: 'krishnaja', name: 'Krishnaja Greens' }],
    };
    const goal = { kind: 'answer' as const, topic: 'overview' as const, projectId: 'ayana' };
    const snap = buildTurnLogSnapshot({
      turnInput: { channel: 'whatsapp' },
      state,
      ex,
      goal,
      debug: { phase: 'focused', goal, tools: [], grounding: 'pass', input_source: 'free_text' },
      reply: 'Ayana overview…',
      evidence: { tools: [] },
      buyerText: text,
    });

    expect(snap.phase).toBe('focused');
    expect(snap.extracted.named_projects).toEqual(['krishnaja:Krishnaja Greens']);
    expect(snap.switch_intent).toMatchObject({
      commit: { projectId: 'krishnaja', name: 'Krishnaja Greens' },
    });
  });
});
