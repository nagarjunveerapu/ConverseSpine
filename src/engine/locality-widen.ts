/**
 * Empty-locality recovery inside served geography.
 *
 * Widen only when the ask is near our inventory (LI ∩ catalog, or ask coords
 * within NEAR_KM of a served market). Far asks (Delhi vs Bangalore stock) get
 * null → city inventory copy. Never catalog-wide dump.
 */
import { haversineKm } from './geo.js';
import type { Match, SearchFilters } from './types.js';
import { matchServedMarket } from './coverage-areas.js';

/** Same-city empty locality — ask near a served market centroid. */
const NEAR_KM = 80;

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

function primaryMarket(raw: string): string {
  return (raw.split(/\s*\/\s*/)[0] ?? raw).trim();
}

function marketCentroids(
  coords: ReadonlyArray<{ lat: number; lng: number; microMarket?: string }>,
): Array<{ name: string; lat: number; lng: number }> {
  const bags = new Map<string, { lat: number; lng: number; n: number; name: string }>();
  for (const c of coords) {
    const name = primaryMarket(c.microMarket ?? '');
    if (!name) continue;
    const key = name.toLowerCase();
    const prev = bags.get(key);
    if (prev) {
      prev.lat += c.lat;
      prev.lng += c.lng;
      prev.n += 1;
    } else {
      bags.set(key, { lat: c.lat, lng: c.lng, n: 1, name });
    }
  }
  return [...bags.values()].map((b) => ({
    name: b.name,
    lat: b.lat / b.n,
    lng: b.lng / b.n,
  }));
}

async function marketsFromLi(
  asked: string,
  builderId: string,
  catalogMarkets: readonly string[],
  ports: LocalityWidenPorts,
): Promise<string[]> {
  const areas = await ports.geoAreasInRegion(asked, builderId).catch(() => []);
  const out: string[] = [];
  for (const a of areas) {
    const name = a.name.trim();
    if (!name || samePlace(name, asked)) continue;
    const hit = matchServedMarket(name, catalogMarkets);
    if (!hit || hit.score < 2) continue;
    if (out.some((n) => samePlace(n, hit.name))) continue;
    out.push(hit.name);
    if (out.length >= 4) break;
  }
  return out;
}

async function marketsNearAsk(
  asked: string,
  builderId: string,
  ports: LocalityWidenPorts,
): Promise<string[]> {
  const [askGeo, coords] = await Promise.all([
    ports.resolveGeo(asked).catch(() => null),
    ports.projectCoords(builderId).catch(() => []),
  ]);
  if (!askGeo || !coords.length) return [];
  const centroids = marketCentroids(coords);
  const ranked = centroids
    .map((c) => ({
      name: c.name,
      km: haversineKm(askGeo.lat, askGeo.lng, c.lat, c.lng),
    }))
    .sort((a, b) => a.km - b.km);
  if (!ranked.length || ranked[0]!.km > NEAR_KM) return [];
  return ranked.filter((r) => r.km <= NEAR_KM).slice(0, 4).map((r) => r.name);
}

/**
 * Nearby served markets for an empty locality ask.
 * Null when the ask is outside served geography (Delhi vs Bangalore stock).
 */
export async function searchLocalityWiden(
  input: {
    asked: string;
    builderId: string;
    filters: SearchFilters;
    rejectedProjectIds: readonly string[];
    catalogMarkets: readonly string[];
    ports: LocalityWidenPorts;
    max?: number;
  },
): Promise<LocalityWidenHit | null> {
  const asked = input.asked.trim();
  if (!asked || !input.catalogMarkets.length) return null;
  const max = input.max ?? 3;

  let nearbyAreas = await marketsFromLi(
    asked,
    input.builderId,
    input.catalogMarkets,
    input.ports,
  );
  if (!nearbyAreas.length) {
    nearbyAreas = await marketsNearAsk(asked, input.builderId, input.ports);
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
