import type { TurnRuntime } from '../runtime/deps.js';
import { fetchAdvisorBriefFacets, type AdvisorBriefFacets } from './brief-facets.js';

export type AdvisorBriefFacetsResponse =
  | ({ status: 'ok' } & AdvisorBriefFacets)
  | { status: 'error'; error: string };

export async function handleAdvisorBriefFacets(
  rt: TurnRuntime,
  builderId: string,
): Promise<AdvisorBriefFacetsResponse> {
  if (!builderId.trim()) {
    return { status: 'error', error: 'builder_id_required' };
  }
  try {
    const facets = await fetchAdvisorBriefFacets(rt, builderId.trim());
    return { status: 'ok', ...facets };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'error', error: msg.slice(0, 200) || 'catalog_unavailable' };
  }
}
