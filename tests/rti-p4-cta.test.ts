/**
 * P4-CTA / RTI-G02 — focused availability CTA → bare "yes" stays on focus pricing.
 */
import { describe, expect, it } from 'vitest';
import { shouldQueryProjectVectors } from '../src/engine/adapters/semantic-nlu.js';
import { detectFocusedSwitchIntent } from '../src/engine/project_switch.js';
import { commitTo, initState } from '../src/engine/state.js';
import {
  applyTurnIntentResult,
  buildTurnIntentInput,
  classifyTurnIntent,
} from '../src/engine/turn-intent/classify.js';
import { buildPendingPrompt, buildRtiStateUpdate } from '../src/engine/turn-intent/pending-prompt.js';
import type { Env } from '../src/env.js';
import type { Extracted } from '../src/engine/types.js';

const noopEnv = {} as Env;

describe('P4-CTA — offer_pricing pending', () => {
  it('builds offer_pricing after answer/availability with units', () => {
    const pending = buildPendingPrompt(
      { kind: 'answer', topic: 'availability', projectId: 'brigade-eldorado' },
      {
        tools: ['listUnits'],
        units: [{ unitType: '2 BHK', priceDisplay: '₹57.5L–₹1.05Cr', sizeDisplay: '740-1043 sqft' }],
      },
      undefined,
      4,
      { projectId: 'brigade-eldorado', projectName: 'Brigade Eldorado' },
    );
    expect(pending).toMatchObject({
      kind: 'offer_pricing',
      project_id: 'brigade-eldorado',
      topic: 'price',
    });
  });

  it('keeps offer_pricing on successful answer turn (not cleared as successTurn)', () => {
    const rti = buildRtiStateUpdate({
      goal: { kind: 'answer', topic: 'availability', projectId: 'brigade-eldorado' },
      evidence: {
        tools: ['listUnits'],
        units: [{ unitType: '2 BHK', priceDisplay: '₹57.5L', sizeDisplay: '740-1043 sqft' }],
      },
      reply: 'Available configurations: 2 BHK — 740-1043 sqft. Want pricing on a specific size?',
      uiMode: 'focused',
      turnCount: 4,
      focus: { projectId: 'brigade-eldorado', projectName: 'Brigade Eldorado' },
    });
    expect(rti.pendingPrompt?.kind).toBe('offer_pricing');
  });

  it('yes after offer_pricing → focused_question + seedAskTopic price', async () => {
    let state = commitTo(initState('c1', 'brigade-group'), 'brigade-eldorado', 'Brigade Eldorado');
    state = {
      ...state,
      rti: {
        pendingPrompt: {
          kind: 'offer_pricing',
          project_id: 'brigade-eldorado',
          project_name: 'Brigade Eldorado',
          topic: 'price',
          asked_at_turn: 3,
        },
        lastUiMode: 'focused',
        lastGoalKind: 'answer',
      },
    };
    const input = buildTurnIntentInput(state, 'yes', 'whatsapp', 'focused');
    const intent = await classifyTurnIntent(noopEnv, input);
    expect(intent.kind).toBe('focused_question');
    expect(intent.ask_topic).toBe('price');
    const applied = applyTurnIntentResult(state, intent, []);
    expect(applied.seedAskTopic).toBe('price');
    expect(applied.state.phase).toBe('focused');
    expect(applied.state.focus?.projectId).toBe('brigade-eldorado');
    expect(applied.probeReply).toBeUndefined();
    expect(applied.focusCommitted).toBeUndefined();
  });
});

describe('P4-CTA — engine golden RTI-G02 (fake deps)', () => {
  it('2BHK configs → yes → answer/price on Eldorado, not Buena Vista', async () => {
    const { runEngineTurn } = await import('../src/engine/turn.js');
    const { fakeDeps } = await import('./fakes.js');
    const deps = fakeDeps();
    const convId = 'rti-g02-eldorado-yes';
    const turn = (text: string) =>
      runEngineTurn(
        { convId, builderId: 'brigade-group', text, buyerPhone: '+919999000002', channel: 'whatsapp' },
        deps,
      );

    await turn('hi');
    await turn('Apartment in North Bangalore');
    const focus = await turn('tell me about Brigade Eldorado');
    expect(focus.state.phase).toBe('focused');
    expect(focus.state.focus?.projectId).toBe('eldorado');

    const configs = await turn('give me 2BHK configurations');
    expect(configs.debug.goal).toMatchObject({ kind: 'answer', topic: 'availability' });
    expect(configs.state.rti?.pendingPrompt?.kind).toBe('offer_pricing');
    expect(configs.reply.toLowerCase()).toMatch(/pricing|size|sqft|2 bhk/);

    const yes = await turn('yes');
    expect(yes.state.phase).toBe('focused');
    expect(yes.state.focus?.projectId).toBe('eldorado');
    expect(yes.debug.goal).toMatchObject({ kind: 'answer', topic: 'price' });
    expect(yes.reply.toLowerCase()).toContain('eldorado');
    expect(yes.reply.toLowerCase()).not.toMatch(/buena vista|budigere/);
  });
});

describe('P4-CTA — vector + switch gates', () => {
  it('shouldQueryProjectVectors false for bare yes affirm', () => {
    expect(
      shouldQueryProjectVectors(
        'yes',
        { constraints: {}, transition: 'none', affirm: true },
        { phase: 'focused', offeredProjectNames: ['Brigade Eldorado'] },
      ),
    ).toBe(false);
  });

  it('detectFocusedSwitchIntent null on bare yes even with hallucinated namedProjects', () => {
    const s = commitTo(initState('c1', 'brigade-group'), 'brigade-eldorado', 'Brigade Eldorado');
    const ex: Extracted = {
      constraints: {},
      transition: 'none',
      affirm: true,
      namedProjects: [{ projectId: 'brigada-buena-vista', name: 'Brigade Buena Vista' }],
    };
    expect(detectFocusedSwitchIntent('yes', ex, s)).toBeNull();
  });

  it('still switches when buyer names another project', () => {
    const s = commitTo(initState('c1', 'brigade-group'), 'brigade-eldorado', 'Brigade Eldorado');
    const ex: Extracted = {
      constraints: {},
      transition: 'none',
      namedProjects: [{ projectId: 'brigada-buena-vista', name: 'Brigade Buena Vista' }],
    };
    expect(detectFocusedSwitchIntent('tell me about Buena Vista', ex, s)).toMatchObject({
      commit: { projectId: 'brigada-buena-vista' },
    });
  });
});
