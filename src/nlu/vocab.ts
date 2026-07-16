import type { Env } from '../env.js';
import { NayaDeskClient } from '../crm/nayadesk-client.js';
import { BUNDLED_VOCAB, makeCanonicalizer, mergeVocab, type MaskVocab } from './canonicalize.js';

/**
 * Self-refreshing mask vocab (Understanding Flywheel §7.4).
 *
 * The vocab (which project/place/builder names the canonicalizer recognises) is
 * sourced LIVE from the Desk catalog, so onboarding a project/area/builder makes
 * the bot recognise it on the next rebuild — no code edit, no redeploy.
 *
 * Consistency is the whole game: the corpus is canonicalized at REBUILD time and
 * the query at REQUEST time; they must use the IDENTICAL vocab or the train/serve
 * skew we just killed returns. So the rebuild PINS the exact vocab snapshot it
 * built the index with into KV, and the query reads THAT snapshot. New catalog
 * entries reach the query only after a rebuild re-pins — never ahead of the index.
 *
 * Everything degrades to the bundled snapshot if Desk/KV is unavailable, so a
 * rebuild or a live turn never breaks on a vocab fetch.
 */

const KV_KEY = 'sil:mask-vocab:active';
const QUERY_TTL_MS = 5 * 60 * 1000; // per-isolate cache; a stale entry only means
                                    // a just-onboarded name isn't masked for a few min

export interface VocabSnapshot {
  version: string;
  vocab: MaskVocab;
  built_at: number;
}

/**
 * REBUILD path: fetch the live catalog vocab from Desk, union the static
 * gazetteer seed (out-of-catalog entities + national builders), pin the snapshot
 * to KV, and return it. The rebuild compiles its canonicalizer from `.vocab`.
 */
export async function getRebuildVocab(env: Env): Promise<VocabSnapshot> {
  let vocab: MaskVocab = BUNDLED_VOCAB;
  let version = 'bundled';
  try {
    const live = await new NayaDeskClient(env).getMaskVocab();
    vocab = mergeVocab(
      { places: live.places, builders: live.builders, projects: live.projects },
      BUNDLED_VOCAB,
    );
    version = `catalog:${live.version}`;
  } catch {
    // Desk unreachable — the bundled snapshot keeps the rebuild working.
  }
  const snap: VocabSnapshot = { version, vocab, built_at: Date.now() };
  if (env.TURN_CACHE) {
    try { await env.TURN_CACHE.put(KV_KEY, JSON.stringify(snap)); } catch { /* non-fatal */ }
  }
  return snap;
}

// Per-isolate query cache — the compiled canonicalizer for the pinned vocab.
let queryCache: { version: string; canon: (t: string) => string; at: number } | null = null;

/**
 * QUERY path: the canonicalizer built from the vocab the CURRENT index was built
 * with (the rebuild pinned it). Cached per isolate; on a cold/empty cache or any
 * error it falls back to the bundled canonicalizer, so a live turn never fails.
 */
export async function getQueryCanonicalizer(env: Env): Promise<(t: string) => string> {
  const now = Date.now();
  if (queryCache && now - queryCache.at < QUERY_TTL_MS) return queryCache.canon;

  let snap: VocabSnapshot | null = null;
  if (env.TURN_CACHE) {
    try {
      const raw = await env.TURN_CACHE.get(KV_KEY);
      if (raw) snap = JSON.parse(raw) as VocabSnapshot;
    } catch { /* fall through to bundled */ }
  }
  // Same version already compiled — just refresh the timestamp (skip recompile).
  if (queryCache && snap && queryCache.version === snap.version) {
    queryCache.at = now;
    return queryCache.canon;
  }
  const vocab = snap?.vocab ?? BUNDLED_VOCAB;
  queryCache = { version: snap?.version ?? 'bundled', canon: makeCanonicalizer(vocab), at: now };
  return queryCache.canon;
}
