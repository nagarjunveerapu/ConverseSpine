"""Re-metricise an EXISTING Vectorize index — project its vectors, keep its rows.

Rebuilding the projected index from the git registry would silently drop
everything the Desk understanding board has taught: the dev index carries
~3,000 vectors beyond the corpus (human-promoted phrasings, auto-taught rows,
legacy seeds), and their source text is not all in the registry.

So do not rebuild — TRANSFORM. Every stored vector is fetched with its values
and metadata, multiplied by the learned projection, re-normalised and written
to the target index under the SAME id and metadata. Same rows, same facets,
new geometry. Nothing taught is lost, and there is only one embedding vintage
in the result because every vector came from one source index.

    python3 scripts/sil-project-existing-index.py \\
        --source naya-intent-phrasings-dev \\
        --target naya-intent-p256-f6665e0b79-full-dev \\
        --vec /tmp/sil --space p256-f6665e0b79
"""
import argparse, json, re, subprocess, sys, tempfile, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

GET_BATCH = 20     # wrangler's documented id cap for get-vectors
UPSERT_BATCH = 2000


def wrangler(args, retries=3):
    err = ""
    for a in range(retries):
        p = subprocess.run(["npx", "wrangler"] + args, capture_output=True, text=True, timeout=300)
        if p.returncode == 0:
            return p.stdout
        err = p.stderr[-300:]
        time.sleep(2 + a * 3)
    raise RuntimeError(f"wrangler failed: {args[:3]} :: {err}")


def list_ids(index):
    ids, cursor = [], None
    while True:
        args = ["vectorize", "list-vectors", index, "--count", "1000", "--json"]
        if cursor:
            args += ["--cursor", cursor]
        data = json.loads(re.search(r"\{.*\}|\[.*\]", wrangler(args), re.S).group(0))
        page = data.get("vectors", data if isinstance(data, list) else [])
        ids.extend(v["id"] if isinstance(v, dict) else v for v in page)
        cursor = data.get("nextCursor") if isinstance(data, dict) else None
        print(f"  listed {len(ids)}", end="\r", flush=True)
        if not cursor or not page:
            break
    print()
    return ids


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", required=True)
    ap.add_argument("--target", required=True)
    ap.add_argument("--vec", required=True, help="dir holding projection.npy")
    ap.add_argument("--space", required=True)
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()

    W = np.load(Path(a.vec) / "projection.npy").astype(np.float64)
    print(f"projection {W.shape}  {a.source} -> {a.target}")

    ids = list_ids(a.source)
    print(f"TOTAL vectors to migrate: {len(ids)}")
    batches = [ids[i : i + GET_BATCH] for i in range(0, len(ids), GET_BATCH)]
    fetched, done = [], 0

    def fetch(batch):
        nonlocal done
        out = wrangler(["vectorize", "get-vectors", a.source, "--ids"] + batch)
        rows = json.loads(re.search(r"\[.*\]", out, re.S).group(0))
        done += 1
        if done % 25 == 0:
            print(f"  fetched {done}/{len(batches)} batches", end="\r", flush=True)
        return rows

    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        for rows in ex.map(fetch, batches):
            fetched.extend(rows)
    print(f"\nfetched {len(fetched)} vectors")

    keep = [r for r in fetched if isinstance(r.get("values"), list) and r["values"]]
    if len(keep) != len(fetched):
        print(f"WARNING: {len(fetched) - len(keep)} rows had no values and are skipped")

    X = np.asarray([r["values"] for r in keep], dtype=np.float64)
    # Accelerate BLAS raises spurious overflow warnings here; assert the property
    # instead of trusting the absence of a warning.
    with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
        X = X / np.maximum(np.linalg.norm(X, axis=1, keepdims=True), 1e-12)
        P = X @ W.T
        P = P / np.maximum(np.linalg.norm(P, axis=1, keepdims=True), 1e-12)
    if not np.isfinite(P).all():
        print("ABORT: projection produced non-finite vectors")
        return 1

    total = 0
    for start in range(0, len(keep), UPSERT_BATCH):
        chunk = keep[start : start + UPSERT_BATCH]
        with tempfile.NamedTemporaryFile("w", suffix=".ndjson", delete=False) as f:
            for j, r in enumerate(chunk):
                md = dict(r.get("metadata") or {})
                md["intent_space"] = a.space
                f.write(json.dumps({
                    "id": r["id"],
                    "values": [round(float(v), 6) for v in P[start + j]],
                    "metadata": md,
                }) + "\n")
            path = f.name
        wrangler(["vectorize", "upsert", a.target, "--file", path])
        total += len(chunk)
        print(f"  upserted {total}/{len(keep)}", flush=True)

    print(f"DONE — {total} projected vectors in {a.target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
