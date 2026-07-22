import type { ConversationState, Match } from './types.js';

/** Rehydrate Match rows from discover.lastOffered for compare/re-list (no new search). */
export function matchesFromLastOffered(state: ConversationState): Match[] {
  return state.discover.lastOffered.map((o) => ({
    projectId: o.projectId,
    name: o.name,
    microMarket: o.microMarket ?? '',
    startingPriceInr: 0,
    startingPriceDisplay: o.startingPriceDisplay ?? '',
    matchReasons: ['on your shortlist'],
    ...(o.tradeoffNote ? { tradeoffNote: o.tradeoffNote } : {}),
    ...(o.dimensionFit ? { dimensionFit: o.dimensionFit } : {}),
    ...(o.dimensionGap ? { dimensionGap: o.dimensionGap } : {}),
  }));
}
