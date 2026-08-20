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
export function isStandaloneStop(text: string): boolean {
  return /^(?:stop|unsubscribe)[.!]?\s*$/i.test(text.trim());
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
  return /^(?:delete|erase)[.!]?\s*$/i.test(text.trim());
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
  return /\b(?:delete my (?:data|details|number|info(?:rmation)?)|forget me|remove my (?:details|data|number|info(?:rmation)?))\b/i.test(
    text,
  );
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
