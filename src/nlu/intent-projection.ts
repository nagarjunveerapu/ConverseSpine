/**
 * The learned metric, applied. ONE place — every INTENT_VECTORS caller goes
 * through here.
 *
 * WHY A PROJECTION AT ALL
 *   `@cf/baai/bge-base-en-v1.5` is a general encoder. On this corpus it RANKS
 *   intents well and SCORES them in far too narrow a band: real buyer turns
 *   whose top-1 intent was correct still landed under tau, so the engine
 *   dropped them to the clarify floor. That is a metric defect. A matrix
 *   fitted on the labelled corpus re-metricises the same vectors — same model,
 *   same embedding call, different geometry.
 *
 * WHY IT IS SAFE
 *   Query-side and index-side MUST live in the same space, and a mismatch does
 *   not throw: cosine still returns numbers, they are just meaningless. Three
 *   things make that mistake hard to make:
 *     1. every caller uses this module — none multiplies its own matrix;
 *     2. the projection only activates when `SIL_INTENT_PROJECTION` names the
 *        matrix's own content hash, so a re-trained matrix does not silently
 *        apply to an index built in the previous space;
 *     3. the Vectorize index name must carry that same id (enforced by
 *        tests/intent-projection-space.test.ts).
 *   Unset the env var and every path reverts to the raw model, exactly.
 */
import type { Env } from '../env.js';
import {
  PROJECTION_B64,
  PROJECTION_ID,
  PROJECTION_IN,
  PROJECTION_MODEL,
  PROJECTION_OUT,
  PROJECTION_TAU,
  PROJECTION_TAU_LOW,
} from './intent-projection-matrix.js';

/** Identity-space thresholds — the values tuned against the raw bge corpus. */
export const IDENTITY_TAU = 0.78;
export const IDENTITY_TAU_LOW = 0.72;

let matrix: Float32Array | null = null;

/** Decode once per isolate; ~400 KB, well under the cold-start budget. */
function getMatrix(): Float32Array {
  if (matrix) return matrix;
  const bin = atob(PROJECTION_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  matrix = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  return matrix;
}

/**
 * True when this deployment is configured for the matrix it actually carries,
 * AND is embedding with the model that matrix was fitted against.
 *
 * The model check matters because the matrix encodes one encoder's geometry.
 * A different 768-wide model would slip past the width guard in
 * projectIntentVector and produce confident nonsense; here it just turns the
 * projection off, which is the safe failure.
 */
export function projectionActive(
  env: Pick<Env, 'SIL_INTENT_PROJECTION' | 'SIL_EMBED_MODEL'>,
): boolean {
  if (env.SIL_INTENT_PROJECTION !== PROJECTION_ID) return false;
  return !env.SIL_EMBED_MODEL || env.SIL_EMBED_MODEL === PROJECTION_MODEL;
}

/** The bind threshold for whichever space this deployment is in. */
export function routingTau(
  env: Pick<Env, 'SIL_INTENT_PROJECTION' | 'SIL_EMBED_MODEL' | 'SIL_ROUTING_TAU'>,
): number {
  const override = Number(env.SIL_ROUTING_TAU);
  if (Number.isFinite(override) && override > 0 && override < 1) return override;
  return projectionActive(env) ? PROJECTION_TAU : IDENTITY_TAU;
}

/**
 * The permissive threshold used by the topic gap-fill paths, which are meant
 * to be hungrier than the primary bind. Coverage-matched to the identity-space
 * 0.72 so those paths keep the appetite they were tuned with.
 */
export function gapFillTau(env: Pick<Env, 'SIL_INTENT_PROJECTION' | 'SIL_EMBED_MODEL'>): number {
  return projectionActive(env) ? PROJECTION_TAU_LOW : IDENTITY_TAU_LOW;
}

/**
 * Identifier for the vector space this deployment reads and writes. The
 * Vectorize index must be built in the SAME space; the manifest and the index
 * name are both keyed on this so a space change forces a rebuild instead of
 * quietly mixing two geometries in one index.
 */
export function intentSpaceId(env: Pick<Env, 'SIL_INTENT_PROJECTION' | 'SIL_EMBED_MODEL'>): string {
  return projectionActive(env) ? PROJECTION_ID : 'identity';
}

/**
 * Map a raw model embedding into the learned space. Returns the input
 * unchanged when the projection is off or the vector is the wrong width —
 * a wrong-width vector means the embed model was swapped without re-fitting,
 * and passing it through untouched keeps the deployment on the raw metric
 * rather than producing confident nonsense.
 */
export function projectIntentVector(
  env: Pick<Env, 'SIL_INTENT_PROJECTION' | 'SIL_EMBED_MODEL'>,
  vector: number[],
): number[] {
  if (!projectionActive(env)) return vector;
  if (vector.length !== PROJECTION_IN) return vector;
  const W = getMatrix();
  const out = new Array<number>(PROJECTION_OUT);
  let sq = 0;
  for (let r = 0; r < PROJECTION_OUT; r++) {
    const base = r * PROJECTION_IN;
    let acc = 0;
    for (let c = 0; c < PROJECTION_IN; c++) acc += W[base + c]! * vector[c]!;
    out[r] = acc;
    sq += acc * acc;
  }
  // L2-normalise so stored and queried vectors match the offline replay the
  // matrix was validated against, whatever the index's own metric does.
  const norm = Math.sqrt(sq) || 1;
  for (let r = 0; r < PROJECTION_OUT; r++) out[r] = out[r]! / norm;
  return out;
}

export { PROJECTION_ID, PROJECTION_IN, PROJECTION_MODEL, PROJECTION_OUT, PROJECTION_TAU };
