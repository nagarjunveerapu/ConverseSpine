import { describe, expect, it } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';

/**
 * L04 — "Yes, no, and what was the question". Fifteen turns of yes / no / ok /
 * sure on one project, and the bot never once knew what they were answering:
 *
 *    3 > yes        < Shall I set up a visit to X, or hold a unit while you decide?
 *    4 > no         < *X*. 1 BHK, 2 BHK, … Want pricing details, unit configurations…?
 *   10 > yes        < Shall I set up a visit to X, or hold a unit while you decide?
 *   15 > yes        < Shall I set up a visit to X, or hold a unit while you decide?
 *
 * Two holes, either of which alone would have saved the turn:
 *  - the intent layer cleared `pendingPrompt` on a decline, and the decline
 *    path in focused.decide reads exactly that slot — so "no" fell through to
 *    the project card;
 *  - the advance nudge is itself a question, but nothing armed a prompt for it,
 *    so the "yes" it asked for had no antecedent and re-ran the same nudge.
 */
function harness(threadId: string) {
  const deps = fakeDeps();
  const turn = (text: string) =>
    runEngineTurn(
      { threadId, builderId: 'lokations', text, buyerPhone: '+919999991170', channel: 'whatsapp' },
      deps,
    );
  return { turn };
}

describe('a bare yes or no lands on the question that was asked', () => {
  it('answers a decline with an ack, not the card it just showed', async () => {
    const { turn } = harness('yesno-decline');
    await turn('tell me about Brigade Eldorado');
    const offered = await turn('yes');
    expect(offered.state.rti?.pendingPrompt?.kind).toBe('offer_pricing');

    const declined = await turn('no');

    expect(declined.debug.goal.kind).toBe('advance');
    expect(declined.debug.goal).toMatchObject({ reason: 'cta_decline' });
    // The card the buyer just declined must not be the answer to declining it.
    expect(declined.reply).not.toBe(offered.reply);
    expect(declined.reply).toMatch(/no problem|something else/i);
  });

  it('takes the first fork when the nudge itself was the question', async () => {
    const { turn } = harness('yesno-nudge');
    await turn('tell me about Brigade Eldorado');
    await turn('yes');
    const nudge = await turn('no'); // → "want a site visit …, loan details, or something else?"
    expect(nudge.debug.goal.kind).toBe('advance');

    const accepted = await turn('ok');

    // A yes to "shall I set up a visit?" starts the visit — it does not re-ask.
    expect(accepted.debug.goal.kind).toBe('propose_visit');
    expect(accepted.reply).not.toBe(nudge.reply);
  });

  it('never sends the same nudge three times over a run of affirmations', async () => {
    const { turn } = harness('yesno-run');
    await turn('tell me about Brigade Eldorado');
    const replies: string[] = [];
    for (const t of ['yes', 'no', 'ok', 'yes please', 'sure', 'yes']) {
      replies.push((await turn(t)).reply.trim().toLowerCase());
    }
    const counts = new Map<string, number>();
    for (const r of replies) counts.set(r, (counts.get(r) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
  });
});
