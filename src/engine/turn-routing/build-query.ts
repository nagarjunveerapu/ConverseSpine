import type { TurnRoutingInput } from './types.js';

/**
 * Query text for the intent-embedding lookup.
 *
 * INVARIANT (nlu/vocab.ts): the query must live in the SAME embedding space
 * as the corpus. The live index stores RAW phrasings (the mined corpus and
 * every Desk-promoted taught row), so the query is the buyer's raw words.
 * The canonical cutover (SIL_CANONICAL_EMBED) flips corpus and query together.
 *
 * This used to prepend a feature bundle (`phase=… | focus=… | buyer: …`,
 * the SCRUM-9 Path A classifier recipe). Against a raw-phrase corpus the
 * prefix is pure noise: on short asks it dominates the cosine — "ameneties?"
 * scored 0.65 (below τ) against its own exact taught vector — and the focus
 * project name drags matches toward get_project_info. Phase/visit context
 * belongs in mapIntentToRouting, which already receives the full input.
 */
export function buildRoutingQuery(input: TurnRoutingInput): string {
  return input.text.trim();
}
