/**
 * Trade-off Advisor — deterministic weight derivation from in-state soft
 * signals (Layer-neutral pure module; no I/O).
 *
 * Two consumers, kept in lockstep so ranking and memory never diverge:
 *   1. fetchRecommend passes these EXPLICIT weights to Desk /search — explicit
 *      wins over conversation_id resolution Desk-side, which closes the
 *      same-turn race (facts persist at Layer 13, AFTER the search).
 *   2. syncTelemetry persists the same numbers as BPE facts (*_importance),
 *      so a returning buyer with no KV state resolves to identical ranking
 *      via the Desk-side BPE path.
 *
 * The numbers are deterministic mappings of the buyer's own chip answer —
 * never LLM guesses (provenance stays honest).
 */

import type { Constraints } from './types.js';

export interface AdvisorSearchPrefs {
  preferenceWeights?: Record<string, number>;
  commuteHub?: string;
  budgetTargetInr?: number;
}

/** Worry token predicates (advisor brief chips, lowercased by the door). */
const worryHas = (c: Constraints, needle: string): boolean =>
  (c.worries ?? []).some((w) => w.includes(needle));

/**
 * Derive the commute-vs-budget priority from worries when unambiguous —
 * the bot then SKIPS the priority ask (ask less when you already know).
 */
export function derivedPriorityFromWorries(c: Constraints): 'commute' | 'budget' | undefined {
  const budgetWorry = worryHas(c, 'overpay') || worryHas(c, 'hidden cost');
  const commuteWorry = worryHas(c, 'traffic') || worryHas(c, 'commute');
  if (commuteWorry && !budgetWorry) return 'commute';
  if (budgetWorry && !commuteWorry) return 'budget';
  return undefined;
}

/** Chip answer → dimension weights. Exported for the telemetry mirror. */
export function importanceFromConstraints(c: Constraints): Record<string, number> {
  const w: Record<string, number> = {};
  const schools = c.schoolsMentioned || worryHas(c, 'school') ? 0.7 : undefined;
  switch (c.priorityFocus) {
    case 'commute':
      w.commute = 0.9; w.budget = 0.6;
      if (schools !== undefined) w.schools = schools;
      break;
    case 'budget':
      w.commute = 0.5; w.budget = 0.9;
      if (schools !== undefined) w.schools = schools;
      break;
    case 'balanced':
      w.commute = 0.7; w.budget = 0.7;
      if (schools !== undefined) w.schools = schools;
      break;
    default: {
      // No stated priority: only signals the buyer actually gave register.
      if (c.commuteHub) w.commute = 0.7;
      if (schools !== undefined) w.schools = schools;
      break;
    }
  }
  if (c.walkabilityMentioned) w.walkability = Math.max(w.walkability ?? 0, 0.7);
  if (c.valueMentioned) w.value = Math.max(w.value ?? 0, 0.7);
  // An investment purpose IS a value preference — the buyer's own chip answer.
  if (c.purpose === 'investment') w.value = Math.max(w.value ?? 0, 0.8);
  // Worries bump their dimension — a named fear outranks a default weight.
  if (worryHas(c, 'overpay') || worryHas(c, 'hidden cost')) w.budget = Math.max(w.budget ?? 0, 0.9);
  if (worryHas(c, 'traffic') || worryHas(c, 'commute')) w.commute = Math.max(w.commute ?? 0, 0.8);
  if (worryHas(c, 'school')) w.schools = Math.max(w.schools ?? 0, 0.8);
  if (worryHas(c, 'builder')) w.builder_trust = Math.max(w.builder_trust ?? 0, 0.9);
  if (worryHas(c, 'resale') || worryHas(c, 'appreciation') || worryHas(c, 'hold value')) {
    w.value = Math.max(w.value ?? 0, 0.9);
  }
  return w;
}

/** Search-call payload; empty object when the buyer gave no soft signals. */
export function advisorSearchPrefs(c: Constraints): AdvisorSearchPrefs {
  const weights = importanceFromConstraints(c);
  const out: AdvisorSearchPrefs = {};
  if (Object.keys(weights).length > 0) out.preferenceWeights = weights;
  if (c.commuteHub) out.commuteHub = c.commuteHub;
  // Soft target = the buyer's stated cap: "within/over your budget" narration
  // is measured against their own number, never an invented one.
  if (c.budgetMaxInr && c.budgetMaxInr > 0) out.budgetTargetInr = c.budgetMaxInr;
  return out;
}
