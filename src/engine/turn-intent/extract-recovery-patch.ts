import { detectPropertyTypes, extractLocation, parseBudgetToInr } from '../facts.js';
import { briefPropertyTypeLabel } from '../recovery-planner.js';
import type { Constraints } from '../types.js';
import type { PatchClearKey, TurnIntentInput, TurnIntentResult } from './types.js';

function constraintPropertyType(raw: string): string {
  const lc = raw.toLowerCase();
  if (lc.includes('plantation') || lc.includes('planted')) return 'Planted estate';
  if (lc.includes('apartment') || lc.includes('flat')) return 'Apartment';
  if (lc.includes('villa')) return 'Villa';
  if (lc.includes('plot') || lc.includes('land')) return 'Plot / land';
  return briefPropertyTypeLabel(raw);
}

function extractBroaderLocationIntent(text: string): string | undefined {
  const t = text.trim();
  if (/\b(?:broader|wider|anywhere in|all of|expand(?: to)?|across)\b/i.test(t) && /\b(?:bangalore|bengaluru)\b/i.test(t)) {
    return 'Bangalore';
  }
  if (/^(?:in\s+)?(?:bangalore|bengaluru)\s*\.?\s*$/i.test(t)) return 'Bangalore';
  if (/^bangalore\s+projects?\b/i.test(t)) return 'Bangalore';
  return undefined;
}

function extractPropertyTypeSwitch(text: string): string | undefined {
  const switchMatch =
    /\b(?:switch|change|swap|move)\s+(?:to\s+)?(?:a\s+|an\s+)?(apartments?|villas?|plots?|flats?|plantation|planted estate)\b/i.exec(
      text,
    );
  if (switchMatch?.[1]) return constraintPropertyType(switchMatch[1]);

  const insteadMatch =
    /\b(?:apartments?|villas?|plots?|flats?|plantation)\s+instead(?:\s+of\s+(?:villas?|apartments?|plots?))?\b/i.exec(
      text,
    );
  if (insteadMatch?.[1]) return constraintPropertyType(insteadMatch[1]);

  const tryMatch = /\btry\s+(apartments?|villas?|plots?|flats?|plantation)\b/i.exec(text);
  if (tryMatch?.[1]) return constraintPropertyType(tryMatch[1]);

  const detected = detectPropertyTypes(text);
  if (!detected) return undefined;

  const t = text.trim();
  const isShortTypeMention = t.split(/\s+/).length <= 5;
  const hasSwitchCue =
    /\b(?:switch|change|try|want|prefer|instead|rather|only|just|show|looking for)\b/i.test(t) ||
    isShortTypeMention;
  if (!hasSwitchCue) return undefined;

  return constraintPropertyType(detected.split(',')[0]!);
}

/** Deterministic recovery free-text → constraint patch (RTI-2/RTI-C). */
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

  const loc = extractBroaderLocationIntent(text) ?? extractLocation(text);
  if (loc) {
    patch.location = loc;
    hasPatch = true;
  }

  const typeSwitch = extractPropertyTypeSwitch(text);
  if (typeSwitch) {
    patch.propertyType = typeSwitch;
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

  if (/\b(?:open to any|any)\s+(?:property\s+)?type\b/i.test(text)) {
    patch_clear.push('propertyType');
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
