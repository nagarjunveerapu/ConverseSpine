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
import {
  extractLocation,
  isLocationBroadenTurn,
  isLocationCorrectionTurn,
} from '../facts.js';
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

/** Keyboard-smash / filler — never a locality ("asdf qwer zxcv" cliff). */
const GIBBERISH_TOKEN =
  /^(?:asdf|qwer|zxcv|qaz|wsx|edc|rfv|tgb|yhn|ujm|foo|bar|baz|qux|xxx+|aaa+|bbb+|test|testing|lorem|ipsum|hjkl|uiop|abcd|xyz+)$/i;

function looksLikeGibberishLocation(loc: string): boolean {
  const words = loc.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  // Every token is smash/filler, or a token has no vowel (zxcv).
  const smashy = words.filter((w) => GIBBERISH_TOKEN.test(w) || !/[aeiouy]/i.test(w));
  return smashy.length === words.length || smashy.length >= 2;
}

/**
 * Reject extract "locations" that are dialogue/facet noise (appreciation cliff,
 * short chips, yield phrases). Bare place names that ARE the whole utterance
 * ("Whitefield", "banglore whitefield") stay plausible — equality alone is not junk.
 */
export function isImplausibleLocationCapture(loc: string, text: string): boolean {
  const l = loc.trim();
  if (!l) return true;
  const t = text.trim().toLowerCase();
  const locLc = l.toLowerCase();
  if (l.length > 48) return true;
  if (l.split(/\s+/).length > 6) return true;
  if (looksLikeGibberishLocation(l)) return true;
  // Facet / chip / temporal vocabulary — never a locality.
  if (
    /\b(?:appreciat|possession|rera|pricing|budget|bhk|yield|rental|percent|ballpark|loans?|discount|honest|guarantee|flexible|years?|book\s+today|\bltv\b)\b/i.test(
      l,
    )
  ) {
    return true;
  }
  if (/^(?:when|loans?|discount|discounts?|emi|offers?|fine|which|what|how|yes|no|ok|thanks|ltv)$/i.test(locLc)) {
    return true;
  }
  // Whole-utterance capture: junk when the utterance is not a bare place phrase.
  if (locLc === t) {
    if (/[?]/.test(text)) return true;
    if (t.split(/\s+/).length > 4) return true;
    if (
      /\b(?:appreciat|yield|possession|rera|pricing|budget|bhk|loan|discount|honest|guarantee|percent|ballpark|when|how|what|which|is|are|has|does)\b/i.test(
        t,
      )
    ) {
      return true;
    }
    return false;
  }
  return false;
}

function plausibleLocationDelta(prior: string | undefined, next: string | undefined, text: string): boolean {
  const loc = (next ?? '').trim();
  if (!loc) return false;
  if (loc.toLowerCase() === (prior ?? '').toLowerCase()) return false;
  if (isImplausibleLocationCapture(loc, text)) return false;
  return true;
}

/** Budget / locality / explore — genuine search pivots (not inventory filters). */
function hasGeographyOrBudgetOrExploreDelta(
  prior: Constraints,
  ex: Extracted,
  text: string,
): boolean {
  if (EXPLORE_MORE_RE.test(text)) return true;
  const c = ex.constraints;
  if (c.budgetMaxInr !== undefined && c.budgetMaxInr !== prior.budgetMaxInr) return true;
  if (c.budgetMinInr !== undefined && c.budgetMinInr !== prior.budgetMinInr) return true;
  if (plausibleLocationDelta(prior.location, c.location, text)) return true;
  // Focused extract skips bare localities (phase gate). isFocusedSearchPivot still
  // sees them via extractLocation(text) — count that as a real place move.
  if (plausibleLocationDelta(prior.location, extractLocation(text), text)) return true;
  return false;
}

function hasBhkOrTypeDelta(prior: Constraints, ex: Extracted): boolean {
  const c = ex.constraints;
  if (c.bhk && c.bhk !== prior.bhk) return true;
  if (c.propertyType && c.propertyType !== prior.propertyType) return true;
  return false;
}

/**
 * Wave 3 — "loan eligibility … what's the 2 BHK available" is an inventory
 * filter on the focused project, not "2 BHK in Jayanagar" search.
 */
function isFocusedInventoryFilterAsk(text: string): boolean {
  if (
    !/\b(?:\d+\s*bhk|configs?|configurations?|units?|inventory|what'?s\s+available)\b/i.test(text)
  ) {
    return false;
  }
  return /\b(?:available|availability|inventory|units?\s+left|on\s+offer|configs?)\b/i.test(text);
}

export function hasStrongSearchConstraintDelta(
  prior: Constraints,
  ex: Extracted,
  text: string,
): boolean {
  if (hasGeographyOrBudgetOrExploreDelta(prior, ex, text)) return true;
  if (hasBhkOrTypeDelta(prior, ex)) return true;
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
  // Exception: BHK/type delta alone with a focused facet (loan/price/…) or an
  // on-project inventory ask — hold. "2 BHK in Jayanagar" still releases via
  // geography delta above.
  if (strongConstraintDelta) {
    const inventoryOnly =
      !hasGeographyOrBudgetOrExploreDelta(input.priorConstraints, input.ex, input.text) &&
      hasBhkOrTypeDelta(input.priorConstraints, input.ex) &&
      (isFocusedFacetRequirement(input.text) || isFocusedInventoryFilterAsk(input.text));
    if (inventoryOnly) {
      return {
        action: 'hold_focus',
        reason: 'focused_facet_inventory_filter',
        regexPivot,
        strongConstraintDelta,
        answerHold,
      };
    }
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
    // Soft budget / junk-loc regex hits with no material constraint move must not
    // cliff focus ("budget 70L but flexible" when already at 70L). Explicit explore /
    // broaden / correction / change-slot still release even without extract delta.
    const explicitSearchMove =
      EXPLORE_MORE_RE.test(input.text) ||
      isLocationBroadenTurn(input.text) ||
      isLocationCorrectionTurn(input.text) ||
      /\b(?:change|switch|update)\s+(?:my\s+)?(?:area|location|budget|bhk|property type)\b/i.test(
        input.text,
      );
    if (!strongConstraintDelta && !explicitSearchMove) {
      return {
        action: 'hold_focus',
        reason: 'regex_without_material_delta',
        regexPivot,
        strongConstraintDelta,
        answerHold,
      };
    }
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
