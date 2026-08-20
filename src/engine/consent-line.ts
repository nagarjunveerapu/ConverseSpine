/**
 * The sentence that tells a buyer how to leave.
 *
 * Erasure has worked for a while. Nobody could reach it: the words that
 * triggered it were `delete my data`, `forget me`, `remove my details` — a
 * vocabulary a buyer would have to guess, phrase for phrase, with no way of
 * knowing they had guessed right. A right nobody can find is not a right.
 *
 * So the bot says it once, unprompted, at first contact, and then never
 * again. Two words, each doing exactly one thing:
 *
 *   STOP    — stop the messages, keep the record
 *   DELETE  — remove everything we hold
 *
 * The prior art is YantraDesk, which appended a one-line DPDPA notice to the
 * first reply and stamped `consent_timestamp` so it was never repeated. Same
 * shape here, with the second word added — Yantra told buyers only about STOP
 * and then treated STOP as a full erasure, which is the confusion this file
 * exists to end.
 *
 * Not on every reply. A notice repeated every turn is not a notice, it is
 * furniture, and buyers stop reading furniture on the second sighting.
 */

/** Kept short on purpose — it rides beside a real answer, not instead of one. */
export const CONSENT_NOTICE =
  'Reply STOP any time to stop messages, or DELETE to remove everything we hold about you.';

/**
 * Whether this conversation still owes the buyer the notice.
 *
 * The stamp lives on the session state, so an existing conversation that
 * predates this code has no stamp and gets told on its next turn. That is the
 * correct reading, not a migration gap: those buyers were never told either.
 *
 * WhatsApp only. The advisor app has a Delete profile button on a screen the
 * buyer can see, so a line explaining how to type keywords at it would be
 * describing a door that isn't there.
 */
export function owesConsentNotice(args: {
  channel: string;
  consentNoticedAt?: number;
  erased?: boolean;
}): boolean {
  if (args.channel !== 'whatsapp') return false;
  // The turn that erased everything must not re-save a state we just purged,
  // and a buyer who has just been forgotten does not need a leaflet.
  if (args.erased) return false;
  return !args.consentNoticedAt;
}
