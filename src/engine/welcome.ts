/**
 * The hello a self-registered buyer has already earned.
 *
 * WHAT DESK PROMISED ON OUR BEHALF
 *
 * A buyer at a site office fills Desk's own form — name, project, what they
 * are looking at, whether it is to live in or to invest — and Desk hands them
 * a `wa.me` link with the first message pre-written. Desk's own comment
 * (`lib/registration.ts`) says what happens next:
 *
 *     "the bot answers freely — welcome, preferences read back,
 *      official-channel line, no template in the way."
 *
 * None of that existed here. Desk built the sender; Spine had no receiver —
 * the fourth time a `conversation_context` field has crossed the wire into a
 * type that never declared it. The buyer typed six things into a form, tapped
 * a link that opened WhatsApp, and was met by a bot that greeted them as a
 * stranger and asked for the same six things again.
 *
 * WHY IT IS ITS OWN MESSAGE, AND WHY IT LEADS
 *
 * The consent notice trails the answer, deliberately: a buyer's own question
 * should be the first thing they read. A welcome is the opposite — it is the
 * thing that makes the reply legible, and a greeting that arrives after the
 * answer is not a greeting. It also stays out of `reply_text` because that
 * body is capped at 1024 characters whenever the turn carries a list or
 * buttons, and a welcome lost to a slice reads as the bot ignoring them.
 *
 * WHAT IT MAY AND MAY NOT SAY
 *
 * Only what is on the record. An empty brief produces a greeting with no
 * read-back rather than a warm sentence about preferences nobody stated —
 * "we've got your requirements" over an empty row is the exact shape of the
 * false affirmative this codebase has paid for before.
 */
import type { Constraints } from './types.js';

export interface WelcomeInput {
  channel: string;
  /** `conversations.source_detail === 'self_registered'`. */
  selfRegistered?: boolean;
  /** Set once the buyer has been welcomed. Presence is what stops a repeat. */
  welcomedAt?: number;
  /** A buyer who asked to be forgotten is not owed a warm hello. */
  erased?: boolean;
  buyerName?: string;
  builderName: string;
  constraints: Constraints;
  focusProjectName?: string;
}

/**
 * Whether this conversation still owes the buyer their welcome.
 *
 * WhatsApp only: the advisor app opens on a screen that shows the profile
 * back, so a sentence describing what we hold would be narrating something
 * already on the display.
 */
export function owesWelcome(input: WelcomeInput): boolean {
  if (input.channel !== 'whatsapp') return false;
  if (!input.selfRegistered) return false;
  if (input.erased) return false;
  return !input.welcomedAt;
}

/** The buyer's own words for a column value. `self_use` is our schema, not theirs. */
function purposePhrase(purpose: Constraints['purpose']): string {
  if (purpose === 'self_use') return 'to live in';
  if (purpose === 'investment') return 'as an investment';
  return '';
}

/**
 * The line itself, or '' when there is nothing honest to say.
 *
 * Returns '' rather than a generic greeting when the record is empty AND the
 * builder is unknown, because a welcome that names nothing is furniture.
 */
export function welcomeLine(input: WelcomeInput): string {
  const name = input.buyerName?.trim();
  const builder = input.builderName?.trim();
  const greeting = name ? `Hi ${name} —` : 'Hi —';

  // The official-channel line. It is not decoration: a buyer who scanned a QR
  // at a gate has no way of knowing whose WhatsApp number they just opened,
  // and the number they were handed is the one place a person impersonating
  // the builder would be easiest to believe.
  const channelLine = builder
    ? `you're through to ${builder} on WhatsApp — this is the official number.`
    : `you're through on WhatsApp — this is the official number.`;

  const c = input.constraints;
  const purpose = purposePhrase(c.purpose);
  const held = [
    input.focusProjectName?.trim() && `*${input.focusProjectName.trim()}*`,
    c.bhk?.trim(),
    c.location?.trim(),
    purpose && `buying ${purpose}`,
  ].filter(Boolean) as string[];

  if (!held.length) {
    // They registered, but the form carried nothing we can name. Say hello and
    // get out of the way — never "we have your requirements" over an empty row.
    return `${greeting} ${channelLine}`;
  }

  return (
    `${greeting} ${channelLine} ` +
    `I have what you filled in at the site office: ${held.join(', ')}. ` +
    `Ask me anything about it — pricing, legals, or a visit.`
  );
}
