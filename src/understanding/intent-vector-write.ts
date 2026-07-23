/**
 * The ONE writer to the intent vector index.
 *
 * Desk owns the truth — which phrasing means which intent, and the facet a
 * human attached. ConverseSpine owns the GEOMETRY — the embedding model, the
 * learned projection, and therefore which index those vectors belong in.
 *
 * Before this existed, Desk embedded and upserted into Vectorize itself. That
 * was fine while both sides used one raw 768-dim space, and broke the moment
 * the bot moved to the projected space: Desk kept writing 768-dim raw vectors
 * into an index the bot no longer read. Teaching still "succeeded" — the write
 * was valid, just invisible. Silent, which is the worst kind.
 *
 * Handing Desk a copy of the projection matrix would have fixed the symptom and
 * created two owners of one vector space, guaranteed to drift on the next
 * retrain. So instead Desk sends TEXT and labels; everything vector-shaped
 * happens here, once, in whatever space this deployment is configured for.
 *
 * Teaching stays instant: this is a synchronous upsert on the promote call, not
 * a queue or a nightly rebuild.
 */
import type { Env } from '../env.js';
import { intentSpaceId, projectIntentVector } from '../nlu/intent-projection.js';

const DEFAULT_EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
/** Workers AI text-array headroom — same figure the rebuild embeds at. */
const EMBED_BATCH = 96;

export interface IntentVectorItem {
  id: string;
  text: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface IntentVectorWriteResult {
  ok: boolean;
  written: number;
  space: string;
  model: string;
  errors: string[];
}

export async function upsertIntentVectors(
  env: Env,
  items: IntentVectorItem[],
): Promise<IntentVectorWriteResult> {
  const model = env.SIL_EMBED_MODEL || DEFAULT_EMBED_MODEL;
  const space = intentSpaceId(env);
  const base: IntentVectorWriteResult = { ok: false, written: 0, space, model, errors: [] };
  if (!env.AI || !env.INTENT_VECTORS) {
    return { ...base, errors: ['missing_bindings'] };
  }
  const clean = items.filter((i) => i.id && typeof i.text === 'string' && i.text.trim());
  if (!clean.length) return { ...base, ok: true };

  let written = 0;
  const errors: string[] = [];
  for (let i = 0; i < clean.length; i += EMBED_BATCH) {
    const batch = clean.slice(i, i + EMBED_BATCH);
    try {
      const out = (await env.AI.run(model as never, {
        text: batch.map((b) => b.text.trim()),
      })) as { data?: number[][] };
      const vecs = out.data ?? [];
      const upserts = batch
        .map((b, j) => {
          const raw = vecs[j];
          if (!raw) return null;
          return {
            id: b.id,
            // Same projection the live query applies. This is the whole point
            // of routing the write through here.
            values: projectIntentVector(env, raw),
            metadata: { ...(b.metadata ?? {}), intent_space: space },
          };
        })
        .filter((u): u is NonNullable<typeof u> => u !== null);
      if (upserts.length) {
        await env.INTENT_VECTORS.upsert(upserts as never);
        written += upserts.length;
      }
    } catch (e) {
      errors.push(`batch_${i}:${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}`);
    }
  }
  return { ok: errors.length === 0, written, space, model, errors };
}

export async function deleteIntentVectors(
  env: Env,
  ids: string[],
): Promise<IntentVectorWriteResult> {
  const space = intentSpaceId(env);
  const model = env.SIL_EMBED_MODEL || DEFAULT_EMBED_MODEL;
  const base: IntentVectorWriteResult = { ok: false, written: 0, space, model, errors: [] };
  if (!env.INTENT_VECTORS) return { ...base, errors: ['missing_bindings'] };
  const clean = ids.filter(Boolean);
  if (!clean.length) return { ...base, ok: true };
  try {
    await env.INTENT_VECTORS.deleteByIds(clean);
    return { ...base, ok: true, written: clean.length };
  } catch (e) {
    return { ...base, errors: [e instanceof Error ? e.message.slice(0, 120) : 'unknown'] };
  }
}
