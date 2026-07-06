import type { TurnRuntime } from '../runtime/deps.js';
import { budgetToMaxInr } from '../crm/repository.js';
import type { MemoryView } from '../types.js';
import type { NdSearchMatch } from '../crm/nayadesk-client.js';

/** Broaden filters when a strict search returns nothing (e.g. BHK on plantation catalog). */
export async function searchProjectsWithFallback(
  rt: TurnRuntime,
  builderId: string,
  memory: MemoryView,
  extra?: { search_text?: string },
): Promise<NdSearchMatch[]> {
  const location = memory.facts.location;
  const bhk = memory.facts.bhk;
  const budgetMax = budgetToMaxInr(memory.facts.budget);
  const searchText = extra?.search_text;

  const attempts: Array<Record<string, unknown>> = [];

  const full: Record<string, unknown> = { builder_id: builderId, max_results: 5 };
  if (searchText) full.search_text = searchText;
  if (location) full.locations = [location];
  if (bhk) full.bhks = [bhk];
  if (budgetMax) full.budget_max_inr = budgetMax;
  attempts.push(full);

  if (bhk) {
    const noBhk = { ...full };
    delete noBhk.bhks;
    attempts.push(noBhk);
  }
  if (location) {
    const noLoc = { ...full };
    delete noLoc.locations;
    delete noLoc.bhks;
    attempts.push(noLoc);
  }
  if (budgetMax) {
    attempts.push({ builder_id: builderId, max_results: 5, ...(searchText ? { search_text: searchText } : {}) });
  }

  for (const body of attempts) {
    const resp = await rt.crm.searchProjects(body as Parameters<typeof rt.crm.searchProjects>[0]);
    if (resp.matches.length > 0) return resp.matches;
  }
  return [];
}
