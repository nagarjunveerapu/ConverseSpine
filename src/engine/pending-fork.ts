/**
 * Reading the answer to a question the bot itself asked.
 *
 * Every closer the engine writes is a question, and most of them are FORKS:
 * "Curious about loan eligibility, or shall I walk through the configs?" A real
 * buyer answers that with "both", "neither", "the second one", "configs", or
 * just "haan" — and before this, all of those fell through to a byte-identical
 * repeat of the same card, because the only answer the engine could hear was a
 * bare yes.
 *
 * The record of what was asked lives on `PendingPrompt.options`, written by the
 * same table that wrote the words (compose.CLOSERS). This module is the reader.
 * It never guesses from the prose — if there are no recorded options, there is
 * no fork to resolve.
 */
import type { AnswerTopic } from './types.js';
import type { PendingPrompt } from './turn-intent/types.js';

export type ForkAnswer =
  | { kind: 'pick'; topic: AnswerTopic }
  /** "both" / "all of it" — take the first now, the closer re-offers the rest. */
  | { kind: 'all'; topic: AnswerTopic; rest: readonly AnswerTopic[] }
  /** "neither" / "none of that" — a decline of the FORK, not of the project. */
  | { kind: 'none' };

const ALL_OF_IT = /^(?:both|all|all of (?:it|them|that)|everything|dono|sab)\b/i;
const NONE_OF_IT = /^(?:neither|none|none of (?:it|them|that)|not (?:either|those)|koi nahi)\b/i;
const ORDINAL: ReadonlyArray<readonly [RegExp, number]> = [
  [/\b(?:1st|first|pehla|pehle)\b/i, 0],
  [/\b(?:2nd|second|doosra|dusra)\b/i, 1],
  [/\b(?:3rd|third|teesra)\b/i, 2],
  [/\blast\b/i, -1],
];

/** Words that name a topic when a buyer picks a fork by name rather than order. */
const TOPIC_WORDS: ReadonlyArray<readonly [AnswerTopic, RegExp]> = [
  ['price', /\b(?:pricing|price|cost|rate|budget)\b/i],
  ['emi', /\b(?:emi|loan|eligibility|monthly|installment)\b/i],
  ['availability', /\b(?:config|configs|configuration|units?|sizes?|bhk|inventory|availability)\b/i],
  ['legal', /\b(?:legal|rera|khata|approvals?|title)\b/i],
  ['compare', /\b(?:compare|comparison|nearby|others?|alternatives?)\b/i],
  ['amenities', /\b(?:amenit|clubhouse|facilities)\b/i],
  ['location', /\b(?:location|area|connectivity)\b/i],
  ['media', /\b(?:brochure|photos?|images?|pdf)\b/i],
];

/**
 * What the buyer's line means AGAINST the question that is actually open.
 * Returns undefined when nothing is open, or when the line is not an answer to
 * it — an ordinary question routes normally and must not be hijacked here.
 */
export function resolvePendingFork(
  text: string,
  pending: PendingPrompt | undefined,
): ForkAnswer | undefined {
  const options = pending?.options;
  if (!options?.length) return undefined;
  const t = text.trim();
  if (!t || t.length > 60) return undefined;

  if (NONE_OF_IT.test(t)) return { kind: 'none' };

  if (ALL_OF_IT.test(t)) {
    return { kind: 'all', topic: options[0]!, rest: options.slice(1) };
  }

  for (const [re, idx] of ORDINAL) {
    if (!re.test(t)) continue;
    const picked = idx < 0 ? options[options.length - 1] : options[idx];
    // "the third one" against a two-way fork is the buyer mis-counting, not a
    // pick — better to fall through and let the turn route normally.
    if (picked) return { kind: 'pick', topic: picked };
  }

  // Named fork — only counts when the word names one of the RECORDED options.
  // Matching any topic word would steal ordinary questions from the router.
  const named = TOPIC_WORDS.filter(([, re]) => re.test(t)).map(([topic]) => topic);
  // Naming TWO topics is a request ("pricing and legal"), not a pick between
  // the forks we offered — the multi-topic answer path owns it, and stealing it
  // here would silently drop half of what the buyer asked for.
  if (named.length !== 1) return undefined;
  const picked = named[0]!;
  return options.includes(picked) ? { kind: 'pick', topic: picked } : undefined;
}
