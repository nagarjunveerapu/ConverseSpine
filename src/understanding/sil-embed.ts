/**
 * Raw-vector dump — the export side of the intent-embedding experiment.
 *
 * `runSilProbe` answers "what does the embedder decide?". This answers "what
 * does the embedder SEE?", by handing back the vectors themselves. That is the
 * difference between measuring the current metric and being able to LEARN a
 * better one: a projection can only be fitted offline against real vectors.
 *
 * Uses the same `env.SIL_EMBED_MODEL` as the index rebuild and the live query,
 * so an export is always in the space it will be applied to. Vectors come back
 * base64 little-endian float32 — 4 bytes/dim instead of ~20 as JSON numbers,
 * which is the difference between a 40MB and a 200MB corpus export.
 *
 * Measurement only, dev-gated (`SIL_EVAL_ENABLED`). It never affects a turn.
 */
import type { Env } from '../env.js';

const DEFAULT_EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
/** Workers AI text-array headroom — same figure the rebuild embeds at. */
const EMBED_BATCH = 96;

export interface SilEmbedResult {
  model: string;
  dims: number;
  /** One base64 float32 blob per input text, index-aligned. '' = embed failed. */
  vectors: string[];
}

function toBase64(vec: number[]): string {
  const f32 = new Float32Array(vec);
  const bytes = new Uint8Array(f32.buffer);
  let s = '';
  // Chunked: String.fromCharCode(...bytes) on a 3KB spread is fine, but this
  // stays safe if a larger model (1024d+) is swapped in via SIL_EMBED_MODEL.
  const CHUNK = 1024;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export async function runSilEmbed(
  env: Pick<Env, 'AI' | 'SIL_EMBED_MODEL'>,
  texts: string[],
): Promise<SilEmbedResult> {
  const model = env.SIL_EMBED_MODEL || DEFAULT_EMBED_MODEL;
  const vectors: string[] = new Array(texts.length).fill('');
  let dims = 0;
  if (!env.AI) return { model, dims, vectors };

  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    try {
      const out = (await env.AI.run(model as never, { text: batch })) as { data?: number[][] };
      const data = out.data ?? [];
      for (let j = 0; j < batch.length; j++) {
        const v = data[j];
        if (!v) continue;
        dims = v.length;
        vectors[i + j] = toBase64(v);
      }
    } catch {
      // Leave this batch's slots empty — the caller retries by text, and a
      // partial export is more useful than a failed one.
    }
  }
  return { model, dims, vectors };
}
