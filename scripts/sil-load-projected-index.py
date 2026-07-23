"""Load the projected corpus into its Vectorize index.

Uses the SAME exported vectors the projection was fitted and evaluated on, so
the live index is byte-for-byte the offline experiment rather than a re-embed
that might differ. That makes the live probe a real check of the offline
numbers instead of a second, differently-shaped measurement.

Only `train` rows are loaded. The `holdout` split is never indexed — that is
what keeps it a holdout, live and offline alike.

    python3 scripts/sil-load-projected-index.py --vec /tmp/sil \\
        --index naya-intent-p256-f6665e0b79-dev --space p256-f6665e0b79
"""
import argparse, json, subprocess, sys, tempfile
from pathlib import Path

import numpy as np

BATCH = 5000  # wrangler insert takes an NDJSON file; keep each one modest


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--vec", default="/tmp/sil")
    ap.add_argument("--index", required=True)
    ap.add_argument("--space", required=True, help="PROJECTION_ID, stamped on every row")
    ap.add_argument("--model", default="@cf/baai/bge-base-en-v1.5")
    ap.add_argument("--dry-run", action="store_true")
    # Load the SAME rows without projecting, to build the A/B control. Comparing
    # against the existing dev index would confound the metric with a different,
    # older set of vectors; this way the space is the only variable.
    ap.add_argument("--identity", action="store_true", help="skip the projection")
    a = ap.parse_args()

    X = np.load(Path(a.vec) / "vectors.npy").astype(np.float64)
    X = X / np.maximum(np.linalg.norm(X, axis=1, keepdims=True), 1e-12)
    W = np.load(Path(a.vec) / "projection.npy").astype(np.float64)
    meta = json.load(open(Path(a.vec) / "meta.json"))
    rows = meta["rows"]

    keep = [i for i, r in enumerate(rows) if r["split"] == "train"]
    # Apple's Accelerate BLAS raises spurious overflow/invalid warnings on this
    # matmul even when every result is finite (W maxes around 56, X around 0.4).
    # Suppress the noise, then ASSERT the property the warning was pretending
    # to be about -- silencing a warning without checking is how corrupt
    # vectors get indexed.
    with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
        P = X[keep] if a.identity else X[keep] @ W.T
        P = P / np.maximum(np.linalg.norm(P, axis=1, keepdims=True), 1e-12)
    if not np.isfinite(P).all():
        print("ABORT: projection produced non-finite vectors; refusing to index")
        return 1
    print(f"projecting {len(keep)} train rows -> {P.shape[1]} dims for index {a.index}")

    total = 0
    for start in range(0, len(keep), BATCH):
        chunk = keep[start : start + BATCH]
        with tempfile.NamedTemporaryFile("w", suffix=".ndjson", delete=False) as f:
            for j, i in enumerate(chunk):
                r = rows[i]
                f.write(json.dumps({
                    "id": r["id"],
                    "values": [round(float(v), 6) for v in P[start + j]],
                    "metadata": {
                        "intent_kind": r["kind"],
                        "language": r["language"] or "en",
                        "is_negative": False,
                        "embed_model": a.model,
                        "intent_space": a.space,
                    },
                }) + "\n")
            path = f.name
        if a.dry_run:
            print(f"  dry-run: would insert {len(chunk)} from {path}")
            continue
        p = subprocess.run(
            ["npx", "wrangler", "vectorize", "insert", a.index, "--file", path],
            capture_output=True, text=True, timeout=900,
        )
        if p.returncode != 0:
            print(f"  FAILED at {start}: {p.stderr[-400:]}")
            return 1
        total += len(chunk)
        print(f"  inserted {total}/{len(keep)}", flush=True)

    print(f"DONE — {total} vectors in {a.index}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
