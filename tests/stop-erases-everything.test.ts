import { describe, expect, it } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';

/**
 * "Understood — I've removed your details from our system."
 *
 * On the founder's own phone, the very next message was answered with:
 * "Same as a moment ago — your visits: Brigade Eldorado — Sunday at 2:00 PM."
 * The opt-out deleted cross-session buyer MEMORY and nothing else, so the
 * visits standing in Desk and the whole live session survived the erasure and
 * were read straight back. A sentence that says everything is gone has to be
 * true of everything the buyer can still be shown.
 */
function harness(convId: string) {
  const deps = fakeDeps();
  const turn = (text: string) =>
    runEngineTurn(
      { convId, builderId: 'lokations', text, buyerPhone: '+919999999931', channel: 'whatsapp' },
      deps,
    );
  return { turn, deps };
}

async function bookAVisit(turn: (t: string) => Promise<{ reply: string }>) {
  await turn('coorg, 50 Lakhs');
  await turn('tell me about Ayana');
  await turn('book a visit');
  await turn('saturday morning');
  await turn('yes');
}

describe('STOP erases what it says it erases', () => {
  it('a booked visit does not survive the opt-out that claimed to remove it', async () => {
    const { turn } = harness('stop-erase-1');
    await bookAVisit(turn);
    const before = await turn('what are my visits?');
    expect(before.reply).toMatch(/Ayana/i);

    const stop = await turn('STOP');
    expect(stop.reply).toContain("removed your details");

    const after = await turn('what are my visits?');
    expect(after.reply).not.toMatch(/Ayana/i);
    expect(after.reply).not.toMatch(/\bSaturday\b/i);
  });

  it('the session goes with it — the focus and the brief do not outlive the erase', async () => {
    const { turn } = harness('stop-erase-2');
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana');
    const stop = await turn('STOP');
    expect(stop.state.focus).toBeUndefined();
    expect(stop.state.optedOut).toBe(true);
  });

  it('/reset clears the visits it starts fresh from', async () => {
    const { turn } = harness('reset-clears');
    await bookAVisit(turn);
    await turn('/reset');
    const after = await turn('what are my visits?');
    expect(after.reply).not.toMatch(/Ayana/i);
  });

  it('“start over” restarts the conversation without cancelling real bookings', async () => {
    // A buyer restarting the chat has not asked to lose the visit they made —
    // only the explicit slash command wipes records.
    const { turn } = harness('start-over-keeps');
    await bookAVisit(turn);
    await turn('start over');
    const after = await turn('what are my visits?');
    expect(after.reply).toMatch(/Ayana/i);
  });
});
