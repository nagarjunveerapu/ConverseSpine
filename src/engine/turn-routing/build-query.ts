import type { Env } from '../../env.js';
import type { TurnRoutingInput } from './types.js';
import {
  discourseStateTokenFromRouting,
  looksStateDependentForEmbed,
  withDiscourseStatePrefix,
} from './state-tokens.js';

/**
 * Query text for the intent-embedding lookup.
 *
 * INVARIANT (nlu/vocab.ts): the query must live in the SAME embedding space
 * as the corpus. The live index stores RAW phrasings (the mined corpus and
 * every Desk-promoted taught row), so the query is the buyer's raw words.
 * The canonical cutover (SIL_CANONICAL_EMBED) flips corpus and query together.
 *
 * Phase 2 — SIL_STATE_TOKENS: prepend a discourse state token
 * (`<focused>`, `<board:N>`, `<visit_pending>`, `<cold>`) only when the
 * phrasing is state-dependent (ask_next_step / bare confirm / closed deixis).
 * Fact intents stay raw↔raw so a partial corpus expand cannot skew get_price.
 *
 * This used to prepend a feature bundle (`phase=… | focus=… | buyer: …`,
 * the SCRUM-9 Path A classifier recipe). Against a raw-phrase corpus the
 * prefix is pure noise. State tokens are a closed set of four shapes, not
 * free-form feature dumps — and they only ship when the corpus ships too.
 */
export function buildRoutingQuery(
  input: TurnRoutingInput,
  env?: Pick<Env, 'SIL_STATE_TOKENS'>,
): string {
  const body = input.text.trim();
  if (env?.SIL_STATE_TOKENS !== 'true') return body;
  if (!looksStateDependentForEmbed(body)) return body;
  const token = discourseStateTokenFromRouting(input);
  return withDiscourseStatePrefix(body, token);
}
