import { describe, it, expect } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { extractFacts } from '../src/engine/facts.js';
import { fakeDeps } from './fakes.js';
import type { ConversationState } from '../src/engine/types.js';

const LLM = fakeDeps().llm;
const stopOf = async (text: string) => (await extractFacts(text, S, LLM)).stop;

/**
 * Opt-out floor + confirm (4q-fix2 scorecard root cause #2): "stop asking
 * questions" must never delete buyer memory; a real opt-out embedded in a
 * sentence confirms first; the standalone SMS keyword still acts immediately.
 */

const S = {
  phase: 'discover',
  discover: { lastOffered: [], discussedProjects: [] },
  constraints: {},
} as unknown as ConversationState;

describe('STOP_RE floor', () => {
  it('bot-behavior complaints and transit words never read as opt-out', async () => {
    expect(await stopOf('stop asking questions. rent probably. maybe live later. whatever')).toBeFalsy();
    expect(await stopOf('2bhk near the bus stop in yelahanka')).toBeFalsy();
    expect(await stopOf('stop showing me plots')).toBeFalsy();
  });

  it('contact/data opt-outs still fire', async () => {
    expect(await stopOf('STOP')).toBe(true);
    expect(await stopOf('please stop messaging me')).toBe(true);
    expect(await stopOf('delete my data')).toBe(true);
    expect(await stopOf("don't contact me again")).toBe(true);
    expect(await stopOf('unsubscribe')).toBe(true);
  });
});

function harness(convId: string) {
  const deps = fakeDeps();
  const turn = (text: string) =>
    runEngineTurn(
      { convId, builderId: 'lokations', text, buyerPhone: '+919999999993', channel: 'advisor_web' },
      deps,
    );
  return { deps, turn };
}

describe('opt-out confirm flow', () => {
  it('standalone STOP deletes immediately', async () => {
    const { deps, turn } = harness('stop-standalone');
    await turn('coorg, 50 Lakhs');
    const r = await turn('STOP');
    expect(r.reply).toMatch(/removed your details/i);
    expect(r.state.phase).toBe('handoff');
    expect(deps.crm.calls).toContain('delete-memory');
  });

  it('sentence opt-out confirms first; "yes" then deletes', async () => {
    const { deps, turn } = harness('stop-confirm-yes');
    await turn('coorg, 50 Lakhs');
    const ask = await turn('please stop messaging me on whatsapp');
    expect(ask.reply).toMatch(/reply "yes"/i);
    expect(ask.state.stopConfirmPending).toBe(true);
    expect(deps.crm.calls).not.toContain('delete-memory');

    const done = await turn('yes');
    expect(done.reply).toMatch(/removed your details/i);
    expect(done.state.phase).toBe('handoff');
    expect(deps.crm.calls).toContain('delete-memory');
  });

  it('non-affirm after the confirm question clears the flag and continues', async () => {
    const { deps, turn } = harness('stop-confirm-no');
    await turn('coorg, 50 Lakhs');
    await turn('please stop messaging me');
    const r = await turn('tell me about Ayana');
    expect(r.state.stopConfirmPending).toBeUndefined();
    expect(r.state.phase).not.toBe('handoff');
    expect(r.reply).toMatch(/Ayana/i);
    expect(deps.crm.calls).not.toContain('delete-memory');
  });

  it('"stop asking questions" flows through the normal pipeline', async () => {
    const { deps, turn } = harness('stop-not-optout');
    await turn('coorg, 50 Lakhs');
    const r = await turn('stop asking questions. rent probably. maybe live later. whatever');
    expect(r.state.phase).not.toBe('handoff');
    expect(r.reply).not.toMatch(/removed your details|remove your details/i);
    expect(deps.crm.calls).not.toContain('delete-memory');
  });

  it('an affirm-flavored question is NOT consent — "ok what would YOU pick" never deletes', async () => {
    const { deps, turn } = harness('stop-loose-affirm');
    await turn('coorg, 50 Lakhs');
    await turn('please stop messaging me');
    const r = await turn('ok what would YOU pick. one answer');
    expect(r.state.phase).not.toBe('handoff');
    expect(r.reply).not.toMatch(/removed your details/i);
    expect(deps.crm.calls).not.toContain('delete-memory');
  });
});
