import { describe, it, expect } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';
import { CONSENT_NOTICE } from '../src/engine/consent-line.js';
import { isOptOutAsk, isStandaloneDelete, isStandaloneStop } from '../src/engine/optout-confirm.js';
import type { EngineDeps } from '../src/engine/ports.js';

/**
 * "Reply STOP any time to stop messages, or DELETE to remove everything we
 * hold about you."
 *
 * We tell every buyer this at first contact. Two words, two different
 * promises: STOP stops the messages and deletes nothing; DELETE erases
 * everything and is destructive. Because we advertise them, they have to work
 * exactly as advertised.
 *
 * They worked only when typed utterly bare. The moment a buyer added a
 * courtesy word, or used the very noun the notice had just taught her, the
 * match failed and the message fell through to project search:
 *
 *     "stop please"        -> a shortlist
 *     "DELETE please"      -> a shortlist
 *     "STOP messages"      -> not honoured as STOP
 *     "DELETE everything"  -> not honoured as DELETE
 *
 * The last two are the sharpest: "stop messages" and "remove everything" are
 * the notice's OWN words. A buyer quoting us back got a shortlist.
 *
 * The scope split is deliberately NOT widened. "delete my data" still goes
 * through the confirmation, because erasure is irreversible and the set of
 * sentences that fire it without asking is not something to grow in passing.
 */

const BUILDS: Array<{ name: string; failureTools: boolean }> = [
  // FAILURE_TOOLS is "true" on dev (wrangler.toml:78) and unset on prod
  // (wrangler.toml:488 — "stay unset (= off)"). The paying tenant is on prod,
  // and `fakeDeps()` declares no failure flags at all, so an unqualified suite
  // only ever exercises the prod shape. Both are named here on purpose.
  { name: 'dev', failureTools: true },
  { name: 'prod', failureTools: false },
];

describe('the two words we advertise do what the notice says', () => {
  it('the notice still promises exactly these two words', () => {
    // If this line is reworded, the vocabulary below has to move with it.
    expect(CONSENT_NOTICE).toContain('STOP');
    expect(CONSENT_NOTICE).toContain('DELETE');
    expect(CONSENT_NOTICE).toContain('stop messages');
    expect(CONSENT_NOTICE).toContain('remove everything');
  });

  const STOPS = ['STOP', 'stop', 'Stop.', 'STOP!', ' STOP ', 'stop please', 'please STOP', 'STOP messages'];
  const DELETES = ['DELETE', 'delete', 'Delete.', 'DELETE please', 'please DELETE', 'DELETE everything'];

  for (const word of STOPS) {
    it(`"${word}" stops contact and deletes nothing`, () => {
      expect(isStandaloneStop(word)).toBe(true);
      expect(isStandaloneDelete(word)).toBe(false);
    });
  }

  for (const word of DELETES) {
    it(`"${word}" erases`, () => {
      expect(isStandaloneDelete(word)).toBe(true);
    });
  }

  it('the bot\'s own behaviour is still not an opt-out', () => {
    // The distinction the vocabulary has always had to keep: an opt-out is
    // about CONTACT or DATA, never about how the bot is talking. Widening the
    // words must not widen this.
    for (const notAnOptOut of [
      'stop asking questions',
      'stop asking me so many questions',
      'delete the 2bhk from my shortlist',
      'can you remove the 3 BHK from the compare',
      'stop showing me plots',
    ]) {
      expect(isOptOutAsk(notAnOptOut), notAnOptOut).toBe(false);
      expect(isStandaloneStop(notAnOptOut), notAnOptOut).toBe(false);
      expect(isStandaloneDelete(notAnOptOut), notAnOptOut).toBe(false);
    }
  });

  for (const build of BUILDS) {
    it(`[${build.name}] STOP stops messages without deleting, end to end`, async () => {
      const deps: EngineDeps = { ...fakeDeps(), failureTools: build.failureTools };
      const send = (text: string) =>
        runEngineTurn(
          { threadId: `adv-stop-${build.name}`, builderId: 'lokations', text, buyerPhone: '+919999991181', channel: 'whatsapp' },
          deps,
        );
      await send('tell me about Brigade Orchards');
      const r = await send('STOP messages');

      expect((r as { erased?: boolean }).erased).toBeUndefined();
      expect(r.reply).toMatch(/stopped all messages/i);
      expect(r.reply).toMatch(/haven't deleted/i);
    });

    it(`[${build.name}] DELETE removes everything, end to end`, async () => {
      const deps: EngineDeps = { ...fakeDeps(), failureTools: build.failureTools };
      const send = (text: string) =>
        runEngineTurn(
          { threadId: `adv-del-${build.name}`, builderId: 'lokations', text, buyerPhone: '+919999991182', channel: 'whatsapp' },
          deps,
        );
      await send('tell me about Brigade Orchards');
      const r = await send('DELETE everything');

      expect((r as { erased?: boolean }).erased).toBe(true);
    });
  }
});

/**
 * Desk counts opt-outs with
 *   `upper(trim(content)) IN ('STOP','UNSUBSCRIBE','DELETE MY DATA','REMOVE ME')
 *    OR lower(classifier_intent) IN ('opt_out','request_data_erasure')`
 * — an exact match against the WHOLE message, beside a classifier branch that
 * had never matched once because Spine never wrote the column. So the count
 * rested entirely on four literal strings, and a buyer does not type from a
 * list. Measured against the pattern as it stood, 14 of 23 ordinary phrasings
 * missed.
 */
describe('a buyer asking in her own words is still asking', () => {
  const OWN_WORDS = [
    'please delete all my data',
    'delete all my data',
    'please remove all my details',
    'erase my data',
    'erase all my information',
    'please delete my account',
    'take me off your list',
    'remove my name from your records',
    'please stop',
    'stop sending me messages',
    'i do not want any more messages',
    'delete everything you have on me',
    'wipe my data',
    'i withdraw my consent',
  ];

  for (const words of OWN_WORDS) {
    it(`"${words}" is recognised as an opt-out ask`, () => {
      expect(isOptOutAsk(words)).toBe(true);
    });
  }
});
