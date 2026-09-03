import { describe, expect, it } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { CONSENT_NOTICE } from '../src/engine/consent-line.js';
import { fakeDeps } from './fakes.js';

/**
 * Two words, told to the buyer once, doing two different things.
 *
 * Erasure has worked for a while and nobody could reach it. The words that
 * triggered it were `delete my data`, `forget me`, `remove my details` — a
 * vocabulary a buyer would have had to guess phrase by phrase, with no way of
 * knowing they had guessed right. Meanwhile the one word people actually type
 * on WhatsApp, STOP, ran a full irreversible erasure with no confirmation, and
 * DELETE matched nothing at all: a buyer who typed the most serious word they
 * had got a shortlist of 3BHKs back.
 *
 * So the bot says it once, unprompted, and the two words split:
 *
 *   STOP    — stop the messages, keep the record
 *   DELETE  — remove everything
 */
function harness(threadId: string, channel: 'whatsapp' | 'advisor_web' = 'whatsapp') {
  const deps = fakeDeps();
  const turn = (text: string) =>
    runEngineTurn(
      { threadId, builderId: 'lokations', text, buyerPhone: '+919999999941', channel },
      deps,
    );
  return { deps, turn };
}

describe('the buyer is told how to leave', () => {
  it('names both words on the first reply, and never again', async () => {
    const { turn } = harness('consent-once');
    const first = await turn('hi');
    expect(first.consentNotice, 'the first reply owes the notice').toBe(CONSENT_NOTICE);
    expect(first.consentNotice).toMatch(/\bSTOP\b/);
    expect(first.consentNotice).toMatch(/\bDELETE\b/);

    // A notice repeated every turn is furniture, and buyers stop reading
    // furniture on the second sighting.
    const second = await turn('coorg, 50 Lakhs');
    expect(second.consentNotice).toBeUndefined();
    const third = await turn('tell me about Ayana');
    expect(third.consentNotice).toBeUndefined();
  });

  it('is its own message, not glued onto the answer', async () => {
    // The first reply is often an interactive list, whose body WhatsApp caps
    // at 1024 characters. A notice about a legal right is the wrong thing to
    // lose to a slice, so it travels separately all the way to the sender.
    const { turn } = harness('consent-separate');
    const first = await turn('hi');
    expect(first.reply).not.toContain('DELETE');
    expect(first.reply).not.toContain(CONSENT_NOTICE);
  });

  it('writes it down as well as sending it', async () => {
    // "We told them" is the consent evidence. Evidence that lives only in a
    // message we hope was delivered is not evidence.
    const { deps, turn } = harness('consent-recorded');
    await turn('hi');
    const written = deps.crm.calls.filter((c) => c.startsWith('msg:'));
    expect(written.length).toBeGreaterThan(0);
  });

  it('stays off the advisor app, which has a button instead', async () => {
    // Telling someone to "reply STOP" at a web screen describes a door that
    // isn't there.
    const { turn } = harness('consent-web', 'advisor_web');
    const first = await turn('hi');
    expect(first.consentNotice).toBeUndefined();
  });
});

describe('STOP and DELETE are not the same word', () => {
  it('STOP stops the messages and keeps everything else', async () => {
    const { deps, turn } = harness('stop-keeps');
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana');
    const stop = await turn('STOP');

    expect(deps.crm.calls, 'STOP must not run the full erasure').not.toContain('erase:all');
    expect(deps.crm.calls).toContain('erase:contact_only');
    expect(stop.reply, 'STOP must say plainly that it did NOT delete')
      .toMatch(/haven't deleted your details/i);
    // And it points at the other word by the name the buyer was given.
    expect(stop.reply).toMatch(/Reply DELETE/);
    // Retained record, retained thread. Silence is Desk's tombstone, which
    // every sender checks; amnesia was never what "stop messaging me" asked
    // for, and a buyer who writes back should not have to start over.
    expect(stop.state.ndThreadId, 'the Desk pointer went with the messages')
      .toBeDefined();
  });

  it('DELETE removes everything, with no confirmation step', async () => {
    const { deps, turn } = harness('delete-now');
    await turn('coorg, 50 Lakhs');
    await turn('tell me about Ayana');
    const del = await turn('DELETE');

    expect(deps.crm.calls).toContain('erase:all');
    expect(del.reply).toMatch(/deleted/i);
    expect(del.state.focus, 'the session outlived the delete').toBeUndefined();
    expect(del.state.ndThreadId).toBeUndefined();
    expect(del.state.ndBuyerPhone).toBeUndefined();
  });

  it('a buyer just erased is not then handed a leaflet', async () => {
    // The notice writes the state back. On the turn that purged the store
    // copy, that would resurrect the conversation we had just removed — which
    // is the whole reason the erasure path reports itself.
    const { turn } = harness('delete-no-notice');
    const del = await turn('DELETE');
    expect(del.erased).toBe(true);
    expect(del.consentNotice, 'a leaflet handed to someone we just forgot').toBeUndefined();
  });

  it('“delete the 2bhk from my shortlist” is a sentence about a list', async () => {
    // Standalone only. A word this destructive gets no fuzzy matching.
    const { deps, turn } = harness('delete-not-standalone');
    await turn('coorg, 50 Lakhs');
    await turn('delete the 2bhk from my shortlist');
    expect(deps.crm.calls).not.toContain('erase:all');
  });
});
