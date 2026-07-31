/**
 * Singleton exact-fit → honest nearby preview (opt-in widen).
 *
 * Location stays a hard filter on the board; we never pad Virajpet into a
 * Sakleshpur shortlist. This only finds same-type projects outside the asked
 * market so compose/chips can offer "also nearby?" without lying about fit.
 */
import type { Constraints, Match, SearchFilters } from './types.js';

export type NearbyOffer = {
  asked: string;
  nearbyAreas: string[];
  previewNames: string[];
  /** Matches the buyer would get if they accept the widen — not on the board yet. */
  previewMatches: Match[];
};

export type NearbyOfferSearch = (
  builderId: string,
  filters: SearchFilters,
) => Promise<{ matches: Match[] }>;

function samePlace(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return x === y || x.includes(y) || y.includes(x);
}

function withoutLocation(filters: SearchFilters): SearchFilters {
  const { locations: _loc, ...rest } = filters;
  return { ...rest, maxResults: filters.maxResults ?? 5 };
}

/**
 * Same property type, drop location, exclude already-shown / same-market hits.
 * Null when nothing honest remains to offer.
 */
export async function findNearbyTypeOffer(input: {
  asked: string;
  builderId: string;
  filters: SearchFilters;
  constraints: Constraints;
  excludeIds: ReadonlySet<string>;
  search: NearbyOfferSearch;
  max?: number;
}): Promise<NearbyOffer | null> {
  const asked = input.asked.trim();
  if (!asked) return null;
  // Need a type (or the dropped-location search dumps the whole catalog).
  if (!input.filters.projectTypes && !input.constraints.propertyType) return null;

  const max = input.max ?? 3;
  const resp = await input.search(input.builderId, withoutLocation(input.filters)).catch(() => ({
    matches: [] as Match[],
  }));

  const previewMatches: Match[] = [];
  const areas: string[] = [];
  for (const m of resp.matches ?? []) {
    if (input.excludeIds.has(m.projectId)) continue;
    if (samePlace(m.microMarket, asked)) continue;
    previewMatches.push(m);
    if (!areas.some((a) => samePlace(a, m.microMarket))) {
      areas.push(m.microMarket.split('/')[0]?.trim() || m.microMarket);
    }
    if (previewMatches.length >= max) break;
  }
  if (!previewMatches.length || !areas.length) return null;

  return {
    asked,
    nearbyAreas: areas.slice(0, 3),
    previewNames: previewMatches.map((m) => m.name),
    previewMatches,
  };
}
