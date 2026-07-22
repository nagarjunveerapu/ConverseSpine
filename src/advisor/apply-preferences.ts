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
  if (bhk) {
    out.bhk = bhk;
    // The buyer's asked size rides inside their own config words
    // ("Quarter-Acre Plot (10,000 sqft)") — a numeric-unit parse, so the
    // Desk budget dimension can price THEIR unit. Nothing domain-specific:
    // any "<number> sqft" in the config string counts; none → no ask.
    const size = parseAskSizeSqft(bhk);
    if (size) out.askSizeSqft = size;
  }

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
  // Deepening answers from the advisor brief (decline chips never arrive —
  // the SPA filters them). Both feed the Desk re-rank via advisor-weights.
  const hub = prefs.commute_hub?.trim();
  if (hub) {
    // An explicit decline is a signal too — it zeroes the commute weight
    // and blocks the priority probe; it is never a hub name.
    if (/\b(not|no)[ -]?commute/i.test(hub)) out.commuteDeclined = true;
    else out.commuteHub = hub;
  }
  const sch = prefs.schools?.trim().toLowerCase();
  if (sch && !/^(not|no|skip)/.test(sch)) out.schoolsMentioned = true;

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

/** First "<number> sqft" in a config string → sqft as a number, else null.
 *  Accepts Indian-formatted digits ("10,000 sqft", "1200 sq ft"). */
export function parseAskSizeSqft(raw: string): number | null {
  const m = /([\d][\d,]*)\s*(?:sq\.?\s*\.?\s*ft|sqft|sq\s*feet)/i.exec(raw);
  if (!m || !m[1]) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
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

/**
 * Fields whose value actually changed vs the last-applied client brief.
 * The SPA re-sends the WHOLE brief on every turn; in recovery only fields the
 * buyer just edited may overwrite server-side constraints. This keeps the
 * RTI-2.1 protection (stale re-sent fields never clobber recovery edits) while
 * ending the wholesale skip that swallowed fresh edits mid-recovery.
 */
export function advisorPrefsDelta(
  snapshot: Record<string, string> | undefined,
  prefs: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(prefs)) {
    if ((snapshot?.[k] ?? '') !== (v?.trim() ?? '')) out[k] = v;
  }
  return out;
}

/** Normalized (trimmed) snapshot of the client brief, merged over the prior one. */
export function advisorPrefsSnapshot(
  prefs: Record<string, string | undefined>,
  prior?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...(prior ?? {}) };
  for (const [k, v] of Object.entries(prefs)) out[k] = v?.trim() ?? '';
  return out;
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
