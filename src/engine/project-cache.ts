import type { DataResult, EngineDeps } from './ports.js';
import type { ConversationState, Match, ProjectDetail } from './types.js';
import { currentShortlist, discussedList } from './entity-store.js';
import {
  getProjectCard,
  putProjectCard,
  type CacheStats,
} from '../cache/turn-cache.js';

/**
 * Identity we already hold for a project. Search results and the focused
 * project are authoritative for a name; the projectId never is.
 */
function knownIdentity(
  s: ConversationState,
  projectId: string,
): { name: string; microMarket: string } | null {
  const offered = [...currentShortlist(s), ...discussedList(s)].find(
    (p) => p.projectId === projectId && p.name.trim(),
  );
  if (offered) return { name: offered.name, microMarket: offered.microMarket ?? '' };
  if (s.focus?.projectId === projectId && s.focus.projectName.trim()) {
    return { name: s.focus.projectName, microMarket: '' };
  }
  return null;
}

export type HydrateProjectDetailResult = {
  detail: ProjectDetail | null;
  /** Phase 0b — set when a live projectDetail call ran (not a full-cache hit). */
  fetch?: DataResult<ProjectDetail>;
};

function markCache(deps: EngineDeps, layer: keyof CacheStats, hit: CacheStats[keyof CacheStats]): void {
  if (!deps.cacheStats) deps.cacheStats = {};
  deps.cacheStats[layer] = hit;
}

function memoGet(deps: EngineDeps, projectId: string): ProjectDetail | undefined {
  return deps.projectCardMemo?.get(projectId);
}

function memoSet(deps: EngineDeps, projectId: string, detail: ProjectDetail): void {
  if (!deps.projectCardMemo) deps.projectCardMemo = new Map();
  deps.projectCardMemo.set(projectId, detail);
}

/**
 * Identity-only shells must not block L2 seed/hit — they are name+config
 * placeholders while Desk focus was elsewhere. Stable catalog facts (summary,
 * media, legal, location, …) mean the card is durable enough for L2.
 */
export function promoteDurableProjectDetail(detail: ProjectDetail): ProjectDetail {
  if (!detail.identityOnly) return detail;
  // Configs+name are enough: the identityOnly flag only means "Desk focus was
  // elsewhere when hydrated". Once listUnits gave real configs under a known
  // name, persisting the poison flag blocked L2 and forced proj:miss every turn.
  const stable =
    Boolean(detail.summary?.trim()) ||
    Boolean(detail.mediaKinds?.length) ||
    Boolean(detail.location) ||
    Boolean(detail.possession?.trim()) ||
    Boolean(detail.loanEligibility?.trim()) ||
    Boolean(detail.startingPriceDisplay?.trim()) ||
    Boolean(detail.reraNumber?.trim()) ||
    Boolean(detail.configurations?.length && detail.name?.trim());
  if (!stable) return detail;
  const { identityOnly: _poison, ...rest } = detail;
  return rest;
}

/** Name/RERA/price-band stubs must not count as hits — they thin overview replies. */
export function isUsableProjectCard(detail: ProjectDetail | null | undefined): boolean {
  if (!detail || detail.identityOnly) return false;
  // Overview compose needs unit rows or a real summary — band-only catalog GETs
  // set startingPriceDisplay and were falsely treated as complete L2 hits.
  return Boolean(detail.configurations?.length || detail.summary?.trim());
}

/** Seed conversation projectCache from L2 when focus is cold (cross-turn). */
export async function seedProjectCacheFromL2(
  deps: EngineDeps,
  s: ConversationState,
): Promise<ConversationState> {
  const focusId = s.focus?.projectId;
  if (!focusId) return s;
  const existing = s.projectCache?.[focusId];
  // Usable cards are done; identity-only / stubs must still try L2 upgrade.
  if (isUsableProjectCard(existing)) return s;
  const kvCard = await getProjectCard(deps.turnCache, focusId);
  if (!isUsableProjectCard(kvCard?.detail)) return s;
  const detail = promoteDurableProjectDetail(kvCard!.detail);
  memoSet(deps, focusId, detail);
  return {
    ...s,
    projectCache: { ...(s.projectCache ?? {}), [focusId]: detail },
  };
}

export async function hydrateProjectDetail(
  deps: EngineDeps,
  s: ConversationState,
  projectId: string,
): Promise<HydrateProjectDetailResult> {
  const memoized = memoGet(deps, projectId);
  if (isUsableProjectCard(memoized)) {
    markCache(deps, 'proj', 'hit');
    return { detail: memoized! };
  }

  const cached = s.projectCache?.[projectId];
  // An identity-only / name-only stub was built while Desk's focus was elsewhere
  // or from a thin catalog GET. Re-fetch until the card is usable for compose.
  if (isUsableProjectCard(cached)) {
    markCache(deps, 'proj', 'hit');
    memoSet(deps, projectId, cached!);
    return { detail: cached! };
  }

  // L2 — Cache API + TURN_CACHE project card (multi-facet; shared across chats).
  const kvCard = await getProjectCard(deps.turnCache, projectId);
  if (isUsableProjectCard(kvCard?.detail)) {
    markCache(deps, 'proj', 'hit');
    memoSet(deps, projectId, kvCard!.detail);
    return { detail: kvCard!.detail };
  }
  markCache(deps, 'proj', 'miss');

  const nd = s.ndConversationId;
  if (!nd) return { detail: cached ?? null };

  const fetch =
    (await deps.data.projectDetail(s.builderId, nd, projectId).catch(
      (): DataResult<never> => ({ ok: false, reason: 'transport', latency_ms: 0 }),
    )) ?? ({ ok: false, reason: 'transport', latency_ms: 0 } as DataResult<never>);
  const detail = fetch.ok ? fetch.value : null;
  const units = await deps.data.listUnits(projectId).catch(() => []);
  const configurations = units
    .filter((u) => u.unitType)
    .map((u) => ({
      unitType: u.unitType,
      priceDisplay: u.priceDisplay,
      priceMinInr: u.priceMinInr ?? 0,
      ...(u.sizeDisplay ? { sizeDisplay: u.sizeDisplay } : {}),
    }));

  if (detail) {
    const merged = promoteDurableProjectDetail(
      configurations.length ? { ...detail, configurations } : detail,
    );
    const etag = `${projectId}:${Date.now()}`;
    // Never teach L2 a name-only stub — that caused overview thinning on hit.
    if (isUsableProjectCard(merged)) {
      await putProjectCard(deps.turnCache, projectId, etag, merged, {
        priceVolatile: false,
      });
      if (deps.projectEtag && deps.waitUntil) {
        deps.waitUntil(
          (async () => {
            const live = await deps.projectEtag?.(projectId).catch(() => null);
            if (live?.etag) {
              await putProjectCard(deps.turnCache, projectId, live.etag, merged, {
                priceVolatile: false,
              });
            }
          })(),
        );
      }
    }
    memoSet(deps, projectId, merged);
    return {
      detail: merged,
      fetch,
    };
  }

  // No live detail: Desk's conversationContext is focus-scoped, so hydrating a
  // project that is not the current focus (every prefetch past the focused one)
  // legitimately returns nothing. Units are NOT an identity — naming the card
  // after the project id is what put "*brigade-eldorado-naya-advisor*" into
  // buyer replies, and because the card is cached it stayed wrong for the whole
  // conversation. Use the name the search already gave us, or hold nothing.
  if (!configurations.length) return { detail: cached ?? null, fetch };
  const known = knownIdentity(s, projectId);
  if (!known) return { detail: cached ?? null, fetch };
  // Focused project: promote immediately so the next turn hits projectCache/L2
  // even when Desk context/getProject flaked on this turn.
  const shell: ProjectDetail = {
    projectId,
    name: known.name,
    microMarket: known.microMarket,
    identityOnly: true,
    configurations,
  };
  const focused = s.focus?.projectId === projectId;
  const detailOut = focused ? promoteDurableProjectDetail(shell) : shell;
  if (focused && !detailOut.identityOnly) {
    await putProjectCard(deps.turnCache, projectId, `${projectId}:${Date.now()}`, detailOut, {
      priceVolatile: false,
    });
    memoSet(deps, projectId, detailOut);
  }
  return { detail: detailOut, fetch };
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
    if (cache[projectId] && !cache[projectId]!.identityOnly) continue;
    const { detail } = await hydrateProjectDetail(deps, { ...s, projectCache: cache }, projectId);
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

/** Persist durable detail into L2 (called when conversation projectCache updates). */
export async function writeProjectCardFromDetail(
  deps: EngineDeps,
  projectId: string,
  detail: ProjectDetail,
): Promise<void> {
  if (!projectId) return;
  const durable = promoteDurableProjectDetail(detail);
  // Still a pure identity / name-only shell — do not teach L2 a stub.
  if (!isUsableProjectCard(durable)) return;
  memoSet(deps, projectId, durable);
  await putProjectCard(deps.turnCache, projectId, `${projectId}:${Date.now()}`, durable, {
    priceVolatile: false,
  });
}
