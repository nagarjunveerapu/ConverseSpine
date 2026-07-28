/**
 * Phase 0d — pivot arbiter (post uₜ join).
 *
 * Demotes `isFocusedSearchPivot` from sole authority to one signal. Runs only
 * when understanding-before-mutation is on and a focused turn would otherwise
 * enter the turn-intent release path.
 *
 * Precedence (DIALOGUE_STATE §3b + 0e tiebreaker):
 *  1. Strong search-constraint delta (budget / BHK / explore-more / real locality) → release
 *  2. Else high-confidence answer-intent bind → hold (tiebreaker; never equal veto alone)
 *  3. Else regex pivot signal → release (legacy behaviour)
 *  4. Else hold
 */
import { answerRequirements } from '../answer-contract.js';
import { resolveFaqQuestionKeys } from '../faq-keys.js';
import type { Constraints, Extracted } from '../types.js';
import { holdsFocusAgainstRelease } from '../turn-routing/focus-hold.js';
import type { TurnRoutingResult } from '../turn-routing/types.js';
import { isFocusedSearchPivot } from './focused-intent.js';

export type PivotArbiterAction = 'hold_focus' | 'release_to_discover';

export interface PivotArbiterInput {
  text: string;
  priorConstraints: Constraints;
  ex: Extracted;
  routing: TurnRoutingResult | undefined;
  /** When false, always release path (inert — caller should not invoke). */
  enabled: boolean;
}

export interface PivotArbiterDecision {
  action: PivotArbiterAction;
  reason: string;
  regexPivot: boolean;
  strongConstraintDelta: boolean;
  answerHold: boolean;
}

const EXPLORE_MORE_RE =
  /\b(?:show me other|show me more|other projects|more projects|more options|back to (?:all )?matches|my matches|different projects|different area|change area|another area)\b/i;

/** Reject extract "locations" that are the whole utterance (appreciation cliff). */
export function isImplausibleLocationCapture(loc: string, text: string): boolean {
  const l = loc.trim();
  if (!l) return true;
  const t = text.trim().toLowerCase();
  if (l.toLowerCase() === t) return true;
  if (l.length > 48) return true;
  if (l.split(/\s+/).length > 6) return true;
  // Full-sentence extracts ("has this area appreciated") — not a place.
  if (/\b(?:appreciat|possession|rera|pricing|budget|bhk)\b/i.test(l)) return true;
  return false;
}

function plausibleLocationDelta(prior: string | undefined, next: string | undefined, text: string): boolean {
  const loc = (next ?? '').trim();
  if (!loc) return false;
  if (loc.toLowerCase() === (prior ?? '').toLowerCase()) return false;
  if (isImplausibleLocationCapture(loc, text)) return false;
  return true;
}

export function hasStrongSearchConstraintDelta(
  prior: Constraints,
  ex: Extracted,
  text: string,
): boolean {
  if (EXPLORE_MORE_RE.test(text)) return true;

  const c = ex.constraints;
  if (c.budgetMaxInr !== undefined && c.budgetMaxInr !== prior.budgetMaxInr) return true;
  if (c.budgetMinInr !== undefined && c.budgetMinInr !== prior.budgetMinInr) return true;
  if (c.bhk && c.bhk !== prior.bhk) return true;
  if (c.propertyType && c.propertyType !== prior.propertyType) return true;
  if (plausibleLocationDelta(prior.location, c.location, text)) return true;
  return false;
}

/** Closed-set facet / FAQ atoms — hold focus even when the embedder miss-fires. */
const FOCUSED_FACET_KEYS = new Set([
  'appreciation',
  'rental_yield',
  'growth_drivers',
  'possession',
  'rera',
  'khata',
  'ec_status',
  'price',
  'loan_eligibility',
]);

export function isFocusedFacetRequirement(text: string): boolean {
  if (answerRequirements(text).some((k) => FOCUSED_FACET_KEYS.has(k))) return true;
  if (resolveFaqQuestionKeys(text).length > 0) return true;
  return false;
}

export function arbitrateFocusPivot(input: PivotArbiterInput): PivotArbiterDecision {
  const regexPivot = isFocusedSearchPivot(input.text);
  const strongConstraintDelta = hasStrongSearchConstraintDelta(
    input.priorConstraints,
    input.ex,
    input.text,
  );
  const answerHold = holdsFocusAgainstRelease(input.routing, true).hold;

  if (!input.enabled) {
    return {
      action: regexPivot ? 'release_to_discover' : 'hold_focus',
      reason: 'flag_off',
      regexPivot,
      strongConstraintDelta,
      answerHold,
    };
  }

  // Genuine search move — bind cannot pin the buyer on the old project.
  if (strongConstraintDelta) {
    return {
      action: 'release_to_discover',
      reason: 'strong_constraint_delta',
      regexPivot,
      strongConstraintDelta,
      answerHold,
    };
  }

  // Deterministic facet/FAQ ask (appreciation, possession, RERA…) — hold even
  // when the embedder does not clear tau (0e precision).
  if (isFocusedFacetRequirement(input.text)) {
    return {
      action: 'hold_focus',
      reason: 'focused_facet_requirement',
      regexPivot,
      strongConstraintDelta,
      answerHold,
    };
  }

  // Tiebreaker: answer-intent about this project; no real search delta.
  if (answerHold) {
    return {
      action: 'hold_focus',
      reason: 'answer_intent_tiebreaker',
      regexPivot,
      strongConstraintDelta,
      answerHold,
    };
  }

  if (regexPivot) {
    return {
      action: 'release_to_discover',
      reason: 'regex_pivot_signal',
      regexPivot,
      strongConstraintDelta,
      answerHold,
    };
  }

  return {
    action: 'hold_focus',
    reason: 'default_hold',
    regexPivot,
    strongConstraintDelta,
    answerHold,
  };
}
