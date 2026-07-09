import type { EngineDeps } from './ports.js';
import type { ConversationState, Match, ProjectDetail } from './types.js';

export async function hydrateProjectDetail(
  deps: EngineDeps,
  s: ConversationState,
  projectId: string,
): Promise<ProjectDetail | null> {
  const cached = s.projectCache?.[projectId];
  if (cached) return cached;

  const nd = s.ndConversationId;
  if (!nd) return null;

  let detail = await deps.data.projectDetail(s.builderId, nd, projectId).catch(() => null);
  const units = await deps.data.listUnits(projectId).catch(() => []);
  const configurations = units
    .filter((u) => u.unitType)
    .map((u) => ({
      unitType: u.unitType,
      priceDisplay: u.priceDisplay,
      priceMinInr: u.priceMinInr ?? 0,
      ...(u.sizeDisplay ? { sizeDisplay: u.sizeDisplay } : {}),
    }));

  if (configurations.length) {
    detail = detail
      ? { ...detail, configurations }
      : {
          projectId,
          name: projectId,
          microMarket: '',
          configurations,
        };
  }

  return detail;
}

export async function prefetchProjects(
  deps: EngineDeps,
  s: ConversationState,
  projectIds: string[],
): Promise<ConversationState> {
  const nd = s.ndConversationId;
  if (!nd || projectIds.length === 0) return s;

  const cache = { ...(s.projectCache ?? {}) };
  let changed = false;

  for (const projectId of projectIds) {
    if (cache[projectId]) continue;
    const detail = await hydrateProjectDetail(deps, { ...s, projectCache: cache }, projectId);
    if (detail) {
      cache[projectId] = detail;
      changed = true;
    }
  }

  return changed ? { ...s, projectCache: cache } : s;
}

export function projectIdsFromMatches(matches: Match[]): string[] {
  return matches.map((m) => m.projectId).filter(Boolean);
}
