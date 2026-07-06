import { parseBudgetToInr } from '../facts.js';
import type { Constraints } from '../types.js';
import type { PatchClearKey, TurnIntentInput, TurnIntentResult } from './types.js';

/** Deterministic recovery free-text → constraint patch (RTI-2). */
export function extractRecoveryPatchFromText(
  text: string,
  uiMode: TurnIntentInput['ui_mode'],
): TurnIntentResult | null {
  if (uiMode !== 'search_recovery' && uiMode !== 'preference_refine') return null;

  const patch: Partial<Constraints> = {};
  const patch_clear: PatchClearKey[] = [];
  let hasPatch = false;

  const budget = parseBudgetToInr(text);
  if (budget) {
    patch.budgetMaxInr = budget.max;
    if (budget.min !== undefined) patch.budgetMinInr = budget.min;
    hasPatch = true;
  }

  if (/\bapartments?\b|\bflats?\b/i.test(text)) {
    patch.propertyType = 'Apartment';
    hasPatch = true;
  } else if (/\bvillas?\b/i.test(text)) {
    patch.propertyType = 'Villa';
    hasPatch = true;
  } else if (/\b(?:plot|land|plantation|planted)\b/i.test(text)) {
    patch.propertyType = 'Planted estate';
    hasPatch = true;
  }

  const bhkMatch = /\b(\d(?:\.\d)?\s*bhk)\b/i.exec(text);
  if (bhkMatch?.[1]) {
    patch.bhk = bhkMatch[1].replace(/\s+/g, ' ').replace(/\bbhk\b/i, 'BHK');
    hasPatch = true;
  }

  if (
    /\b(?:any|open)\b/i.test(text) &&
    (/\b(?:config|bhk|configuration)\b/i.test(text) || /\b(?:apartment|villa|flat)s?\b/i.test(text))
  ) {
    patch_clear.push('bhk');
    hasPatch = true;
  }

  if (/\bopen to any area\b/i.test(text)) {
    patch_clear.push('location');
    hasPatch = true;
  }

  if (!hasPatch) return null;
  return {
    kind: 'apply_recovery_patch',
    confidence: 'extractor',
    patch,
    ...(patch_clear.length ? { patch_clear } : {}),
  };
}
