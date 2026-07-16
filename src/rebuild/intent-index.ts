import type { Env } from '../env.js';
import { canonicalize, makeCanonicalizer } from '../nlu/canonicalize.js';
import { getRebuildVocab } from '../nlu/vocab.js';

/**
 * SIL data pipeline — the weekly incremental rebuild that keeps the Vectorize
 * intent index in sync with the git registry (SEMANTIC_INTENT_LAYER_LLD §4.4,
 * §10 flywheel). Runs on a Cloudflare Cron Trigger; also callable in tests.
 *
 * Design invariants:
 *  - The registry is the source; the index is a build artifact.
 *  - Rows are embedded as their CANONICAL (entity-masked) form via the shared
 *    canonicalize() — the same one the live query uses, so there is no skew.
 *  - Eligible = audit_status ∈ ELIGIBLE_AUDIT (clean | machine_v2 |
 *    mined_yantra_v1) && !quarantine, unless seeding. (The old clean-only gate
 *    silently no-op'd the entire v2 corpus, which is all machine_v2.)
 *  - Incremental: a KV manifest records id→contentHash of what this pipeline
 *    has pushed, so a weekly run embeds only NEW or CHANGED rows and deletes
 *    rows that fell out of the clean set. It manages ONLY its own tracked ids —
 *    the legacy seeded vectors are never touched until a full clean rebuild.
 *  - Model is a config (env.SIL_EMBED_MODEL); swapping models is one env change
 *    plus a manifest reset, decided by the model bake-off — not a guess.
 */

const DEFAULT_MODEL = '@cf/baai/bge-base-en-v1.5';
const MANIFEST_KEY = 'sil:intent-manifest:v1';
const VOCAB_VERSION_KEY = 'sil:intent-manifest:vocab-version';
const EMBED_BATCH = 96; // Workers AI text-array headroom
const UPSERT_BATCH = 500;

export interface RegistryRow {
  id: string;
  phrasing: string;
  intent_kind: string;
  language?: string;
  is_negative?: boolean;
  quarantine?: boolean;
  audit_status?: string;
  /** Pre-computed offline canonical (advisory only — the rebuild recomputes it
   *  via canonicalize() so there is exactly ONE canonicalization code path). */
  canonical?: string;
  source?: string;
  /** Frozen eval split. 'holdout' rows are NEVER embedded, so generalization
   *  stays honestly measurable forever; their 'train' siblings still serve. */
  eval_split?: string;
}

/**
 * audit_status values eligible for the index. Registry v2 emits 'machine_v2'
 * (machine-adjudicated by the boundary rulebook) and mined rows 'mined_yantra_v1';
 * both are shippable — quarantine still excludes the bad rows. Without this the
 * clean-only gate makes the whole v2 corpus a no-op (it never reaches the index).
 */
const ELIGIBLE_AUDIT = new Set(['clean', 'machine_v2', 'mined_yantra_v1']);

export interface RebuildOptions {
  /** Seed mode — push every well-formed row regardless of audit_status. */
  pushUnaudited?: boolean;
  /** Plan only; embed/upsert/delete nothing. */
  dryRun?: boolean;
  /**
   * Master switch for the canonical schema evolution (SIL_CANONICAL_EMBED).
   *  - false (default): legacy behaviour — clean-only gate (a no-op today,
   *    since every v2 row is machine_v2) and RAW-phrasing embeds.
   *  - true: ship the v2 + mined corpus (ELIGIBLE_AUDIT gate) as CANONICAL
   *    (entity-masked) embeds. The live query flips in lockstep via the same
   *    env flag, so corpus and query are never in different vector spaces.
   * Flipping the flag requires a manifest reset + full rebuild (documented in
   * the PR) so every vector is re-embedded in the new form.
   */
  canonicalMode?: boolean;
}

export interface RebuildReport {
  ok: boolean;
  model: string;
  source_rows: number;
  eligible: number;
  pushed: number;
  unchanged: number;
  removed: number;
  errors: string[];
  reason?: string;
}

/**
 * FNV-1a over the EMBEDDED content — cheap, deterministic, no crypto. Keyed on
 * the canonical form (what actually gets embedded), so flipping raw→canonical
 * invalidates every manifest entry and forces a clean re-embed on next rebuild.
 */
export function contentHash(r: RegistryRow): string {
  const s = `${canonicalize(r.phrasing)}${r.intent_kind}${r.is_negative ? 1 : 0}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function parseJsonl(text: string): RegistryRow[] {
  const out: RegistryRow[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as RegistryRow);
    } catch {
      // skip a malformed line rather than fail the whole rebuild
    }
  }
  return out;
}

export interface RebuildPlan {
  eligible: RegistryRow[];
  changed: RegistryRow[];
  toRemove: string[];
}

/** Pure planner — no IO, so the diff logic is unit-testable. */
export function planRebuild(
  rows: RegistryRow[],
  manifest: Record<string, string>,
  opts: RebuildOptions = {},
): RebuildPlan {
  // canonicalMode broadens the gate to the whole v2 + mined corpus; legacy mode
  // keeps the clean-only floor (a no-op today). Quarantine + holdout always excluded.
  const auditOk = (r: RegistryRow): boolean =>
    opts.canonicalMode
      ? ELIGIBLE_AUDIT.has(r.audit_status ?? '') && !r.quarantine
      : r.audit_status === 'clean' && !r.quarantine;
  const eligible = rows.filter(
    (r) =>
      r.id &&
      r.phrasing &&
      r.intent_kind &&
      r.eval_split !== 'holdout' &&
      (opts.pushUnaudited || auditOk(r)),
  );
  const eligibleIds = new Set(eligible.map((r) => r.id));
  const changed = eligible.filter((r) => manifest[r.id] !== contentHash(r));
  const toRemove = Object.keys(manifest).filter((id) => !eligibleIds.has(id));
  return { eligible, changed, toRemove };
}

export async function rebuildIntentIndex(env: Env, opts: RebuildOptions = {}): Promise<RebuildReport> {
  const model = env.SIL_EMBED_MODEL || DEFAULT_MODEL;
  // Master switch for the canonical schema evolution. Explicit opts win (tests);
  // otherwise the SIL_CANONICAL_EMBED env flag decides. Default false = legacy.
  const canonicalMode = opts.canonicalMode ?? env.SIL_CANONICAL_EMBED === 'true';
  const base: RebuildReport = {
    ok: false,
    model,
    source_rows: 0,
    eligible: 0,
    pushed: 0,
    unchanged: 0,
    removed: 0,
    errors: [],
  };
  if (!env.AI || !env.INTENT_VECTORS || !env.TURN_CACHE) return { ...base, reason: 'missing_bindings' };
  if (!env.SIL_REGISTRY_URL) return { ...base, reason: 'no_registry_url' };

  let rows: RegistryRow[];
  try {
    const res = await fetch(env.SIL_REGISTRY_URL);
    if (!res.ok) return { ...base, reason: `registry_fetch_${res.status}` };
    rows = parseJsonl(await res.text());
  } catch (e) {
    return { ...base, reason: `registry_fetch_error:${(e as Error).message}` };
  }
  base.source_rows = rows.length;

  // §7.4 live vocab: in canonical mode, fetch the catalog-sourced vocab and pin
  // it to KV so the live query masks with the IDENTICAL vocab. Compile the
  // rebuild's canonicalizer from it. A vocab-version change means every canonical
  // may differ → reset the manifest so every row re-embeds under the new vocab.
  let canon = canonicalize;
  let vocabVersion = 'bundled';
  if (canonicalMode) {
    const snap = await getRebuildVocab(env);
    canon = makeCanonicalizer(snap.vocab);
    vocabVersion = snap.version;
  }
  let manifest: Record<string, string> = JSON.parse((await env.TURN_CACHE.get(MANIFEST_KEY)) || '{}');
  if (canonicalMode) {
    const prevVocab = await env.TURN_CACHE.get(VOCAB_VERSION_KEY);
    if (prevVocab !== vocabVersion) manifest = {};
  }
  const { eligible, changed, toRemove } = planRebuild(rows, manifest, { ...opts, canonicalMode });
  base.eligible = eligible.length;

  if (opts.dryRun) {
    return {
      ...base,
      ok: true,
      pushed: changed.length,
      unchanged: eligible.length - changed.length,
      removed: toRemove.length,
      reason: 'dry_run',
    };
  }

  for (let i = 0; i < changed.length; i += EMBED_BATCH) {
    const batch = changed.slice(i, i + EMBED_BATCH);
    try {
      // canonicalMode: embed the CANONICAL (entity-masked) form — the schema
      // evolution that kills train/serve skew, using the same canonicalize() the
      // live query uses. Legacy mode embeds raw phrasing (matches a raw query).
      const out = (await env.AI.run(model as never, {
        text: batch.map((r) => (canonicalMode ? canon(r.phrasing) : r.phrasing)),
      })) as {
        data?: number[][];
      };
      const vecs = out.data ?? [];
      const upserts = batch
        .map((r, j) => ({
          id: r.id,
          values: vecs[j],
          metadata: {
            intent_kind: r.intent_kind,
            is_negative: !!r.is_negative,
            language: r.language ?? 'en',
            embed_model: model,
          },
        }))
        .filter((u) => Array.isArray(u.values) && u.values.length > 0);
      for (let k = 0; k < upserts.length; k += UPSERT_BATCH) {
        await env.INTENT_VECTORS.upsert(upserts.slice(k, k + UPSERT_BATCH) as never);
      }
      for (const r of batch) manifest[r.id] = contentHash(r);
      base.pushed += upserts.length;
    } catch (e) {
      base.errors.push(`embed_batch_${i}:${(e as Error).message}`);
    }
  }

  if (toRemove.length) {
    try {
      for (let k = 0; k < toRemove.length; k += UPSERT_BATCH) {
        await env.INTENT_VECTORS.deleteByIds(toRemove.slice(k, k + UPSERT_BATCH));
      }
      for (const id of toRemove) delete manifest[id];
      base.removed = toRemove.length;
    } catch (e) {
      base.errors.push(`remove:${(e as Error).message}`);
    }
  }

  await env.TURN_CACHE.put(MANIFEST_KEY, JSON.stringify(manifest));
  // Record the vocab version this index was built with, so the next rebuild
  // knows whether the catalog vocab changed (→ full re-embed).
  if (canonicalMode) await env.TURN_CACHE.put(VOCAB_VERSION_KEY, vocabVersion);
  base.unchanged = eligible.length - changed.length;
  base.ok = base.errors.length === 0;
  return base;
}
