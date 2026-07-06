/** Project + origin geo — all reference coords from NayaDesk (GEO-DB-1). */

import type { GeoPoint } from './geo.js';
import { haversineKm } from './geo.js';

export type ProjectGeoCatalog = Readonly<Record<string, GeoPoint>>;

/** Test-only catalog — production loads via NayaDesk search / resolveGeo. */
export const TEST_PROJECT_GEO: ProjectGeoCatalog = {
  'brigade-eldorado': { lat: 13.139, lng: 77.658 },
  eldorado: { lat: 13.139, lng: 77.658 },
  'brigade-cornerstone': { lat: 13.18, lng: 77.68 },
  cornerstone: { lat: 13.18, lng: 77.68 },
  'brigade-orchards': { lat: 13.217, lng: 77.712 },
  orchards: { lat: 13.217, lng: 77.712 },
  'ayana-lokations': { lat: 12.944, lng: 75.784 },
  ayana: { lat: 12.944, lng: 75.784 },
  'krishnaja-greens-lokations': { lat: 12.254, lng: 75.923 },
  krishnaja: { lat: 12.254, lng: 75.923 },
};

function normalizeProjectId(id: string, catalog: ProjectGeoCatalog): string {
  if (catalog[id]) return id;
  if (id.startsWith('brigade-')) return id;
  const brigade = `brigade-${id}`;
  return catalog[brigade] ? brigade : id;
}

export function projectGeo(
  projectId: string,
  catalog: ProjectGeoCatalog = TEST_PROJECT_GEO,
): GeoPoint | null {
  const key = normalizeProjectId(projectId, catalog);
  return catalog[key] ?? catalog[projectId] ?? null;
}

/** Session-resolved origin from NayaDesk geo/resolve — no local whitelist. */
export function resolveOriginGeoCached(
  _originText: string,
  cached?: { lat: number; lng: number } | null,
): GeoPoint | null {
  if (cached?.lat != null && cached?.lng != null) {
    return { lat: cached.lat, lng: cached.lng };
  }
  return null;
}

export function buildProjectGeoMap(
  projectIds: readonly string[],
  catalog: ProjectGeoCatalog = TEST_PROJECT_GEO,
): Record<string, GeoPoint> {
  const out: Record<string, GeoPoint> = {};
  for (const id of projectIds) {
    const g = projectGeo(id, catalog);
    if (g) out[id] = g;
  }
  return out;
}

export function nearestProjectName(
  anchor: GeoPoint,
  stops: Array<{ projectId: string; projectName: string }>,
  geo: Record<string, GeoPoint>,
): string | null {
  let best: { name: string; km: number } | null = null;
  for (const s of stops) {
    const g = geo[s.projectId];
    if (!g) continue;
    const km = haversineKm(anchor.lat, anchor.lng, g.lat, g.lng);
    if (!best || km < best.km) best = { name: s.projectName, km };
  }
  return best?.name ?? null;
}

export function catalogFromProjectCoords(
  rows: ReadonlyArray<{ projectId: string; lat: number; lng: number }>,
): ProjectGeoCatalog {
  const out: Record<string, GeoPoint> = { ...TEST_PROJECT_GEO };
  for (const row of rows) {
    out[row.projectId] = { lat: row.lat, lng: row.lng };
  }
  return out;
}
