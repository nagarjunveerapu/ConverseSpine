import { hasNarrowingConstraint, searchFilters } from './phases/discover.js';
import type { EngineDeps } from './ports.js';
import type { Constraints } from './types.js';

/**
 * Live "narrowing preview" — the data behind the SPA thinking-strip.
 *
 * As the buyer's brief accumulates (free-text opener OR chip taps), the SPA
 * asks for a match count against the constraints so far, so it can show the
 * shortlist narrowing in real time ("4 BHK · 42 → ₹60L · 12 → Devanahalli · 3")
 * and reveal the shortlist the instant the hard filters are in.
 *
 * This is deliberately the CHEAPEST honest read of the catalog: one Desk search,
 * no LLM extraction, no routing, no compose, no chat-state mutation, no detail
 * prefetch. It is a pure function of (builder, constraints) — safe to call on
 * every debounced keystroke/chip and trivially cacheable.
 */

/** Desk search cap (projects.ts max_results.max(50)). Counts at/above this are
 *  reported as capped so the SPA can render "50+". This tenant's catalog is far
 *  smaller, so real narrowing counts land well under the cap. */
const PREVIEW_MAX = 50;
/** How many cards ride back for the early reveal. Matches the shortlist width. */
const REVEAL_CARDS = 3;

export interface PreviewCard {
  project_id: string;
  name: string;
  micro_market: string;
  starting_price_display: string;
  project_type?: string;
}

export interface PreviewResult {
  /** Honest match count against the constraints so far (capped at PREVIEW_MAX). */
  count: number;
  /** True when count hit the Desk cap — render as "count+". */
  capped: boolean;
  /** False until at least one narrowing constraint (type/budget/area/bhk) is set. */
  narrowing: boolean;
  /** Top matches for the early reveal (empty until narrowing). */
  matches: PreviewCard[];
}

/**
 * Count the catalog against the constraints so far and return the top cards.
 * Trusts the Desk-filtered result the same way the recovery planner does
 * (matches.length is the honest count) — no Spine-side re-filtering or padding,
 * so the number the strip shows is the number Desk would return.
 */
export async function runPreview(
  deps: Pick<EngineDeps, 'data'>,
  builderId: string,
  constraints: Constraints,
): Promise<PreviewResult> {
  if (!hasNarrowingConstraint(constraints)) {
    return { count: 0, capped: false, narrowing: false, matches: [] };
  }

  const filters = { ...searchFilters(constraints), maxResults: PREVIEW_MAX };
  const raw = await deps.data.search(builderId, filters).catch(() => ({ matches: [] }));
  const count = raw.matches.length;

  const matches: PreviewCard[] = raw.matches.slice(0, REVEAL_CARDS).map((m) => ({
    project_id: m.project_id,
    name: m.name,
    micro_market: m.micro_market,
    starting_price_display: m.starting_price_display,
    ...(m.project_type ? { project_type: m.project_type } : {}),
  }));

  return { count, capped: count >= PREVIEW_MAX, narrowing: true, matches };
}
