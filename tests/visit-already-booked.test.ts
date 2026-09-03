import { describe, expect, it } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';

/**
 * L01 on the live line, one turn after the booking landed:
 *   14 > yes            → "Done — your visit to Brigade Eldorado is set for Saturday at 10:30 AM."
 *   15 > and can my brother come too
 *      < "Which day and time work for your visit to Brigade Eldorado?"
 * Booking deletes `visit` from state, so the next visit-shaped turn started
 * from nothing. A bot that asks for a day it already has is telling the buyer
 * the booking did not happen.
 */
function harness(threadId: string) {
  const deps = fakeDeps();
  const turn = (text: string) =>
    runEngineTurn(
      { threadId, builderId: 'lokations', text, buyerPhone: '+919999999994', channel: 'whatsapp' },
      deps,
    );
  return { turn };
}

async function bookAVisit(turn: (t: string) => Promise<{ reply: string }>) {
  await turn('coorg, 50 Lakhs');
  await turn('tell me about Ayana');
  await turn('book a visit');
  await turn('saturday morning');
  const booked = await turn('yes');
  return booked;
}

describe('a booked visit is remembered', () => {
  it('reads the booking back instead of re-asking the day', async () => {
    const { turn } = harness('visit-booked-recall');
    const booked = await bookAVisit(turn);
    expect(booked.reply.toLowerCase()).toContain('visit');

    // Anything that re-enters the visit machine — on the live line it was
    // "and can my brother come too" — must meet the booking, not a blank form.
    const after = await turn('book a visit');

    expect(after.reply).not.toMatch(/which day|what day|day and time/i);
  });

  it('still lets a real change through on the turn after', async () => {
    const { turn } = harness('visit-booked-change');
    await bookAVisit(turn);
    await turn('and can my brother come too'); // spends the one-shot readback

    const change = await turn('can we move it');

    // The second visit-shaped turn is a genuine change — the machine may ask
    // again. What it must never do is ask BEFORE reading the booking back.
    expect(change.reply.trim().length).toBeGreaterThan(0);
  });
});
