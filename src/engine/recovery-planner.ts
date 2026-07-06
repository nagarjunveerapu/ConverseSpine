import { formatInr } from './compose.js';
import { searchFilters } from './phases/discover.js';
import type { CatalogEnvelope, Constraints, SearchFilters } from './types.js';

export type RecoveryVariant = 'zero_match' | 'widen';

/** What blocked the search — drives chip ordering. */
export type RecoveryHint = 'property_type' | 'budget' | 'location' | 'constraint' | 'general';

export type AdvisorUiMode =
  | 'brief_collect'
  | 'search_recovery'
  | 'preference_refine'
  | 'matches_hub'
  | 'focused';

export function briefPropertyTypeLabel(projectType: string): string {
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
  hint?: RecoveryHint;
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

function truncateLabel(label: string, max = 22): string {
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
}

function isBangaloreMicroMarket(loc: string): boolean {
  return /\b(?:bangalore|bengaluru|devanahalli|whitefield|sarjapur|electronic city|north bangalore|aerospace|hebbal|yelahanka)\b/i.test(
    loc,
  );
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

type PushFn = (
  push: (
    id: string,
    label: string,
    merged: Constraints,
    patch: Record<string, string | undefined>,
    userLine: string,
  ) => Promise<void>,
  ctx: {
    c: Constraints;
    currentLoc: string;
    currentType: string;
    variant: RecoveryVariant;
    catalog: CatalogEnvelope;
    budgetPatch: () => Record<string, string | undefined>;
  },
) => Promise<void>;

const pushTypeSameLocation: PushFn = async (push, { c, currentType, variant, catalog }) => {
  if (variant !== 'zero_match' || !c.location || !c.propertyType) return;
  for (const slug of catalog.projectTypes) {
    const label = briefPropertyTypeLabel(slug);
    if (currentType.includes(label.toLowerCase())) continue;
    const merged = mergeConstraints(c, { propertyType: label });
    await push(
      `relax_type:${slug}`,
      `Switch to ${label}`,
      merged,
      { property_type: label, location: c.location },
      `Show me ${label} projects in ${c.location}`,
    );
  }
};

const pushTypeBroadArea: PushFn = async (push, { c, currentType, variant, catalog, budgetPatch }) => {
  if (variant !== 'zero_match' || !c.propertyType) return;
  for (const slug of catalog.projectTypes) {
    const label = briefPropertyTypeLabel(slug);
    if (currentType.includes(label.toLowerCase())) continue;
    const merged = mergeConstraints(c, { propertyType: label, location: '' });
    await push(
      `relax_type_broad:${slug}`,
      `Try ${label} (any area)`,
      merged,
      { property_type: label, location: 'Open to suggestions', ...budgetPatch() },
      `Show me ${label} projects — open to any area`,
    );
  }
};

const pushBangaloreBroad: PushFn = async (push, { c, budgetPatch }) => {
  if (!c.location || !isBangaloreMicroMarket(c.location)) return;
  const merged = mergeConstraints(c, { location: 'Bangalore' });
  await push(
    'relax_location:bangalore',
    'Search all Bangalore',
    merged,
    { location: 'Bangalore', ...budgetPatch() },
    'Show me projects in Bangalore',
  );
};

const pushAlternateMarkets: PushFn = async (push, { c, currentLoc, catalog, budgetPatch }) => {
  for (const market of catalog.microMarkets) {
    if (!market || market.toLowerCase() === currentLoc) continue;
    if (currentLoc && market.toLowerCase().includes(currentLoc)) continue;
    const merged = mergeConstraints(c, { location: market });
    await push(
      `relax_location:${market}`,
      `Try ${market.split('/')[0]?.trim() ?? market}`,
      merged,
      { location: market, ...budgetPatch() },
      `Show me projects in ${market}`,
    );
  }
};

const pushBudgetWiden: PushFn = async (push, { c, budgetPatch }) => {
  if (!c.budgetMaxInr) return;
  for (const mult of [1.25, 1.5, 2, 3, 5, 10]) {
    const bumped = Math.round(c.budgetMaxInr! * mult);
    if (bumped <= c.budgetMaxInr!) continue;
    const display = formatInr(bumped);
    const merged = mergeConstraints(c, { budgetMaxInr: bumped, budgetMinInr: c.budgetMinInr });
    await push(
      `relax_budget:${bumped}`,
      `Budget up to ${display}`,
      merged,
      { budget: display, ...(c.location ? { location: c.location } : {}) },
      `Show me projects with budget up to ${display}`,
    );
    break;
  }
};

const pushOpenArea: PushFn = async (push, { c, budgetPatch }) => {
  if (!c.location) return;
  const merged = mergeConstraints(c, { location: '' });
  await push(
    'relax_location:open',
    'Open to any area',
    merged,
    { location: 'Open to suggestions', ...budgetPatch() },
    'Show me projects — open to any area',
  );
};

const pushDropBhk: PushFn = async (push, { c, budgetPatch }) => {
  if (!c.bhk) return;
  const merged = mergeConstraints(c, { bhk: undefined });
  delete merged.bhk;
  await push(
    'relax_bhk:drop',
    'Any configuration',
    merged,
    {
      ...(c.location ? { location: c.location } : {}),
      ...budgetPatch(),
      bhk: '',
    },
    'Show me projects with any BHK configuration',
  );
};

const pushClearPropertyType: PushFn = async (push, { c, budgetPatch }) => {
  if (!c.propertyType) return;
  const merged = mergeConstraints(c, { propertyType: undefined });
  delete merged.propertyType;
  await push(
    'relax_type:open',
    'Any property type',
    merged,
    {
      ...(c.location ? { location: c.location } : {}),
      ...budgetPatch(),
      property_type: '',
    },
    'Show me projects — any property type',
  );
};

function strategyOrder(hint: RecoveryHint): PushFn[] {
  switch (hint) {
    case 'property_type':
      return [
        pushTypeSameLocation,
        pushTypeBroadArea,
        pushBangaloreBroad,
        pushClearPropertyType,
        pushAlternateMarkets,
        pushBudgetWiden,
        pushOpenArea,
        pushDropBhk,
      ];
    case 'budget':
      return [
        pushBudgetWiden,
        pushTypeBroadArea,
        pushBangaloreBroad,
        pushAlternateMarkets,
        pushOpenArea,
        pushDropBhk,
      ];
    case 'location':
      return [
        pushBangaloreBroad,
        pushAlternateMarkets,
        pushOpenArea,
        pushTypeBroadArea,
        pushBudgetWiden,
        pushDropBhk,
      ];
    case 'constraint':
      return [
        pushDropBhk,
        pushTypeBroadArea,
        pushBudgetWiden,
        pushBangaloreBroad,
        pushAlternateMarkets,
        pushOpenArea,
      ];
    default:
      return [
        pushTypeSameLocation,
        pushTypeBroadArea,
        pushBangaloreBroad,
        pushAlternateMarkets,
        pushBudgetWiden,
        pushOpenArea,
        pushClearPropertyType,
        pushDropBhk,
      ];
  }
}

/** Rank catalog-backed relaxations; only return actions that preflight to ≥1 match. */
export async function planSearchRecovery(deps: RecoveryPlannerDeps): Promise<SearchRecoveryEnvelope> {
  const actions: SuggestedAction[] = [];
  const seen = new Set<string>();
  const c = deps.constraints;
  const mode = deps.variant === 'zero_match' ? 'search_recovery' : 'preference_refine';
  const hint = deps.hint ?? 'general';

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
  const budgetPatch = (): Record<string, string | undefined> =>
    c.budgetMaxInr ? { budget: formatInr(c.budgetMaxInr) } : {};

  const ctx = {
    c,
    currentLoc,
    currentType,
    variant: deps.variant,
    catalog: deps.catalog,
    budgetPatch,
  };

  for (const strategy of strategyOrder(hint)) {
    if (actions.length >= deps.maxActions) break;
    await strategy(push, ctx);
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
