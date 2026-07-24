/**
 * Empty-locality recovery — show nearby / in-city inventory with disclosure.
 * Does not mutate the durable brief; callers attach relaxed:['area'] + localityWiden.
 */
import { haversineKm } from './geo.js';
import type { Match, SearchFilters } from './types.js';

export type LocalityWidenHit = {
  matches: Match[];
  nearbyAreas: string[];
};

export type LocalityWidenPorts = {
  geoAreasInRegion(
    region: string,
    builderId: string,
  ): Promise<Array<{ name: string; distanceKm: number }>>;
  resolveGeo(text: string): Promise<{ lat: number; lng: number } | null>;
  projectCoords(
    builderId: string,
  ): Promise<ReadonlyArray<{ projectId: string; lat: number; lng: number; microMarket?: string }>>;
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

function rankByAskDistance(
  matches: Match[],
  ask: { lat: number; lng: number },
  coords: ReadonlyArray<{ projectId: string; lat: number; lng: number }>,
): Match[] {
  const byId = new Map(coords.map((c) => [c.projectId, c]));
  return [...matches].sort((a, b) => {
    const ca = byId.get(a.projectId);
    const cb = byId.get(b.projectId);
    const da = ca ? haversineKm(ask.lat, ask.lng, ca.lat, ca.lng) : Number.POSITIVE_INFINITY;
    const db = cb ? haversineKm(ask.lat, ask.lng, cb.lat, cb.lng) : Number.POSITIVE_INFINITY;
    return da - db;
  });
}

/**
 * After an empty recognized locality: pull nearby served areas (Desk LI),
 * search those first; else city-wide under remaining filters, nearest-first.
 */
export async function searchLocalityWiden(
  input: {
    asked: string;
    builderId: string;
    filters: SearchFilters;
    rejectedProjectIds: readonly string[];
    ports: LocalityWidenPorts;
    max?: number;
  },
): Promise<LocalityWidenHit | null> {
  const asked = input.asked.trim();
  if (!asked) return null;
  const max = input.max ?? 3;

  const areas = await input.ports.geoAreasInRegion(asked, input.builderId).catch(() => []);
  const nearbyAreas = areas
    .map((a) => a.name.trim())
    .filter((n) => n && !samePlace(n, asked))
    .slice(0, 6);

  const rejected = new Set(input.rejectedProjectIds);
  const take = (rows: Match[]) =>
    rows.filter((m) => !rejected.has(m.projectId)).slice(0, max);

  const base = recoveryFilters(input.filters);

  if (nearbyAreas.length) {
    const resp = await input.ports
      .search(input.builderId, {
        ...base,
        locations: nearbyAreas.join(','),
      })
      .catch(() => ({ matches: [] as Match[] }));
    const hits = take(resp.matches ?? []);
    if (hits.length) return { matches: hits, nearbyAreas };
  }

  const broad = await input.ports
    .search(input.builderId, base)
    .catch(() => ({ matches: [] as Match[] }));
  let hits = take(broad.matches ?? []);
  if (!hits.length) return null;

  const [askGeo, coords] = await Promise.all([
    input.ports.resolveGeo(asked).catch(() => null),
    input.ports.projectCoords(input.builderId).catch(() => []),
  ]);
  if (askGeo && coords.length) {
    hits = rankByAskDistance(hits, askGeo, coords).slice(0, max);
  }

  return { matches: hits, nearbyAreas };
}
