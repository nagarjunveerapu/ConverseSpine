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
 * as the corpus. Pass `canon` when the index was built canonically and the
 * buyer's words get entity-masked to match; omit it and the query is the raw
 * words, for a raw index.
 *
 * This used to claim the cutover "flips corpus and query together" while the
 * signature could not even see SIL_CANONICAL_EMBED — so the corpus side masked
 * entities and this side did not. Measured 16 Aug 2026: this is the lane that
 * produces `bind_source: embed_intent`, i.e. the authority that reaches goal
 * selection, so the skew would have landed on the primary path while the
 * secondary lane (adapters/semantic-nlu.ts, topic gap-fill only) was correct.
 * The `canon` parameter mirrors rebuild/intent-index.ts `embedTextForRow`
 * exactly — same argument, same order — so the two sides are read side by side.
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
  canon?: (text: string) => string,
): string {
  // Canonicalize FIRST, then prefix — the corpus does the same, and state
  // tokens are not entities, so masking must not see them.
  const body = (canon ? canon(input.text) : input.text).trim();
  if (env?.SIL_STATE_TOKENS !== 'true') return body;
  if (!looksStateDependentForEmbed(body)) return body;
  const token = discourseStateTokenFromRouting(input);
  return withDiscourseStatePrefix(body, token);
}
