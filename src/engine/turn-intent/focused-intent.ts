import type { Constraints } from '../types.js';
import {
  detectPropertyTypes,
  detectTopics,
  extractLocation,
  isLocationBroadenTurn,
  parseBudgetToInr,
} from '../facts.js';
import { classifySpeechAct, isNonSearchSpeechAct } from '../speech-act/index.js';
import type { PatchClearKey, TurnIntentInput, TurnIntentResult } from './types.js';

const EXPLORE_MORE_RE =
  /\b(?:show me other|show me more|other projects|more projects|more options|back to (?:all )?matches|my matches|different projects|different area|change area|another area)\b/i;

const MENU_TOPIC_ONLY =
  /^(?:pricing|price|legal|rera|emi|visit|amenities|location|floor plans?|availability|media|overview)\.?$/i;

/** Focused-phase project Q&A — not a search pivot. */
function isFocusedProjectQuestion(text: string): boolean {
  const t = text.trim();
  if (MENU_TOPIC_ONLY.test(t)) return true;
  if (/^(?:legal|rera|pricing|price|emi|visit|amenities|availability|possession|floor plan)\b/i.test(t)) {
    return true;
  }
  if (/^location(?:\s+details?)?\s*\.?\s*$/i.test(t) || /\blocation details?\b/i.test(t)) return true;
  if (/\b(?:want|need)\b.*\bdetails?\b/i.test(t)) return true;
  if (/\bdetails?\b.*\b(?:the|this)\s+project\b/i.test(t)) return true;
  if (/\b(?:the|this)\s+project(?:'s)?\s+details?\b/i.test(t)) return true;
  if (/\b(?:breakdown|break[- ]?up|landed cost|all[- ]in)\b/i.test(t)) return true;
  // SA-1: size/config Q&A on focused project — not a propertyType search pivot
  if (/\b(?:plot\s+sizes?|unit\s+sizes?|unit\s+configurations?|configurations?|sizes?\s+offered|bhk options?)\b/i.test(t)) {
    return true;
  }
  return (
    /\b(?:is this|are these|what (?:type|kind)|apartment or|plot or|villa or|legal status|rera status|possession date)\b/i.test(
      t,
    ) ||
    /\b(?:tell me about|what about|how (?:is|are)|does (?:it|this)|do they)\b/i.test(t)
  );
}

/** Buyer pivots search while focused — not a project Q&A turn. */
export function isFocusedSearchPivot(text: string): boolean {
  const t = text.trim();
  if (!t || isFocusedProjectQuestion(t)) return false;
  // SA-1: chip-canonical resolve wins — answer/compare/visit are not pivots
  const resolved = classifySpeechAct({ text: t });
  if (resolved.primary && isNonSearchSpeechAct(resolved.speechAct)) return false;
  if (detectTopics(t).length > 0) return false;
  if (EXPLORE_MORE_RE.test(t)) return true;
  if (isLocationBroadenTurn(t)) return true;
  if (extractLocation(t)) return true;
  if (detectPropertyTypes(t)) return true;
  if (parseBudgetToInr(t)) return true;
  if (/\b(?:also|too|as well)\b/i.test(t) && /\b(?:plantation|villa|apartment|plot|bhk|budget|area|location|type)\b/i.test(t)) {
    return true;
  }
  if (/^[A-Za-z][A-Za-z\s]{2,28}\s+projects?\b/i.test(t) && !/\b(?:want|tell|details?|about|give|show|the|this|my|need)\b/i.test(t)) {
    return true;
  }
  if (/\b(?:looking|searching|interested)\s+(?:in|for)\s+[A-Za-z]/i.test(t)) return true;
  if (/\b(?:change|switch|update)\s+(?:my\s+)?(?:area|location|budget|bhk|property type)\b/i.test(t)) return true;
  return false;
}

function constraintPatchFromPivot(text: string): {
  patch: Partial<Constraints>;
  patch_clear: PatchClearKey[];
} {
  const patch: Partial<Constraints> = {};
  const patch_clear: PatchClearKey[] = [];

  const budget = parseBudgetToInr(text);
  if (budget) {
    patch.budgetMaxInr = budget.max;
    if (budget.min !== undefined) patch.budgetMinInr = budget.min;
  }

  const loc = extractLocation(text);
  if (loc) patch.location = loc;

  const ptype = detectPropertyTypes(text);
  if (ptype) patch.propertyType = ptype;

  const bhkMatch = /\b(\d(?:\.\d)?\s*bhk)\b/i.exec(text);
  if (bhkMatch?.[1]) {
    patch.bhk = bhkMatch[1].replace(/\s+/g, ' ').replace(/\bbhk\b/i, 'BHK');
  }

  if (/\bopen to any area\b/i.test(text)) patch_clear.push('location');
  if (/\b(?:any|open)\b/i.test(text) && /\b(?:config|bhk|configuration)\b/i.test(text)) {
    patch_clear.push('bhk');
  }

  return { patch, patch_clear };
}

function constraintsChanged(
  before: Constraints,
  patch: Partial<Constraints>,
  patch_clear: readonly PatchClearKey[],
): boolean {
  if (patch_clear.length > 0) return true;
  if (patch.location && patch.location.toLowerCase() !== (before.location ?? '').toLowerCase()) return true;
  if (patch.propertyType && patch.propertyType !== before.propertyType) return true;
  if (patch.bhk && patch.bhk !== before.bhk) return true;
  if (patch.budgetMaxInr !== undefined && patch.budgetMaxInr !== before.budgetMaxInr) return true;
  return false;
}

/** Rule classify for focused-phase search pivots (RTI-B). */
export function classifyFocusedPivot(input: TurnIntentInput): TurnIntentResult | null {
  if (input.phase !== 'focused') return null;
  const t = input.text.trim();
  if (!isFocusedSearchPivot(t)) return null;

  const { patch, patch_clear } = constraintPatchFromPivot(t);
  const changed = constraintsChanged(input.constraints, patch, patch_clear);

  if (changed) {
    return {
      kind: 'broaden_constraints',
      confidence: 'extractor',
      ...(Object.keys(patch).length ? { patch } : {}),
      ...(patch_clear.length ? { patch_clear } : {}),
    };
  }

  return { kind: 'release_focus', confidence: 'rule' };
}

export function shouldRunFocusedTurnIntent(
  state: import('../types.js').ConversationState,
  text: string,
  actionId?: string,
): boolean {
  if (actionId) return false;
  if (state.phase !== 'focused') return false;
  return isFocusedSearchPivot(text.trim());
}
