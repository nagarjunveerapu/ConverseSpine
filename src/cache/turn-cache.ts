/**
 * Shared TURN_CACHE read-model (L1–L4) for dig latency.
 * See docs/lld SYSTEM_DESIGN + infra latency plan.
 *
 * L1 segment · L2 project card · L3 embed · L4 search memo
 * Never treat price/inventory as long-lived truth — short TTL + etag/invalidate.
 */
import type { ProjectDetail } from '../engine/types.js';

export type CacheHit = 'hit' | 'miss' | 'skip';

export interface CacheStats {
  seg?: CacheHit;
  proj?: CacheHit;
  emb?: CacheHit;
  search?: CacheHit;
}

/** Snake_case search row — same shape as EngineData.search matches. */
export type SearchRow = {
  project_id: string;
  name: string;
  micro_market: string;
  starting_price_inr: number;
  starting_price_display: string;
  match_reasons?: string[];
  project_type?: string;
  tradeoff_note?: string;
};

const SEG_TTL = 45 * 60;
const PROJ_STABLE_TTL = 6 * 60 * 60;
const PROJ_VOLATILE_TTL = 90;
const EMB_TTL = 6 * 60 * 60;
/** Vectorize match list for a routing query — same utterance → same top-K. */
const INTENT_QUERY_TTL = 6 * 60 * 60;
const SEARCH_TTL = 90;

export type IntentMatchRow = {
  id?: string;
  kind: string;
  score: number;
  facet: string;
};

export interface IntentQueryCacheEntry {
  matches: IntentMatchRow[];
  savedAt: number;
}

export interface ProjectCard {
  etag: string;
  detail: ProjectDetail;
  priceVolatile?: boolean;
  savedAt: number;
}

export interface SegmentCard {
  builderId: string;
  areaNorm: string;
  propertyType: string;
  projects: Array<{
    projectId: string;
    name: string;
    microMarket: string;
    fromPriceDisplay?: string;
    etag?: string;
  }>;
  savedAt: number;
}

export interface SearchMemo {
  projectIds: string[];
  matches: SearchRow[];
  expandedLocations?: string[];
  recognizedLocations?: string[] | null;
  noMatchReasoning?: string;
  savedAt: number;
}

export interface EmbedCacheEntry {
  projectionId: string;
  vector: number[];
  savedAt: number;
}

function normArea(area: string): string {
  return area.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 500);
}

/** FNV-1a 32-bit — fast stable hash for cache keys (not crypto). */
export function hashKey(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function segKey(builderId: string, area: string, propertyType: string): string {
  return `seg:${builderId}:${normArea(area)}:${(propertyType || 'any').toLowerCase()}`;
}

export function projKey(projectId: string): string {
  return `proj:${projectId}`;
}

export function embKey(projectionId: string, text: string): string {
  return `emb:${projectionId || 'raw'}:${hashKey(normText(text))}`;
}

/** Intent Vectorize result cache — keyed by projected query text + builder. */
export function intentQueryKey(projectionId: string, queryText: string, builderId: string): string {
  return `ivq:${projectionId || 'raw'}:${hashKey(normText(queryText))}:${builderId || '_'}`;
}

export function searchKey(builderId: string, constraintHash: string): string {
  return `search:${builderId}:${constraintHash}`;
}

export function hashConstraints(parts: Record<string, unknown>): string {
  const keys = Object.keys(parts).sort();
  const stable = keys.map((k) => `${k}=${JSON.stringify(parts[k] ?? null)}`).join('&');
  return hashKey(stable);
}

async function kvGetJson<T>(kv: KVNamespace | undefined, key: string): Promise<T | null> {
  if (!kv) return null;
  try {
    return (await kv.get(key, 'json')) as T | null;
  } catch {
    return null;
  }
}

async function kvPutJson(
  kv: KVNamespace | undefined,
  key: string,
  value: unknown,
  ttl: number,
): Promise<void> {
  if (!kv) return;
  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: ttl });
  } catch {
    /* non-fatal */
  }
}

export async function getSegmentCard(
  kv: KVNamespace | undefined,
  builderId: string,
  area: string,
  propertyType: string,
): Promise<SegmentCard | null> {
  if (!area.trim()) return null;
  return kvGetJson<SegmentCard>(kv, segKey(builderId, area, propertyType));
}

export async function putSegmentCard(
  kv: KVNamespace | undefined,
  card: Omit<SegmentCard, 'savedAt'>,
): Promise<void> {
  await kvPutJson(kv, segKey(card.builderId, card.areaNorm, card.propertyType), {
    ...card,
    savedAt: Date.now(),
  }, SEG_TTL);
}

function projectCardCacheRequest(projectId: string): Request {
  // Cache API needs a full URL; host is arbitrary (not fetched).
  return new Request(`https://turn-cache.internal/proj/${encodeURIComponent(projectId)}`);
}

/** Workers expose `caches.default`; Node/vitest may not. */
async function edgeCache(): Promise<Cache | null> {
  try {
    const store = (caches as unknown as { default?: Cache }).default;
    return store ?? null;
  } catch {
    return null;
  }
}

export async function getProjectCard(
  kv: KVNamespace | undefined,
  projectId: string,
): Promise<ProjectCard | null> {
  // Edge Cache API first — same-colo put→get is reliable; KV can lag.
  try {
    const cache = await edgeCache();
    const cached = cache ? await cache.match(projectCardCacheRequest(projectId)) : undefined;
    if (cached) {
      const card = (await cached.json()) as ProjectCard;
      if (card?.detail) return card;
    }
  } catch {
    /* Cache API unavailable in some test envs */
  }
  return kvGetJson<ProjectCard>(kv, projKey(projectId));
}

export async function putProjectCard(
  kv: KVNamespace | undefined,
  projectId: string,
  etag: string,
  detail: ProjectDetail,
  opts?: { priceVolatile?: boolean },
): Promise<void> {
  const ttl = opts?.priceVolatile ? PROJ_VOLATILE_TTL : PROJ_STABLE_TTL;
  // Strip FAQs — question-scoped; never cache whole catalog as "answered".
  const { faqs: _f, ...rest } = detail;
  const card: ProjectCard = {
    etag,
    detail: rest,
    priceVolatile: opts?.priceVolatile ?? false,
    savedAt: Date.now(),
  };
  try {
    const cache = await edgeCache();
    if (cache) {
      await cache.put(
        projectCardCacheRequest(projectId),
        new Response(JSON.stringify(card), {
          headers: {
            'content-type': 'application/json',
            'cache-control': `public, max-age=${ttl}`,
          },
        }),
      );
    }
  } catch {
    /* non-fatal */
  }
  await kvPutJson(kv, projKey(projectId), card, ttl);
}

export async function getEmbedVector(
  kv: KVNamespace | undefined,
  projectionId: string,
  text: string,
): Promise<number[] | null> {
  const entry = await kvGetJson<EmbedCacheEntry>(kv, embKey(projectionId, text));
  return entry?.vector?.length ? entry.vector : null;
}

export async function putEmbedVector(
  kv: KVNamespace | undefined,
  projectionId: string,
  text: string,
  vector: number[],
): Promise<void> {
  if (!vector.length) return;
  await kvPutJson(
    kv,
    embKey(projectionId, text),
    { projectionId, vector, savedAt: Date.now() } satisfies EmbedCacheEntry,
    EMB_TTL,
  );
}

export async function getIntentQueryMatches(
  kv: KVNamespace | undefined,
  projectionId: string,
  queryText: string,
  builderId: string,
): Promise<IntentMatchRow[] | null> {
  const entry = await kvGetJson<IntentQueryCacheEntry>(
    kv,
    intentQueryKey(projectionId, queryText, builderId),
  );
  return entry?.matches?.length ? entry.matches : null;
}

export async function putIntentQueryMatches(
  kv: KVNamespace | undefined,
  projectionId: string,
  queryText: string,
  builderId: string,
  matches: IntentMatchRow[],
): Promise<void> {
  if (!matches.length) return;
  await kvPutJson(
    kv,
    intentQueryKey(projectionId, queryText, builderId),
    { matches, savedAt: Date.now() } satisfies IntentQueryCacheEntry,
    INTENT_QUERY_TTL,
  );
}

export async function getSearchMemo(
  kv: KVNamespace | undefined,
  builderId: string,
  constraintHash: string,
): Promise<SearchMemo | null> {
  return kvGetJson<SearchMemo>(kv, searchKey(builderId, constraintHash));
}

export async function putSearchMemo(
  kv: KVNamespace | undefined,
  builderId: string,
  constraintHash: string,
  payload: {
    matches: SearchRow[];
    expandedLocations?: string[];
    recognizedLocations?: string[] | null;
    noMatchReasoning?: string;
  },
): Promise<void> {
  await kvPutJson(
    kv,
    searchKey(builderId, constraintHash),
    {
      projectIds: payload.matches.map((m) => m.project_id),
      matches: payload.matches,
      ...(payload.expandedLocations ? { expandedLocations: payload.expandedLocations } : {}),
      ...(payload.recognizedLocations !== undefined
        ? { recognizedLocations: payload.recognizedLocations }
        : {}),
      ...(payload.noMatchReasoning ? { noMatchReasoning: payload.noMatchReasoning } : {}),
      savedAt: Date.now(),
    } satisfies SearchMemo,
    SEARCH_TTL,
  );
}

export type InvalidateRequest = {
  type: 'segment' | 'project' | 'search' | 'embed' | 'all';
  builderId?: string;
  projectId?: string;
  areaNorm?: string;
  propertyType?: string;
  keys?: string[];
};

/** Best-effort delete of known key patterns. */
export async function invalidateTurnCache(
  kv: KVNamespace | undefined,
  req: InvalidateRequest,
): Promise<{ deleted: string[] }> {
  const deleted: string[] = [];
  if (!kv) return { deleted };

  const del = async (key: string) => {
    try {
      await kv.delete(key);
      deleted.push(key);
    } catch {
      /* ignore */
    }
  };

  for (const k of req.keys ?? []) {
    await del(k);
  }

  if (req.type === 'project' && req.projectId) {
    await del(projKey(req.projectId));
    try {
      const cache = await edgeCache();
      if (cache) await cache.delete(projectCardCacheRequest(req.projectId));
    } catch {
      /* Cache API optional */
    }
  }
  if (req.type === 'segment' && req.builderId && req.areaNorm) {
    await del(segKey(req.builderId, req.areaNorm, req.propertyType || 'any'));
  }
  // search/embed/all without explicit keys: caller should pass keys; project
  // invalidate is the hot path from Desk publish.
  if (req.type === 'all' && req.projectId) {
    await del(projKey(req.projectId));
  }

  return { deleted };
}
