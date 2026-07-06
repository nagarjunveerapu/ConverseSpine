import { parseBudgetToInr } from '../engine/facts.js';
import type { PatchClearKey } from '../engine/turn-intent/types.js';
import type { Constraints } from '../engine/types.js';

/** Deterministic brief → search constraints (advisor UI is source of truth). */
export function constraintsFromAdvisorPreferences(
  prefs: Record<string, string | undefined>,
): Partial<Constraints> {
  const out: Partial<Constraints> = {};

  const loc = prefs.location?.trim();
  if (loc && loc.toLowerCase() !== 'open to suggestions') {
    out.location = loc;
  }

  const budgetRaw = prefs.budget?.trim();
  if (budgetRaw) {
    const b = parseBudgetToInr(budgetRaw);
    if (b) {
      out.budgetMaxInr = b.max;
      if (b.min !== undefined) out.budgetMinInr = b.min;
    }
  }

  const bhk = prefs.bhk?.trim();
  if (bhk) out.bhk = bhk;

  const propertyType = prefs.property_type?.trim();
  if (propertyType) out.propertyType = propertyType;

  const purpose = prefs.purpose?.trim().toLowerCase();
  if (purpose === 'investment') out.purpose = 'investment';
  else if (purpose === 'self_use' || purpose === 'self-use') out.purpose = 'self_use';

  return out;
}

export function mergeAdvisorPreferences(
  constraints: Constraints,
  prefs: Record<string, string | undefined>,
): Constraints {
  const next: Constraints = { ...constraints, ...constraintsFromAdvisorPreferences(prefs) };

  // Explicit clears from recovery chips — omitted keys must not leave stale constraints.
  if ('bhk' in prefs && !prefs.bhk?.trim()) {
    delete next.bhk;
  }
  if ('location' in prefs) {
    const loc = prefs.location?.trim();
    if (!loc || loc.toLowerCase() === 'open to suggestions') {
      delete next.location;
    }
  }
  if ('property_type' in prefs && !prefs.property_type?.trim()) {
    delete next.propertyType;
  }

  return next;
}

/** Keys explicitly cleared by advisor preferences patch this turn. */
export function preferenceClearsFromPatch(
  prefs: Record<string, string | undefined>,
): PatchClearKey[] {
  const clears: PatchClearKey[] = [];
  if ('bhk' in prefs && !prefs.bhk?.trim()) clears.push('bhk');
  if ('location' in prefs) {
    const loc = prefs.location?.trim();
    if (!loc || loc.toLowerCase() === 'open to suggestions') clears.push('location');
  }
  if ('property_type' in prefs && !prefs.property_type?.trim()) clears.push('propertyType');
  return clears;
}
