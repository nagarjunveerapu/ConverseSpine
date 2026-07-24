/**
 * Dedicated buyer-education Vectorize rebuild.
 *
 * Source of truth: NayaDesk GET /api/buyer-education/corpus (approved entries).
 * NOT INTENT_VECTORS — content edits must not perturb the 33-kind routing space.
 */
import type { Env } from '../env.js';
import { NayaDeskClient } from '../crm/nayadesk-client.js';

const DEFAULT_MODEL = '@cf/baai/bge-base-en-v1.5';
const MANIFEST_KEY = 'edu:manifest:v1';
const EMBED_BATCH = 96;
const UPSERT_BATCH = 500;
const EDUCATION_TAU = 0.72;

export interface EducationCorpusEntry {
  entry_id: string;
  topic_key: string;
  jurisdiction: 'india' | 'karnataka';
  domain?: string;
  canonical_question: string;
  approved_answer: string;
  what_to_check?: string;
  disclaimer?: string;
  examples?: Array<{ example_id: string; phrasing: string; language?: string }>;
}

export interface EducationRebuildReport {
  ok: boolean;
  model: string;
  source_entries: number;
  pushed: number;
  removed: number;
  errors: string[];
  reason?: string;
}

function contentHash(id: string, text: string): string {
  // Cheap stable fingerprint — enough for incremental rebuilds.
  let h = 0;
  const s = `${id}\n${text}`;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `${h}`;
}

export async function rebuildEducationIndex(env: Env): Promise<EducationRebuildReport> {
  const model = env.SIL_EMBED_MODEL || DEFAULT_MODEL;
  const base: EducationRebuildReport = {
    ok: false,
    model,
    source_entries: 0,
    pushed: 0,
    removed: 0,
    errors: [],
  };
  if (!env.AI || !env.EDUCATION_VECTORS || !env.TURN_CACHE) {
    return { ...base, reason: 'missing_bindings' };
  }

  let entries: EducationCorpusEntry[];
  try {
    const desk = await new NayaDeskClient(env).buyerEducationCorpus();
    entries = desk.entries ?? [];
  } catch (e) {
    return { ...base, reason: `corpus_fetch:${(e as Error).message}` };
  }
  base.source_entries = entries.length;

  type Row = { id: string; text: string; meta: Record<string, string | number | boolean> };
  const rows: Row[] = [];
  for (const e of entries) {
    const texts = [
      e.canonical_question,
      ...(e.examples ?? []).map((x) => x.phrasing),
    ].filter((t) => t.trim());
    texts.forEach((text, i) => {
      const id = `${e.entry_id}:${i}`;
      rows.push({
        id,
        text,
        meta: {
          entry_id: e.entry_id,
          topic_key: e.topic_key,
          jurisdiction: e.jurisdiction,
          domain: e.domain ?? '',
          language: 'en',
        },
      });
    });
  }

  const manifest: Record<string, string> = JSON.parse((await env.TURN_CACHE.get(MANIFEST_KEY)) || '{}');
  const eligibleIds = new Set(rows.map((r) => r.id));
  const changed = rows.filter((r) => manifest[r.id] !== contentHash(r.id, r.text));
  const toRemove = Object.keys(manifest).filter((id) => !eligibleIds.has(id));

  for (let i = 0; i < changed.length; i += EMBED_BATCH) {
    const batch = changed.slice(i, i + EMBED_BATCH);
    try {
      const out = (await env.AI.run(model as never, {
        text: batch.map((r) => r.text),
      })) as { data?: number[][] };
      const vecs = out.data ?? [];
      const upserts = batch
        .map((r, j) => ({
          id: r.id,
          values: vecs[j],
          metadata: r.meta,
        }))
        .filter((u) => Array.isArray(u.values) && u.values.length > 0);
      for (let k = 0; k < upserts.length; k += UPSERT_BATCH) {
        await env.EDUCATION_VECTORS.upsert(upserts.slice(k, k + UPSERT_BATCH) as never);
      }
      for (const r of batch) manifest[r.id] = contentHash(r.id, r.text);
      base.pushed += upserts.length;
    } catch (e) {
      base.errors.push(`embed_batch_${i}:${(e as Error).message}`);
    }
  }

  if (toRemove.length) {
    try {
      for (let k = 0; k < toRemove.length; k += UPSERT_BATCH) {
        await env.EDUCATION_VECTORS.deleteByIds(toRemove.slice(k, k + UPSERT_BATCH));
      }
      for (const id of toRemove) delete manifest[id];
      base.removed = toRemove.length;
    } catch (e) {
      base.errors.push(`remove:${(e as Error).message}`);
    }
  }

  await env.TURN_CACHE.put(MANIFEST_KEY, JSON.stringify(manifest));
  base.ok = base.errors.length === 0;
  return base;
}

export { EDUCATION_TAU };
