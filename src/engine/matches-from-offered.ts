import type { ThreadState, Match } from './types.js';
import { currentShortlist } from './entity-store.js';

/** Rehydrate Match rows from the current shortlist for compare/re-list (no new search). */
export function matchesFromLastOffered(state: ThreadState): Match[] {
  return currentShortlist(state).map((o) => ({
    projectId: o.projectId,
    name: o.name,
    microMarket: o.microMarket ?? '',
    startingPriceInr: o.startingPriceInr ?? 0,
    startingPriceDisplay: o.startingPriceDisplay ?? '',
    matchReasons: ['on your shortlist'],
    ...(o.tradeoffNote ? { tradeoffNote: o.tradeoffNote } : {}),
    ...(o.dimensionFit ? { dimensionFit: o.dimensionFit } : {}),
    ...(o.dimensionGap ? { dimensionGap: o.dimensionGap } : {}),
  }));
}
