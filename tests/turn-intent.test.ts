import { describe, expect, it } from 'vitest';
import { preferenceClearsFromPatch } from '../src/advisor/apply-preferences.js';
import {
  applyTurnIntentResult,
  buildTurnIntentInput,
  classifyTurnIntent,
} from '../src/engine/turn-intent/classify.js';
import { defaultProbePrompt } from '../src/engine/turn-intent/pending-prompt.js';
import { initState } from '../src/engine/state.js';
import type { Env } from '../src/env.js';
import type { SuggestedAction } from '../src/engine/recovery-planner.js';

const noopEnv = {} as Env;

const sampleActions: SuggestedAction[] = [
  {
    id: 'clear_bhk',
    label: 'Any configuration',
    patch: { bhk: '' },
    user_line: 'Show projects with any BHK configuration',
    expected_matches: 2,
  },
  {
    id: 'raise_budget',
    label: 'Raise budget',
    patch: { budget: '₹1.5 Cr+' },
    user_line: 'Show projects with budget up to ₹1.5 Cr+',
    expected_matches: 1,
  },
];

describe('preferenceClearsFromPatch', () => {
  it('detects bhk clear', () => {
    expect(preferenceClearsFromPatch({ bhk: '' })).toEqual(['bhk']);
  });
});

describe('ruleClassify via classifyTurnIntent', () => {
  it('maps chip action_id to patch without LLM', async () => {
    let state = initState('c1', 'naya-advisor');
    state = {
      ...state,
      rti: {
        lastSuggestedActions: sampleActions,
        lastUiMode: 'search_recovery',
        pendingPrompt: { kind: 'chip_menu', chip_ids: ['clear_bhk'], asked_at_turn: 1 },
      },
    };
    const input = buildTurnIntentInput(state, 'Any configuration', 'advisor_web', 'search_recovery', 'clear_bhk');
    const intent = await classifyTurnIntent(noopEnv, input);
    expect(intent.kind).toBe('apply_recovery_patch');
    expect(intent.matched_action_id).toBe('clear_bhk');
    const applied = applyTurnIntentResult(state, intent, sampleActions);
    expect(applied.state.constraints.bhk).toBeUndefined();
    expect(applied.clearedKeys.has('bhk')).toBe(true);
  });

  it('yes after offer_project confirms focus', async () => {
    let state = initState('c1', 'naya-advisor');
    state = {
      ...state,
      discover: {
        ...state.discover,
        lastOffered: [{ projectId: 'clarks', name: 'Clarks Exotica' }],
      },
      rti: {
        pendingPrompt: {
          kind: 'offer_project',
          project_id: 'clarks',
          project_name: 'Clarks Exotica',
          asked_at_turn: 2,
        },
        lastUiMode: 'search_recovery',
      },
    };
    const input = buildTurnIntentInput(state, 'yes', 'whatsapp', 'search_recovery');
    const intent = await classifyTurnIntent(noopEnv, input);
    expect(intent.kind).toBe('confirm_suggestion');
    expect(intent.focus_project_id).toBe('clarks');
    const applied = applyTurnIntentResult(state, intent, []);
    expect(applied.state.phase).toBe('focused');
    expect(applied.state.focus?.projectId).toBe('clarks');
  });

  it('yes after chip_menu probes instead of guessing', async () => {
    let state = initState('c1', 'naya-advisor');
    state = {
      ...state,
      rti: {
        pendingPrompt: { kind: 'chip_menu', chip_ids: ['clear_bhk'], asked_at_turn: 2 },
        lastSuggestedActions: sampleActions,
        lastUiMode: 'search_recovery',
      },
    };
    const input = buildTurnIntentInput(state, 'yes', 'whatsapp', 'search_recovery');
    const intent = await classifyTurnIntent(noopEnv, input);
    expect(intent.kind).toBe('probe');
    const applied = applyTurnIntentResult(state, intent, sampleActions);
    expect(applied.probeReply).toBeTruthy();
    expect(applied.probeReply).toContain('Tap a button');
  });

  it('parses free-text budget widen extractor', async () => {
    let state = initState('c1', 'naya-advisor');
    state = {
      ...state,
      constraints: { bhk: '4+ BHK', budgetMaxInr: 10_000_000, propertyType: 'Apartment' },
      rti: { lastUiMode: 'search_recovery' },
    };
    const input = buildTurnIntentInput(state, '2 Cr any apartment', 'advisor_web', 'search_recovery');
    const intent = await classifyTurnIntent(noopEnv, input);
    expect(intent.kind).toBe('apply_recovery_patch');
    expect(intent.patch_clear).toContain('bhk');
    expect(intent.patch?.budgetMaxInr).toBe(20_000_000);
  });

  it('parses increase budget to explicit amount (RTI-2)', async () => {
    let state = initState('c1', 'naya-advisor');
    state = {
      ...state,
      constraints: { budgetMaxInr: 5_000_000, propertyType: 'Villa' },
      rti: { lastUiMode: 'search_recovery' },
    };
    const input = buildTurnIntentInput(state, 'increase budget to 3 Cr', 'advisor_web', 'search_recovery');
    const intent = await classifyTurnIntent(noopEnv, input);
    expect(intent.kind).toBe('apply_recovery_patch');
    expect(intent.patch?.budgetMaxInr).toBe(30_000_000);
  });
});

describe('defaultProbePrompt', () => {
  it('uses WhatsApp copy for chip menu', () => {
    expect(defaultProbePrompt('chip_menu', 'whatsapp')).toMatch(/button/i);
  });
});
