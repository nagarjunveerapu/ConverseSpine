"""Emit the trained projection as a TypeScript module the Worker can carry.

The matrix is the model. At rank 64 it is 64 x 768 float32 = 196 KB, which
bundles comfortably and needs no KV read, no R2 fetch and no cold-start
penalty -- the Worker decodes it once per isolate and multiplies.

The emitted PROJECTION_ID is a content hash. It is not decoration: the Worker
refuses to project unless env.SIL_INTENT_PROJECTION names this exact id, and
the Vectorize index name must carry it too, so a re-trained matrix can never
silently query an index built in the previous space.

    python3 scripts/sil-emit-projection.py --vec /tmp/sil
"""
import argparse, base64, hashlib, json, sys
from pathlib import Path

import numpy as np

TEMPLATE = '''/**
 * GENERATED FILE -- do not edit by hand.
 *   python3 scripts/sil-emit-projection.py --vec <dir>
 *
 * A learned metric over the intent embedding: `{rows} x {cols}` float32, fitted on
 * {train_rows} labelled corpus rows by scripts/sil-train-projection.py.
 *
 * `@cf/baai/bge-base-en-v1.5` ranks this corpus well but scores it in too
 * narrow a band for a fixed tau to mean anything. This matrix re-metricises
 * the SAME vectors so same-intent phrasings pull together and different
 * intents push apart. Workers AI cannot serve a fine-tuned embedding model;
 * it does not have to -- this is a matrix multiply the Worker does itself.
 *
 * Source model : {model}
 * Fitted       : shrink={shrink} alpha={alpha} eps={eps} rank={rank}
 *
 * THRESHOLDS ARE SPACE-SPECIFIC, AND MUST BE CALIBRATED LIVE.
 *
 * The identity-space values (0.78 bind, 0.72 gap-fill) do not transfer here.
 * Neither do thresholds calibrated offline: Vectorize does NOT return exact
 * cosine — query a vector against its own id and it scores ~0.87-0.90, not
 * 1.0 — so an offline numpy replay reports a score range the live index never
 * reproduces. Calibrating on the replay set tau far too high and the projected
 * arm bound almost nothing (15% holdout coverage) until it was re-measured
 * against the deployed index.
 *
 * Both numbers below come from scripts/sil-live-ab.py, probing the real worker:
 *   PROJECTION_TAU     = {tau:.4f}  primary bind. Set where LIVE holdout precision
 *                                equals what the raw model delivers at its own
 *                                0.78 — equal precision, so coverage is the
 *                                honest comparison.
 *   PROJECTION_TAU_LOW = {tau_low:.4f}  permissive gap-fill. Coverage-matched to what
 *                                0.72 reaches live in identity space, so those
 *                                paths keep the appetite they were tuned with.
 *
 * Re-training the matrix invalidates both. Re-run the live A/B, do not guess.
 */
export const PROJECTION_ID = '{pid}';
export const PROJECTION_IN = {cols};
export const PROJECTION_OUT = {rows};
export const PROJECTION_MODEL = '{model}';
export const PROJECTION_TAU = {tau:.4f};
export const PROJECTION_TAU_LOW = {tau_low:.4f};
/** Row-major float32, little-endian, base64. */
export const PROJECTION_B64 =
  '{b64}';
'''


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--vec", default="/tmp/sil")
    ap.add_argument("--out", default="src/nlu/intent-projection-matrix.ts")
    # Both measured by sil-eval-projection.py on the frozen holdout. They are
    # arguments rather than derived here so the emitted matrix always carries
    # thresholds someone actually measured, never a default nobody checked.
    ap.add_argument("--tau", type=float, required=True, help="primary bind (95% holdout precision)")
    ap.add_argument("--tau-low", type=float, required=True, help="gap-fill (coverage-matched to 0.72)")
    a = ap.parse_args()

    W = np.load(Path(a.vec) / "projection.npy").astype(np.float32)
    meta = json.load(open(Path(a.vec) / "projection-meta.json"))
    raw = W.tobytes(order="C")
    b64 = base64.b64encode(raw).decode()
    pid = "p" + str(W.shape[0]) + "-" + hashlib.sha256(raw).hexdigest()[:10]

    src = TEMPLATE.format(
        rows=W.shape[0], cols=W.shape[1], pid=pid, b64=b64,
        model=meta.get("model"), tau=a.tau, tau_low=a.tau_low,
        shrink=meta["shrink"], alpha=meta["alpha"], eps=meta["eps"],
        rank=meta["rank"], train_rows=meta.get("train_rows"),
    )
    Path(a.out).write_text(src)
    print(f"WROTE {a.out}")
    print(f"  PROJECTION_ID = {pid}")
    print(f"  shape={W.shape}  {len(raw)/1024:.0f} KB raw / {len(b64)/1024:.0f} KB base64")
    print(f"  tau = {a.tau:.4f}  tau_low = {a.tau_low:.4f}")
    print("\nNEXT: the Vectorize index must be REBUILT in this space, and its")
    print(f"      name must contain '{pid}' for the config guard to pass.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
