/**
 * L3 — shared embed cache for enrich + routing (one AI.run per utterance).
 */
import type { Env } from '../env.js';
import { getEmbedVector, putEmbedVector } from './turn-cache.js';

const DEFAULT_EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';

export type EmbedCacheEnv = Pick<
  Env,
  'AI' | 'TURN_CACHE' | 'SIL_EMBED_MODEL' | 'SIL_INTENT_PROJECTION'
>;

export type CachedEmbedResult = {
  vector: number[] | null;
  cache: 'hit' | 'miss' | 'skip';
};

/**
 * Embed a single query text with TURN_CACHE reuse.
 * `cacheText` should be the normalized/canonical text used as the cache key
 * (may differ from `embedText` if callers mask entities before AI.run).
 */
export async function cachedEmbedOne(
  env: EmbedCacheEnv,
  embedText: string,
  opts?: { cacheText?: string },
): Promise<CachedEmbedResult> {
  if (!env.AI || !embedText.trim()) return { vector: null, cache: 'skip' };
  const projectionId = env.SIL_INTENT_PROJECTION || 'raw';
  const keyText = opts?.cacheText ?? embedText;
  const hit = await getEmbedVector(env.TURN_CACHE, projectionId, keyText);
  if (hit) return { vector: hit, cache: 'hit' };

  const model = env.SIL_EMBED_MODEL || DEFAULT_EMBED_MODEL;
  const resp = (await env.AI.run(model as never, { text: [embedText] })) as {
    data?: number[][];
  };
  const vector = resp.data?.[0] ?? null;
  if (vector?.length) {
    await putEmbedVector(env.TURN_CACHE, projectionId, keyText, vector);
  }
  return { vector, cache: vector ? 'miss' : 'skip' };
}
