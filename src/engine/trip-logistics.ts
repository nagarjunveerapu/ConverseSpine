/**
 * Site-visit trip planning — port of Naya/src/lib/trip_logistics.ts.
 * Google Distance Matrix for drive minutes; haversine fallback (km only, minutes null).
 */

import { haversineKm, type GeoPoint } from './geo.js';

export interface TripStop {
  readonly project_id: string;
  readonly name: string;
  readonly lat: number | null;
  readonly lng: number | null;
}

export type LegSource = 'distance_matrix' | 'haversine' | 'none';

export interface TripLeg {
  readonly index: number;
  readonly project_id: string;
  readonly name: string;
  readonly from_label: string;
  readonly km: number | null;
  readonly minutes: number | null;
  readonly source: LegSource;
}

const KM_SANITY_MAX = 200;

export function orderStopsByTravel<T extends TripStop>(
  stops: readonly T[],
  anchor: GeoPoint | null,
): T[] {
  const withGeo = stops.filter((t) => t.lat !== null && t.lng !== null);
  const without = stops.filter((t) => t.lat === null || t.lng === null);
  if (!anchor || withGeo.length === 0) return [...stops];

  const remaining = [...withGeo];
  const route: T[] = [];
  let cur = { lat: anchor.lat, lng: anchor.lng };
  while (remaining.length > 0) {
    remaining.sort(
      (a, b) =>
        haversineKm(cur.lat, cur.lng, a.lat!, a.lng!) -
        haversineKm(cur.lat, cur.lng, b.lat!, b.lng!),
    );
    const next = remaining.shift()!;
    route.push(next);
    cur = { lat: next.lat!, lng: next.lng! };
  }
  return [...route, ...without];
}

function sane(km: number | null): number | null {
  if (km === null) return null;
  return km <= KM_SANITY_MAX ? km : null;
}

export function haversineLegs(
  ordered: readonly TripStop[],
  anchor: GeoPoint | null,
): TripLeg[] {
  return ordered.map((stop, i) => {
    const from =
      i === 0
        ? anchor
          ? { lat: anchor.lat, lng: anchor.lng }
          : null
        : ordered[i - 1]!.lat !== null && ordered[i - 1]!.lng !== null
          ? { lat: ordered[i - 1]!.lat!, lng: ordered[i - 1]!.lng! }
          : null;
    const km =
      from && stop.lat !== null && stop.lng !== null
        ? sane(haversineKm(from.lat, from.lng, stop.lat, stop.lng))
        : null;
    return {
      index: i,
      project_id: stop.project_id,
      name: stop.name,
      from_label: i === 0 ? 'origin' : ordered[i - 1]!.name,
      km,
      minutes: null,
      source: km !== null ? ('haversine' as const) : ('none' as const),
    };
  });
}

export async function driveLeg(
  apiKey: string,
  origin: GeoPoint,
  dest: GeoPoint,
): Promise<{ km: number; minutes: number } | null> {
  const params = new URLSearchParams({
    origins: `${origin.lat},${origin.lng}`,
    destinations: `${dest.lat},${dest.lng}`,
    mode: 'driving',
    departure_time: 'now',
    key: apiKey,
  });
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/distancematrix/json?${params}`,
    );
    if (!res.ok) return null;
    const data = await res.json<{
      rows?: Array<{
        elements?: Array<{
          status?: string;
          distance?: { value: number };
          duration_in_traffic?: { value: number };
          duration?: { value: number };
        }>;
      }>;
    }>();
    const el = data.rows?.[0]?.elements?.[0];
    if (!el || el.status !== 'OK') return null;
    const secs = el.duration_in_traffic?.value ?? el.duration?.value;
    const meters = el.distance?.value;
    if (typeof secs !== 'number' || typeof meters !== 'number') return null;
    return { km: Math.round((meters / 1000) * 10) / 10, minutes: Math.round(secs / 60) };
  } catch {
    return null;
  }
}

export async function planTrip(opts: {
  readonly stops: readonly TripStop[];
  readonly anchor: GeoPoint | null;
  readonly apiKey?: string | undefined;
}): Promise<{ ordered: TripStop[]; legs: TripLeg[] }> {
  const ordered = orderStopsByTravel(opts.stops, opts.anchor);
  const legs = haversineLegs(ordered, opts.anchor);

  if (!opts.apiKey) return { ordered, legs };

  const enriched = await Promise.all(
    legs.map(async (leg) => {
      const to = ordered[leg.index]!;
      const from =
        leg.index === 0
          ? opts.anchor
            ? { lat: opts.anchor.lat, lng: opts.anchor.lng }
            : null
          : ordered[leg.index - 1]!.lat !== null && ordered[leg.index - 1]!.lng !== null
            ? { lat: ordered[leg.index - 1]!.lat!, lng: ordered[leg.index - 1]!.lng! }
            : null;
      if (!from || to.lat === null || to.lng === null) return leg;
      const dm = await driveLeg(opts.apiKey!, from, { lat: to.lat, lng: to.lng });
      if (!dm) return leg;
      return {
        ...leg,
        km: sane(dm.km),
        minutes: dm.minutes,
        source: 'distance_matrix' as const,
      };
    }),
  );

  return { ordered, legs: enriched };
}
