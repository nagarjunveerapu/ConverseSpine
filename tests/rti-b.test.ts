import { describe, expect, it } from 'vitest';
import { extractLocation } from '../src/engine/facts.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { initState, commitTo } from '../src/engine/state.js';
import {
  applyTurnIntentResult,
  buildTurnIntentInput,
  classifyTurnIntent,
} from '../src/engine/turn-intent/classify.js';
import {
  classifyFocusedPivot,
  isFocusedSearchPivot,
  shouldRunFocusedTurnIntent,
} from '../src/engine/turn-intent/focused-intent.js';
import { fakeDeps } from './fakes.js';
import type { Env } from '../src/env.js';

const noopEnv = {} as Env;

describe('RTI-B focused pivot detection', () => {
  it('detects Bangalore projects and looking in Bangalore', () => {
    expect(extractLocation('Bangalore projects')).toBe('Bangalore');
    expect(extractLocation('I am looking in Bangalore')).toBe('Bangalore');
    expect(isFocusedSearchPivot('Bangalore projects')).toBe(true);
    expect(isFocusedSearchPivot('I am looking in Bangalore')).toBe(true);
  });

  it('does not pivot on pricing-only turns', () => {
    expect(isFocusedSearchPivot('pricing')).toBe(false);
    expect(isFocusedSearchPivot('What is the RERA status?')).toBe(false);
  });

  it('classifies location pivot as broaden_constraints', () => {
    let state = initState('c1', 'naya-advisor');
    state = commitTo(state, 'clarks', 'Clarks Exotica');
    const input = buildTurnIntentInput(state, 'I am looking in Bangalore', 'advisor_web', 'focused');
    expect(classifyFocusedPivot(input)).toMatchObject({
      kind: 'broaden_constraints',
      patch: { location: 'Bangalore' },
    });
  });

  it('shouldRunFocusedTurnIntent only in focused phase', () => {
    let state = initState('c1', 'naya-advisor');
    expect(shouldRunFocusedTurnIntent(state, 'Bangalore projects')).toBe(false);
    state = commitTo(state, 'clarks', 'Clarks Exotica');
    expect(shouldRunFocusedTurnIntent(state, 'Bangalore projects')).toBe(true);
  });

  it('applyTurnIntentResult releases focus on broaden_constraints', () => {
    let state = initState('c1', 'naya-advisor');
    state = commitTo(state, 'clarks', 'Clarks Exotica');
    const input = buildTurnIntentInput(state, 'Bangalore projects', 'advisor_web', 'focused');
    const intent = classifyFocusedPivot(input)!;
    const applied = applyTurnIntentResult(state, intent, []);
    expect(applied.releasedFocus).toBe(true);
    expect(applied.state.phase).toBe('discover');
    expect(applied.state.focus).toBeUndefined();
    expect(applied.state.constraints.location).toBe('Bangalore');
  });
});

describe('RTI-B end-to-end', () => {
  it('focused + Bangalore pivot re-searches instead of Clarks overview', async () => {
    const deps = fakeDeps();
    let state = initState('rti-b', 'lokations');
    state = {
      ...commitTo(state, 'ayana', 'Ayana'),
      discover: {
        ...state.discover,
        oriented: true,
        lastOffered: [
          { projectId: 'ayana', name: 'Ayana' },
          { projectId: 'krishnaja', name: 'Krishnaja Greens' },
        ],
      },
      constraints: { bhk: '4+ BHK', budgetMaxInr: 10_000_000, location: 'Sakleshpur' },
    };
    await deps.store.save(state);

    const out = await runEngineTurn(
      {
        convId: 'rti-b',
        builderId: 'lokations',
        text: 'I am looking in Bangalore',
        buyerPhone: '+919977665544',
        channel: 'advisor_web',
      },
      deps,
    );

    expect(out.state.phase).toBe('discover');
    expect(out.state.focus).toBeUndefined();
    expect(out.state.constraints.location?.toLowerCase()).toContain('bangalore');
    expect(out.debug.goal.kind).not.toBe('answer');
    expect(['recommend', 'no_fit', 'advance']).toContain(out.debug.goal.kind);
  });

  it('classifyTurnIntent runs release_focus for show me other projects', async () => {
    let state = initState('c2', 'lokations');
    state = commitTo(state, 'ayana', 'Ayana');
    const input = buildTurnIntentInput(state, 'show me other projects', 'advisor_web', 'focused');
    const intent = await classifyTurnIntent(noopEnv, input);
    expect(intent.kind).toBe('release_focus');
  });
});
