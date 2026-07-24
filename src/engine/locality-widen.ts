/**
 * Empty-locality recovery inside served geography.
 *
 * Only widens when Desk LI returns nearby areas that intersect the builder
 * catalog. No catalog-wide fallback — that wrongly turns Delhi into a
 * Bangalore project dump.
 */
import type { Match, SearchFilters } from './types.js';
import { matchServedMarket } from './coverage-areas.js';

export type LocalityWidenHit = {
  matches: Match[];
  /** Served market labels for buyer copy (never project names). */
  nearbyAreas: string[];
};

export type LocalityWidenPorts = {
  geoAreasInRegion(
    region: string,
    builderId: string,
  ): Promise<Array<{ name: string; distanceKm: number }>>;
  search(
    builderId: string,
    filters: SearchFilters,
  ): Promise<{ matches: Match[] }>;
};

function samePlace(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Recovery search: drop locality + advisor re-rank knobs that can zero a widen. */
function recoveryFilters(filters: SearchFilters): SearchFilters {
  const {
    locations: _loc,
    conversationId: _cid,
    preferenceWeights: _pw,
    commuteHub: _hub,
    budgetTargetInr: _bt,
    askSizeSqft: _sz,
    ...rest
  } = filters;
  return { ...rest, maxResults: filters.maxResults ?? 5 };
}

/**
 * Nearby served markets for an empty locality ask.
 * Null when LI finds nothing in our catalog (treat as outside-served).
 */
export async function searchLocalityWiden(
  input: {
    asked: string;
    builderId: string;
    filters: SearchFilters;
    rejectedProjectIds: readonly string[];
    /** Live catalog micro-markets — LI hits must intersect these. */
    catalogMarkets: readonly string[];
    ports: LocalityWidenPorts;
    max?: number;
  },
): Promise<LocalityWidenHit | null> {
  const asked = input.asked.trim();
  if (!asked || !input.catalogMarkets.length) return null;
  const max = input.max ?? 3;

  const areas = await input.ports.geoAreasInRegion(asked, input.builderId).catch(() => []);
  const nearbyAreas: string[] = [];
  for (const a of areas) {
    const name = a.name.trim();
    if (!name || samePlace(name, asked)) continue;
    const hit = matchServedMarket(name, input.catalogMarkets);
    if (!hit || hit.score < 2) continue; // declared/containment only — not weak typo
    if (nearbyAreas.some((n) => samePlace(n, hit.name))) continue;
    nearbyAreas.push(hit.name);
    if (nearbyAreas.length >= 4) break;
  }
  if (!nearbyAreas.length) return null;

  const rejected = new Set(input.rejectedProjectIds);
  const resp = await input.ports
    .search(input.builderId, {
      ...recoveryFilters(input.filters),
      locations: nearbyAreas.join(','),
    })
    .catch(() => ({ matches: [] as Match[] }));
  const matches = (resp.matches ?? [])
    .filter((m) => !rejected.has(m.projectId))
    .slice(0, max);
  if (!matches.length) return null;

  return { matches, nearbyAreas };
}
