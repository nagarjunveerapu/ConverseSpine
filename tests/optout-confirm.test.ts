import { describe, it, expect } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { extractFacts } from '../src/engine/facts.js';
import { fakeDeps } from './fakes.js';
import type { ThreadState } from '../src/engine/types.js';

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
} as unknown as ThreadState;

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

function harness(threadId: string) {
  const deps = fakeDeps();
  const turn = (text: string) =>
    runEngineTurn(
      { threadId, builderId: 'lokations', text, buyerPhone: '+919999999993', channel: 'advisor_web' },
      deps,
    );
  return { deps, turn };
}

function phase1Harness(threadId: string) {
  const h = harness(threadId);
  h.deps.failureTools = true;
  return h;
}

describe('opt-out confirm flow', () => {
  it('standalone DELETE deletes immediately', async () => {
    // No confirmation, deliberately: the first greeting told this buyer that
    // DELETE removes everything, and a keyword you advertise has to work when
    // it is typed. The confirm ladder below is for phrasings we are GUESSING
    // at — there we may be wrong, here we cannot be.
    const { deps, turn } = harness('delete-standalone');
    await turn('coorg, 50 Lakhs');
    const r = await turn('DELETE');
    expect(r.reply).toMatch(/deleted/i);
    expect(r.state.phase).toBe('handoff');
    expect(deps.crm.calls).toContain('erase:all');
  });

  it('standalone STOP stops the messages and keeps the record', async () => {
    // The two words used to be one word doing the wrong thing: STOP ran the
    // full erasure, and DELETE matched nothing at all and fell through to
    // project search. A buyer who is done being contacted has not asked us to
    // forget the visit they booked.
    const { deps, turn } = harness('stop-standalone');
    await turn('coorg, 50 Lakhs');
    const r = await turn('STOP');
    expect(deps.crm.calls).toContain('erase:contact_only');
    expect(deps.crm.calls).not.toContain('erase:all');
    expect(r.reply).toMatch(/haven't deleted your details/i);
  });

  it('sentence opt-out confirms first; "yes" then deletes', async () => {
    const { deps, turn } = harness('stop-confirm-yes');
    await turn('coorg, 50 Lakhs');
    const ask = await turn('please stop messaging me on whatsapp');
    expect(ask.reply).toMatch(/reply "yes"/i);
    expect(ask.state.stopConfirmPending).toBe(true);
    expect(deps.crm.calls).not.toContain('erase:all');

    const done = await turn('yes');
    expect(done.reply).toMatch(/deleted/i);
    expect(done.state.phase).toBe('handoff');
    expect(deps.crm.calls).toContain('erase:all');
  });

  it('non-affirm after the confirm question clears the flag and continues', async () => {
    const { deps, turn } = harness('stop-confirm-no');
    await turn('coorg, 50 Lakhs');
    await turn('please stop messaging me');
    const r = await turn('tell me about Ayana');
    expect(r.state.stopConfirmPending).toBeUndefined();
    expect(r.state.phase).not.toBe('handoff');
    expect(r.reply).toMatch(/Ayana/i);
    expect(deps.crm.calls).not.toContain('erase:all');
  });

  it('"stop asking questions" flows through the normal pipeline', async () => {
    const { deps, turn } = harness('stop-not-optout');
    await turn('coorg, 50 Lakhs');
    const r = await turn('stop asking questions. rent probably. maybe live later. whatever');
    expect(r.state.phase).not.toBe('handoff');
    expect(r.reply).not.toMatch(/\bdeleted\b|remove your details/i);
    expect(deps.crm.calls).not.toContain('erase:all');
  });

  it('an affirm-flavored question is NOT consent — "ok what would YOU pick" never deletes', async () => {
    const { deps, turn } = harness('stop-loose-affirm');
    await turn('coorg, 50 Lakhs');
    await turn('please stop messaging me');
    const r = await turn('ok what would YOU pick. one answer');
    expect(r.state.phase).not.toBe('handoff');
    expect(r.reply).not.toMatch(/\bdeleted\b/i);
    expect(deps.crm.calls).not.toContain('erase:all');
  });
});

describe('Phase 1 destructive-intent gate', () => {
  it('names both readings for contact-only opt-out and never deletes on "yes"', async () => {
    const { deps, turn } = phase1Harness('stop-scope-yes');
    let actionPlan: Record<string, unknown> | undefined;
    deps.crm.appendTurnLedger = async (entry) => {
      actionPlan = entry.actionPlan;
    };
    await turn('coorg, 50 Lakhs');
    const ask = await turn('stop contacting me');
    expect(ask.reply).toMatch(/stop calling and keep chatting here/i);
    expect(ask.reply).toMatch(/stop all contact and delete your details/i);
    expect(ask.state.stopConfirmMode).toBe('contact_scope');
    expect(deps.crm.calls).not.toContain('erase:all');
    expect(actionPlan).toMatchObject({
      failures: [
        {
          kind: 'ambiguous',
          stage: 'destructive_gate',
          subject: 'opt_out',
        },
      ],
    });

    const stillAmbiguous = await turn('yes');
    expect(stillAmbiguous.reply).toMatch(/stop calling and keep chatting here/i);
    expect(stillAmbiguous.state.stopConfirmPending).toBe(true);
    expect(deps.crm.calls).not.toContain('erase:all');
  });

  it('reads "no calls, message me here" as a channel choice, not an opt-out', async () => {
    // The buyer named a channel to KEEP. Asking them to disambiguate against
    // "delete your details" answers a request to carry on with an offer to
    // erase them — the gate exists to protect a destructive act, and there is
    // no destructive act in this sentence.
    const { deps, turn } = phase1Harness('stop-scope-channel');
    await turn('coorg, 50 Lakhs');
    const kept = await turn("don't call me, only chat here");
    expect(kept.reply).toMatch(/no calls/i);
    expect(kept.reply).toMatch(/nothing gets deleted/i);
    expect(kept.reply).not.toMatch(/delete your details/i);
    expect(kept.state.stopConfirmPending).not.toBe(true);
    expect(deps.crm.calls).not.toContain('erase:all');
  });

  it('keeps the search when the buyer chooses chat-only', async () => {
    const { deps, turn } = phase1Harness('stop-scope-keep');
    await turn('coorg, 50 Lakhs');
    await turn('please stop messaging me on whatsapp');
    const kept = await turn('keep the chat');
    expect(kept.reply).toMatch(/keep your property search/i);
    expect(kept.reply).toMatch(/haven't deleted/i);
    expect(kept.state.phase).not.toBe('handoff');
    expect(deps.crm.calls).not.toContain('erase:all');
  });

  it('deletes only after the buyer explicitly chooses stop-all', async () => {
    const { deps, turn } = phase1Harness('stop-scope-delete');
    await turn('coorg, 50 Lakhs');
    await turn('please stop messaging me');
    const deleted = await turn('stop all');
    expect(deleted.reply).toMatch(/deleted/i);
    expect(deleted.state.phase).toBe('handoff');
    expect(deps.crm.calls).toContain('erase:all');
  });

  it('keeps direct delete-my-data on an aligned confirmation path', async () => {
    const { deps, turn } = phase1Harness('stop-explicit-delete');
    await turn('coorg, 50 Lakhs');
    const ask = await turn('delete my data');
    expect(ask.state.stopConfirmMode).toBe('delete_confirm');
    expect(ask.reply).toMatch(/reply "yes"/i);
    const deleted = await turn('yes');
    expect(deleted.state.phase).toBe('handoff');
    expect(deps.crm.calls).toContain('erase:all');
  });
});
