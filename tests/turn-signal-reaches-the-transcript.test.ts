import { describe, it, expect } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeCrm, fakeDeps } from './fakes.js';
import type { EngineDeps } from '../src/engine/ports.js';

/**
 * The bot classified every turn and told nobody.
 *
 * Desk's `messages` table has carried `classifier_intent`, `classifier_topic`
 * and `tools_invoked_json` since the store was built, and three readers wait on
 * them: `privacy.dpdpPosture` counts opt-outs by `classifier_intent` on inbound
 * rows, the handoff brief reconstructs the bot's tool history from
 * `tools_invoked_json`, and thread context serves both to the SPA.
 *
 * On Desk dev, 16 Sep 2026: 8,541 message rows, 0 carrying any of them.
 *
 * The signal was never missing. `goal.kind`, `goal.topic`, `ex.speechAct` and
 * `evidence.tools` are all decided on the main path and all written to the turn
 * ledger on the very same turn. They were dropped at the seam: the adapter's
 * `appendMessage` ended in a literal `void meta;`, so not even `replyKey` — the
 * one field the port had always declared — left Spine. Desk's half of this fix
 * taught the transcript door to accept the fields; this half sends them.
 *
 * These assertions read the port, not the store. The port is the boundary this
 * change moved, and what crosses it is exactly what Desk now writes.
 */

function spy() {
  const crm = fakeCrm();
  const deps: EngineDeps = { ...fakeDeps(), crm };
  return {
    crm,
    turn: (threadId: string, text: string) =>
      runEngineTurn(
        { threadId, builderId: 'lokations', text, buyerPhone: '+919999991180', channel: 'whatsapp' },
        deps,
      ),
  };
}

const inbound = (crm: ReturnType<typeof fakeCrm>) =>
  crm.transcript.filter((r) => r.direction === 'inbound');
/**
 * The row carrying THIS turn's reply — not simply the last row written.
 * `runEngineTurn` appends the consent notice after the core returns, so the
 * final outbound row of a first turn is the notice, not the answer.
 */
const replyRow = (crm: ReturnType<typeof fakeCrm>, reply: string) =>
  crm.transcript.filter((r) => r.direction === 'outbound' && r.content === reply).at(-1);

describe('a turn tells the transcript what it decided, not only what it said', () => {
  it('the outbound row carries the goal the bot acted on', async () => {
    const { crm, turn } = spy();
    const r = await turn('sig-outbound', '3 BHK in Whitefield under 1.5 Cr');

    const last = replyRow(crm, r.reply);
    expect(last).toBeDefined();
    // `void meta` meant this was `undefined` for every row ever written.
    expect(last!.meta).toBeDefined();
    expect(last!.meta!.intent).toBeTruthy();
    // replyKey was declared on the port from the start and still never sent.
    expect(last!.meta!.replyKey).toBe(last!.meta!.intent);
  });

  it('the outbound row carries the tools the turn actually ran', async () => {
    const { crm, turn } = spy();
    const r = await turn('sig-tools', '3 BHK in Whitefield under 1.5 Cr');

    const runs = replyRow(crm, r.reply)!.meta!.toolsInvoked as Array<{
      name: string;
      produced_evidence: boolean;
      latency_ms: number;
    }>;
    expect(Array.isArray(runs)).toBe(true);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.map((r) => r.name)).toContain('search');
    // Same records the turn ledger writes, from the same mapper — a search that
    // found nothing must not read as a search that was never run.
    for (const r of runs) {
      expect(typeof r.name).toBe('string');
      expect(typeof r.produced_evidence).toBe('boolean');
      expect(typeof r.latency_ms).toBe('number');
    }
  });

  it('an answered question carries its topic', async () => {
    const { crm, turn } = spy();
    await turn('sig-topic', 'tell me about Brigade Orchards');
    const r = await turn('sig-topic', 'what is the price');

    expect(r.reply).toBeTruthy();
    expect(replyRow(crm, r.reply)!.meta!.topic).toBe('price');
  });

  it('"stop" reaches Desk spelled the way the DPDP posture counts it', async () => {
    // dpdpPosture counts `direction = 'inbound' AND lower(classifier_intent) IN
    // ('opt_out','request_data_erasure')`. Spine's own word is `stop`; sending
    // it raw would leave that branch matching nothing, exactly as it has
    // always matched nothing. The other value it counts is deliberately not
    // produced here: an erasure writes no message rows at all, so a Spine turn
    // can never honestly be its source.
    const { crm, turn } = spy();
    await turn('sig-stop', 'tell me about Brigade Orchards');
    const r = await turn('sig-stop', 'stop');

    // `stop` never reaches the main path at all — it exits early at
    // `stop_contact_only`, one of sixteen branches that append to the
    // transcript. Before the one door, that branch sent no meta whatsoever.
    const last = inbound(crm).at(-1)!;
    expect(last.content).toBe('stop');
    expect(last.meta!.intent).toBe('opt_out');
    expect(last.meta!.intent).not.toBe('stop');
    // The outbound half of that same early branch names itself too.
    expect(replyRow(crm, r.reply)!.meta!.intent).toBe('stop_contact_only');
  });

  it('a buyer who asks in her own words is counted the same as one who types STOP', async () => {
    // The literal list Desk counts on is four exact strings, matched against
    // the WHOLE message. None of these is one of them, and every one of them
    // is the same request.
    for (const words of [
      'please delete all my data',
      'take me off your list',
      'i do not want any more messages',
      'stop sending me messages',
    ]) {
      const { crm, turn } = spy();
      await turn(`own-words-${words.slice(0, 8)}`, 'tell me about Brigade Orchards');
      await turn(`own-words-${words.slice(0, 8)}`, words);
      expect(inbound(crm).at(-1)!.meta!.intent, words).toBe('opt_out');
    }
  });

  it('every early branch names itself, not only the main path', async () => {
    // Sixteen branches append to the transcript. The one that fires here is
    // not the main path, and it used to send `{ replyKey }` that the adapter
    // then dropped with a literal `void meta;`.
    const { crm, turn } = spy();
    const r = await turn('sig-early', 'hi');
    expect(replyRow(crm, r.reply)!.meta!.intent).toBeTruthy();
  });

  it('an ordinary inbound turn is classified, and is not an opt-out', async () => {
    const { crm, turn } = spy();
    await turn('sig-inbound', 'tell me about Brigade Orchards');

    const last = inbound(crm).at(-1)!;
    expect(last.meta!.intent).toBeTruthy();
    expect(last.meta!.intent).not.toBe('opt_out');
  });

  it('a turn that classified nothing claims nothing', async () => {
    // NULL and "" are different facts and a COUNT can tell them apart. The
    // engine must omit the field rather than send a blank, so a row that says
    // nothing is honest instead of wrong.
    const { crm, turn } = spy();
    await turn('sig-empty', 'hi');

    for (const row of crm.transcript) {
      expect(row.meta).toBeDefined();
      expect(row.meta!.intent).not.toBe('');
      expect(row.meta!.topic).not.toBe('');
      if ('topic' in row.meta!) expect(row.meta!.topic).toBeTruthy();
    }
  });
});
