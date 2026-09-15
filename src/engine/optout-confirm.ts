import type { Failure } from './outcome.js';

export type StopConfirmMode = 'delete_confirm' | 'contact_scope';
export type StopResolution = 'delete' | 'keep' | 'ambiguous' | 'other';

/**
 * The two words the buyer is TOLD about, at first contact — see
 * `consentNotice` in ./consent-line.ts. Because we advertise them, they must
 * behave exactly as advertised, and they must not mean the same thing.
 *
 * STOP stops the messages. It does not delete anything: a buyer who is done
 * being contacted has not asked us to forget the visit they booked, and
 * answering "stop texting me" by wiping their record was the second-worst
 * reply in the corpus. `contact_only` is the scope Desk already had for it.
 *
 * Until now a bare STOP ran the full erasure and a bare DELETE matched
 * nothing at all — it fell through to project search. The two words were
 * backwards, and the destructive one was the one buyers actually type.
 */

/**
 * ONE vocabulary for asking us to go away.
 *
 * It was written four times before this: `STOP_RE` in facts.ts, `chip.stop` in
 * speech-act/resolve.ts (whose comment asked the reader to "keep in lockstep
 * with STOP_RE", which they had already drifted out of — `opt\s*out` against
 * `opt[\s-]?out`, and only one of the two admitted a bare DELETE), and the two
 * standalone helpers below. Desk spells it a fifth time, as four literal
 * strings in the DPDP opt-out count.
 *
 * Every one of those five was an EXACT list, and a buyer does not type from a
 * list. Measured against the pattern as it stood, 14 of 23 ordinary phrasings
 * missed — "please delete all my data", "erase my data", "take me off your
 * list", "please stop", "stop sending me messages", "i do not want any more
 * messages". Put through the real engine, "please delete all my data" was
 * answered with a project overview.
 *
 * The CONTACT / ERASURE split is kept, because it is load-bearing and
 * advertised: STOP stops messages and deletes nothing; DELETE is destructive
 * and is always confirmed first. Widening the words a buyer may use to reach
 * each door does not move that door.
 */
// The whole group is optional, whitespace included. Written as
// `POLITE + '?'` the `?` binds to `\\s+` instead, which makes the politeness
// REQUIRED — and a bare STOP then matches nothing at all.
const POLITE = '(?:(?:please|pls|plz|kindly)\\s+)?';
const ERASE_VERB = '(?:delete|erase|remove|wipe|purge)';
/**
 * "STOP please", "DELETE please". The notice tells the buyer to reply with one
 * word; a buyer who adds a courtesy to it was still replying with that word,
 * and was getting a project shortlist for it.
 */
const TRAILING = '(?:\\s+(?:please|pls|plz|now|thanks?|thank\\s+you))?[.!]*\\s*$';
/**
 * The object the notice ITSELF names. "Reply STOP any time to stop MESSAGES,
 * or DELETE to remove EVERYTHING we hold about you" \u2014 so "STOP messages" and
 * "DELETE everything" are the buyer quoting us back, and both fell through.
 */
const STOP_OBJECT =
  '(?:\\s+(?:all\\s+)?(?:messages?|msgs?|texts?|sms|whatsapp|contact|calls?|communication))?';
/**
 * Deliberately only the notice's own two words. "delete my data" keeps its
 * existing route through the CONFIRM \u2014 erasure is irreversible, and widening
 * the set that fires it without asking is not a change to make in passing.
 */
const ERASE_OBJECT = '(?:\\s+(?:everything|all))?';

/**
 * The two advertised words, as whole messages. Named once and used BOTH by the
 * helpers that fire the action and by the vocabulary that gates them —
 * `ex.stop` has to be true before `isStandaloneDelete` is ever consulted, so a
 * helper widened on its own reaches nothing. That is exactly what happened the
 * first time this was widened: "DELETE everything" matched the helper and
 * still fell through, because the gate above it had not moved.
 */
const STANDALONE_STOP = '^' + POLITE + '(?:stop|unsubscribe)' + STOP_OBJECT + TRAILING;
const STANDALONE_DELETE = '^' + POLITE + '(?:delete|erase)' + ERASE_OBJECT + TRAILING;
/** What a buyer calls the things we hold about her. */
const HER_RECORDS = '(?:data|details|info(?:rmation)?|number|records?|account|name)';

/** Asks us to stop CONTACTING her. Reversible; nothing is deleted. */
export const OPT_OUT_CONTACT_RE = new RegExp(
  [
    STANDALONE_STOP,
    '\\bunsubscribe\\b',
    '\\bopt[\\s-]?out\\b',
    // "stop sending me messages" — up to two words may sit between the verb and
    // the thing being refused. The gap is bounded on purpose: "stop asking
    // questions" is about the bot's behavior, not about contact, and must not
    // resolve here.
    '\\b(?:stop|don\'?t|do not|no more)\\s+(?:\\w+\\s+){0,2}?(?:messag\\w*|text\\w*|calls?|calling|contact\\w*|whatsapp\\w*|sms)\\b',
    '\\b(?:do not|don\'?t)\\s+want\\s+(?:any\\s+)?(?:more\\s+)?(?:messages?|texts?|calls?|contact)\\b',
  ].join('|'),
  'i',
);

/** Asks us to ERASE what we hold. Destructive — always confirmed first. */
export const OPT_OUT_ERASURE_RE = new RegExp(
  [
    STANDALONE_DELETE,
    // "delete all my data", "erase my information", "wipe my records".
    '\\b' + ERASE_VERB + '\\s+(?:all\\s+)?(?:of\\s+)?my\\s+' + HER_RECORDS + '\\b',
    '\\b' + ERASE_VERB + '\\s+everything\\s+(?:you\\s+(?:have|hold|know)\\s+)?(?:about|on)\\s+me\\b',
    '\\bforget me\\b',
    '\\bremove me\\b',
    '\\btake me off\\s+(?:your\\s+)?(?:list|lists|database|records?|mailing\\s*list)\\b',
    '\\bwithdraw\\s+(?:my\\s+)?consent\\b',
  ].join('|'),
  'i',
);

/**
 * Either door. This is the question `classifier_intent = 'opt_out'` answers,
 * and the one Desk's DPDP posture counts — so it must be the same question
 * everywhere, which is the whole point of this file.
 */
export function isOptOutAsk(text: string): boolean {
  const t = text.trim();
  return OPT_OUT_CONTACT_RE.test(t) || OPT_OUT_ERASURE_RE.test(t);
}

export function isStandaloneStop(text: string): boolean {
  return new RegExp(STANDALONE_STOP, 'i').test(text.trim());
}

/**
 * DELETE erases everything. Standalone only — "delete that message" and
 * "delete the 2bhk from my shortlist" are ordinary sentences, and a word this
 * destructive gets no fuzzy matching.
 *
 * No confirmation step, deliberately. The greeting said what this word does
 * before the buyer typed it; asking "are you sure?" after advertising a
 * keyword makes the advertised keyword a lie. Longer phrasings that only
 * MIGHT mean deletion still go through the confirm ladder below, because
 * there we are guessing and here we are not.
 */
export function isStandaloneDelete(text: string): boolean {
  return new RegExp(STANDALONE_DELETE, 'i').test(text.trim());
}

/**
 * "Do not call, just message me here", "no calls please, WhatsApp only".
 *
 * This is the OPPOSITE of an opt-out: the buyer is asking to keep talking, on
 * one channel. Extraction reads the "do not call" half and stamps `stop`, which
 * used to answer a request to keep chatting with an offer to delete everything
 * — the single worst reply in the corpus, and it was counted clean because no
 * invariant knew to look for it.
 *
 * Requires BOTH halves: a refusal of calls AND a channel to keep. A bare "don't
 * call me" with nothing after it stays an opt-out, which is the safe reading.
 */
export function keepsOneChannel(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 160) return false;
  if (isExplicitDeleteIntent(t)) return false;
  const refusesCalls =
    /\b(?:do ?n[o']?t|dont|no|stop|avoid)\s+(?:call|calls|calling|phone|phoning|ring|ringing)\b|\bno calls?\b|\bcalls? not\b/i.test(
      t,
    );
  if (!refusesCalls) return false;
  return /\b(?:message|msg|text|chat|whatsapp|wa|write|here|this chat)\b/i.test(t);
}

/** Explicitly asks to erase stored data, rather than only changing contact. */
export function isExplicitDeleteIntent(text: string): boolean {
  return OPT_OUT_ERASURE_RE.test(text);
}

export function contactScopeFailure(): Failure {
  return {
    kind: 'ambiguous',
    stage: 'destructive_gate',
    subject: 'opt_out',
  };
}

export function resolvePendingStop(mode: StopConfirmMode, text: string): StopResolution {
  const t = text.trim();
  const strictYes =
    /^(?:yes|yeah|yep|yup|haan|confirm(?:ed)?|yes please|delete (?:it|everything))[.!]?\s*$/i.test(
      t,
    );
  if (mode === 'delete_confirm') return strictYes ? 'delete' : 'other';

  // A yes/no answer cannot resolve a two-reading destructive question.
  if (/^(?:yes|yeah|yep|yup|haan|no|nope|nah)[.!]?\s*$/i.test(t)) return 'ambiguous';
  if (
    /^(?:2|second|stop all|stop contacting me|delete (?:my )?(?:data|details|everything)|delete everything|all contact)[.!]?\s*$/i.test(
      t,
    )
  ) {
    return 'delete';
  }
  if (
    /^(?:1|first|keep (?:chatting|the chat|my search)|only (?:chat|this chat)|chat only|stop (?:calls?|calling|messages?|messaging|whatsapp) only)[.!]?\s*$/i.test(
      t,
    )
  ) {
    return 'keep';
  }
  return 'other';
}
