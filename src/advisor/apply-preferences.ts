import { parseBudgetToInr } from '../engine/facts.js';
import type { IngressSlotKey } from '../engine/ingress.js';
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
  if (propertyType && propertyType.toLowerCase() !== 'open to suggestions') {
    out.propertyType = propertyType;
  }

  const purpose = prefs.purpose?.trim().toLowerCase();
  if (purpose === 'investment') out.purpose = 'investment';
  else if (purpose === 'self_use' || purpose === 'self-use') out.purpose = 'self_use';

  // Trade-off Advisor: worries are the understanding half of the brief. They
  // bump ranking weights (advisor-weights.ts) and can derive the priority so
  // the bot asks less when it already knows.
  const worriesRaw = prefs.worries?.trim();
  if (worriesRaw) {
    const worries = worriesRaw
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    if (worries.length) {
      out.worries = worries;
      if (worries.some((w) => w.includes('school'))) out.schoolsMentioned = true;
    }
  }

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
  if ('property_type' in prefs) {
    const pt = prefs.property_type?.trim();
    if (!pt || pt.toLowerCase() === 'open to suggestions') {
      delete next.propertyType;
    }
  }

  return next;
}

/** Slots explicitly set by advisor preferences this turn — extract must not re-parse them. */
export function ingressFilledSlotsFromPreferences(
  prefs: Record<string, string | undefined>,
): IngressSlotKey[] {
  const slots: IngressSlotKey[] = [];
  const loc = prefs.location?.trim();
  if (loc && loc.toLowerCase() !== 'open to suggestions') slots.push('location');
  if (prefs.budget?.trim()) slots.push('budget');
  if (prefs.bhk?.trim()) slots.push('bhk');
  const pt = prefs.property_type?.trim();
  if (pt && pt.toLowerCase() !== 'open to suggestions') slots.push('propertyType');
  if (prefs.purpose?.trim()) slots.push('purpose');
  return slots;
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
