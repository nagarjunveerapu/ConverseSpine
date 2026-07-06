import { formatInr } from './compose.js';
import { searchFilters } from './phases/discover.js';
import type { CatalogEnvelope, Constraints, SearchFilters } from './types.js';

export type RecoveryVariant = 'zero_match' | 'widen';

export type AdvisorUiMode =
  | 'brief_collect'
  | 'search_recovery'
  | 'preference_refine'
  | 'matches_hub'
  | 'focused';

function briefPropertyTypeLabel(projectType: string): string {
  const lc = projectType.toLowerCase();
  if (lc === 'apartment') return 'Apartment';
  if (lc === 'villa' || lc === 'managed_villa_resort') return 'Villa';
  if (lc === 'plot' || lc === 'plotted') return 'Plot / land';
  if (lc.includes('plantation')) return 'Planted estate';
  return projectType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface SuggestedAction {
  id: string;
  label: string;
  patch: Record<string, string | undefined>;
  user_line: string;
  expected_matches: number;
}

export interface SearchRecoveryEnvelope {
  mode: 'search_recovery' | 'preference_refine';
  reason: string;
  constraints: Record<string, string | undefined>;
  suggested_actions: SuggestedAction[];
}

export interface RecoveryPlannerDeps {
  searchCount(filters: SearchFilters): Promise<number>;
  catalog: CatalogEnvelope;
  constraints: Constraints;
  reason: string;
  maxActions: number;
  variant: RecoveryVariant;
}

export function constraintsSnapshot(c: Constraints): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  if (c.location) out.location = c.location;
  if (c.bhk) out.bhk = c.bhk;
  if (c.propertyType) out.property_type = c.propertyType;
  if (c.purpose) out.purpose = c.purpose;
  if (c.budgetMaxInr) out.budget = formatInr(c.budgetMaxInr);
  return out;
}

function mergeConstraints(base: Constraints, patch: Partial<Constraints>): Constraints {
  const next = { ...base, ...patch };
  if (patch.location === '') delete next.location;
  return next;
}

function truncateLabel(label: string, max = 20): string {
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
}

async function tryAction(
  deps: RecoveryPlannerDeps,
  id: string,
  label: string,
  merged: Constraints,
  patch: Record<string, string | undefined>,
  userLine: string,
): Promise<SuggestedAction | null> {
  const count = await deps.searchCount(searchFilters(merged));
  if (count <= 0) return null;
  return {
    id,
    label: truncateLabel(label),
    patch,
    user_line: userLine,
    expected_matches: count,
  };
}

/** Rank catalog-backed relaxations; only return actions that preflight to ≥1 match. */
export async function planSearchRecovery(deps: RecoveryPlannerDeps): Promise<SearchRecoveryEnvelope> {
  const actions: SuggestedAction[] = [];
  const seen = new Set<string>();
  const c = deps.constraints;
  const mode = deps.variant === 'zero_match' ? 'search_recovery' : 'preference_refine';

  const push = async (
    id: string,
    label: string,
    merged: Constraints,
    patch: Record<string, string | undefined>,
    userLine: string,
  ) => {
    if (actions.length >= deps.maxActions || seen.has(id)) return;
    const action = await tryAction(deps, id, label, merged, patch, userLine);
    if (!action) return;
    seen.add(id);
    actions.push(action);
  };

  const currentLoc = (c.location ?? '').toLowerCase();
  const currentType = (c.propertyType ?? '').toLowerCase();

  // 1 — Property-type pivot at same location (zero_match only)
  if (deps.variant === 'zero_match' && c.location && c.propertyType) {
    for (const slug of deps.catalog.projectTypes) {
      const label = briefPropertyTypeLabel(slug);
      if (currentType.includes(label.toLowerCase())) continue;
      const merged = mergeConstraints(c, { propertyType: label });
      await push(
        `relax_type:${slug}`,
        `Try ${label} in ${c.location}`,
        merged,
        { property_type: label, location: c.location },
        `Show me ${label} projects in ${c.location}`,
      );
      if (actions.length >= deps.maxActions) break;
    }
  }

  // 2 — Alternate micro-markets (keep budget + type)
  for (const market of deps.catalog.microMarkets) {
    if (actions.length >= deps.maxActions) break;
    if (!market || market.toLowerCase() === currentLoc) continue;
    if (currentLoc && market.toLowerCase().includes(currentLoc)) continue;
    const merged = mergeConstraints(c, { location: market });
    await push(
      `relax_location:${market}`,
      `Try ${market.split('/')[0]?.trim() ?? market}`,
      merged,
      { location: market, ...(c.budgetMaxInr ? { budget: formatInr(c.budgetMaxInr) } : {}) },
      `Show me projects in ${market}`,
    );
  }

  // 3 — Budget widen (~25%)
  if (c.budgetMaxInr && actions.length < deps.maxActions) {
    const bumped = Math.round(c.budgetMaxInr * 1.25);
    const display = formatInr(bumped);
    const merged = mergeConstraints(c, { budgetMaxInr: bumped, budgetMinInr: c.budgetMinInr });
    await push(
      `relax_budget:${bumped}`,
      `Budget up to ${display}`,
      merged,
      { budget: display, ...(c.location ? { location: c.location } : {}) },
      `Show me projects with budget up to ${display}`,
    );
  }

  // 4 — Open to any area
  if (c.location && actions.length < deps.maxActions) {
    const merged = mergeConstraints(c, { location: '' });
    await push(
      'relax_location:open',
      'Open to any area',
      merged,
      { location: 'Open to suggestions', ...(c.budgetMaxInr ? { budget: formatInr(c.budgetMaxInr) } : {}) },
      'Show me projects — open to any area',
    );
  }

  // 5 — Drop BHK filter if present
  if (c.bhk && actions.length < deps.maxActions) {
    const merged = mergeConstraints(c, { bhk: undefined });
    delete merged.bhk;
    await push(
      'relax_bhk:drop',
      'Any configuration',
      merged,
      {
        ...(c.location ? { location: c.location } : {}),
        ...(c.budgetMaxInr ? { budget: formatInr(c.budgetMaxInr) } : {}),
        bhk: '',
      },
      'Show me projects with any BHK configuration',
    );
  }

  return {
    mode,
    reason: deps.reason,
    constraints: constraintsSnapshot(c),
    suggested_actions: actions,
  };
}

/** Map advisor preference patch from a suggested action id + patch. */
export function patchFromSuggestedAction(
  patch: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === '') continue;
    out[k] = v;
  }
  return out;
}
