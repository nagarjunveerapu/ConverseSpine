/** Project + origin geo lookup — catalog coords with test-id aliases. */

import type { ConversationState } from './types.js';
import type { GeoPoint } from './geo.js';
import { haversineKm } from './geo.js';

const PROJECT_COORDS: Record<string, GeoPoint> = {
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

const ORIGIN_COORDS: Record<string, GeoPoint> = {
  whitefield: { lat: 12.969, lng: 77.749 },
  devanahalli: { lat: 13.247, lng: 77.712 },
  bagalur: { lat: 13.139, lng: 77.658 },
  'north bangalore': { lat: 13.07, lng: 77.625 },
  hebbal: { lat: 13.035, lng: 77.597 },
  indiranagar: { lat: 12.978, lng: 77.641 },
  koramangala: { lat: 12.935, lng: 77.624 },
};

export function projectGeo(projectId: string): GeoPoint | null {
  return PROJECT_COORDS[projectId] ?? PROJECT_COORDS[normalizeProjectId(projectId)] ?? null;
}

function normalizeProjectId(id: string): string {
  if (id.startsWith('brigade-')) return id;
  const brigade = `brigade-${id}`;
  return PROJECT_COORDS[brigade] ? brigade : id;
}

export function resolveOriginGeo(originText: string): GeoPoint | null {
  const key = originText.trim().toLowerCase();
  for (const [name, pt] of Object.entries(ORIGIN_COORDS)) {
    if (key.includes(name)) return pt;
  }
  return null;
}

export function collectVisitProjectIds(state: ConversationState): string[] {
  const ids: string[] = [];
  if (state.visit?.projectId) ids.push(state.visit.projectId);
  for (const q of state.visit?.queued ?? []) ids.push(q.projectId);
  return ids;
}

export function buildProjectGeoMap(projectIds: readonly string[]): Record<string, GeoPoint> {
  const out: Record<string, GeoPoint> = {};
  for (const id of projectIds) {
    const g = projectGeo(id);
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
