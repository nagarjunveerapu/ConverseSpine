import type { AnswerTopic } from './types.js';
import type { TurnRoutingResult } from './turn-routing/types.js';

/**
 * Minimum embedding confidence before the semantic verdict may fill a topic.
 * Same bar the auto-teach gate uses (TAU_BIND in understanding/auto-teach.ts) —
 * one threshold for "the embedding layer is confident", not two that drift.
 */
export const SIL_TOPIC_TAU = 0.78;

/**
 * Corpus `intent_kind` → the answer topic the engine can actually serve.
 *
 * The corpus classifies 33 intent kinds; the engine can answer 10 topics. Only
 * kinds with a REAL answer path appear here. Recognised-but-unanswerable kinds
 * are deliberately absent — `ask_about_builder` (364 rows),
 * `ask_investment_return` (445), `ask_delivery_timeline` (373),
 * `get_payment_plan` (359) — because forcing them into the nearest topic would
 * answer a different question than the buyer asked, which is the "on-topic is
 * not answered" defect. They fall through to the honest below-threshold path
 * instead. Giving them real answer paths is separate, deliberate work.
 */
const INTENT_TOPIC: Readonly<Record<string, AnswerTopic>> = {
  get_price: 'price',
  negotiate_price: 'price',
  get_legal_info: 'legal',
  compute_emi: 'emi',
  get_amenities: 'amenities',
  get_availability: 'availability',
  get_location_info: 'location',
  get_brochure: 'media',
  get_project_info: 'overview',
  compare_projects: 'compare',
};

/** Intent kinds the corpus knows but the engine has no answer path for. Exported
 *  so the gap is a visible, testable fact rather than tribal knowledge. */
export const UNANSWERABLE_INTENT_KINDS: readonly string[] = [
  'ask_about_builder',
  'ask_investment_return',
  'ask_delivery_timeline',
  'get_payment_plan',
];

/**
 * The semantic layer's answer topic for this turn, or undefined.
 *
 * Only binds when the EMBEDDING lane produced the verdict (`embed_intent`) and
 * cleared τ. A regex-sourced bind is deliberately ignored here: this wire exists
 * to let the 14k-row corpus reach routing, not to add another pattern path.
 */
export function silTopic(
  routing: TurnRoutingResult | undefined,
  tau: number = SIL_TOPIC_TAU,
): AnswerTopic | undefined {
  const bind = routing?.bind;
  if (!bind || bind.bind_source !== 'embed_intent') return undefined;
  if ((bind.top_score ?? 0) < tau) return undefined;
  const kind = bind.top_kind;
  return kind ? INTENT_TOPIC[kind] : undefined;
}
