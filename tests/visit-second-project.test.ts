import { describe, expect, it } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';

/**
 * Shortlist two projects, then book a visit to each — the ordinary thing a
 * buyer does, and the sequence that broke twice on the founder's phone:
 *
 *   [tap] Book a visit   → "Your visits: Brigade Eldorado — Sunday at 2:00 PM."
 *   [tap] Sun 16 Aug     → "Which day and time work for Brigade Cornerstone?"
 *   [tap] Book a visit   → "I could not pin that to a date."
 *
 * Two mistakes, one shape. The recall flag outranks booking, so an existing
 * visit answered a request to make a new one; and a fresh "Book a visit" was
 * counted as a second failed attempt at the day question that was already
 * open — so the button that contains no date was told off for containing no
 * date.
 */
function harness(threadId: string) {
  const deps = fakeDeps();
  const turn = (text: string, action_id?: string) =>
    runEngineTurn(
      {
        threadId,
        builderId: 'lokations',
        text,
        buyerPhone: '+919999999932',
        channel: 'whatsapp',
        ...(action_id ? { action_id } : {}),
      },
      deps,
    );
  return { turn };
}

describe('a second project gets its own visit', () => {
  it('“Book a visit” for the next project asks for a day, it does not read the last one back', async () => {
    const { turn } = harness('visit-two-projects');
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana');
    await turn('book a visit');
    await turn('saturday morning');
    const booked = await turn('yes');
    expect(booked.reply).toMatch(/set for/i);

    // Now the second project, by tap, exactly as the console draws it.
    await turn('tell me about Krishnaja Greens');
    const ask = await turn('Book a visit', 'visit_book');
    expect(ask.reply).toMatch(/which day|what day/i);
    // The whole failure was answering with the visit already on the books.
    expect(ask.reply).not.toMatch(/your visits:/i);
  });

  it('pressing Book a visit again re-asks plainly — it is a request, not a wrong answer', async () => {
    const { turn } = harness('visit-book-twice');
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana');
    const first = await turn('Book a visit', 'visit_book');
    expect(first.reply).toMatch(/which day|what day/i);
    const again = await turn('Book a visit', 'visit_book');
    expect(again.reply).not.toMatch(/could not pin/i);
    expect(again.reply).toMatch(/which day|what day/i);
  });

  it('a day tap after the ask books that day', async () => {
    const { turn } = harness('visit-day-tap');
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana');
    await turn('Book a visit', 'visit_book');
    const day = await turn('Sat 16 Aug', 'wa.day.saturday');
    expect(day.reply).not.toMatch(/could not pin/i);
    expect(day.reply).toMatch(/morning or afternoon|saturday/i);
  });
});
