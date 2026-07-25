import type { EngineDeps } from './ports.js';
import type { ConversationState, Match, ProjectDetail } from './types.js';

/**
 * Identity we already hold for a project. Search results and the focused
 * project are authoritative for a name; the projectId never is.
 */
function knownIdentity(
  s: ConversationState,
  projectId: string,
): { name: string; microMarket: string } | null {
  const offered = [...s.discover.lastOffered, ...(s.discover.discussedProjects ?? [])].find(
    (p) => p.projectId === projectId && p.name.trim(),
  );
  if (offered) return { name: offered.name, microMarket: offered.microMarket ?? '' };
  if (s.focus?.projectId === projectId && s.focus.projectName.trim()) {
    return { name: s.focus.projectName, microMarket: '' };
  }
  return null;
}

export async function hydrateProjectDetail(
  deps: EngineDeps,
  s: ConversationState,
  projectId: string,
): Promise<ProjectDetail | null> {
  const cached = s.projectCache?.[projectId];
  // An identity-only card was built while Desk's focus was a DIFFERENT project.
  // Re-read it: once this project becomes the focus the live fetch returns the
  // full record (summary, possession, legal), so the card upgrades itself.
  if (cached && !cached.identityOnly) return cached;

  const nd = s.ndConversationId;
  if (!nd) return cached ?? null;

  const detail = await deps.data.projectDetail(s.builderId, nd, projectId).catch(() => null);
  const units = await deps.data.listUnits(projectId).catch(() => []);
  const configurations = units
    .filter((u) => u.unitType)
    .map((u) => ({
      unitType: u.unitType,
      priceDisplay: u.priceDisplay,
      priceMinInr: u.priceMinInr ?? 0,
      ...(u.sizeDisplay ? { sizeDisplay: u.sizeDisplay } : {}),
    }));

  if (detail) return configurations.length ? { ...detail, configurations } : detail;

  // No live detail: Desk's conversationContext is focus-scoped, so hydrating a
  // project that is not the current focus (every prefetch past the focused one)
  // legitimately returns nothing. Units are NOT an identity — naming the card
  // after the project id is what put "*brigade-eldorado-naya-advisor*" into
  // buyer replies, and because the card is cached it stayed wrong for the whole
  // conversation. Use the name the search already gave us, or hold nothing.
  if (!configurations.length) return cached ?? null;
  const known = knownIdentity(s, projectId);
  if (!known) return cached ?? null;
  return {
    projectId,
    name: known.name,
    microMarket: known.microMarket,
    identityOnly: true,
    configurations,
  };
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
