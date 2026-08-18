"""Export raw intent-corpus embeddings so a better metric can be FITTED offline.

`sil-holdout-eval.py` measures the embedder's verdict. This pulls the vectors
themselves, which is what training a projection needs. Vectorize scores with
cosine over exactly these vectors, so an offline replay of index-vs-query is
faithful — no deploy, no second index, and baseline/candidate see identical data.

    python3 scripts/sil-export-embeddings.py --out /tmp/sil

Writes <out>/vectors.npy (float32 N x D), <out>/meta.json (row labels/splits).
Requires the dev worker deployed with SIL_EVAL_ENABLED=true.
"""
import argparse, base64, json, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

URL = "https://converse-spine-dev.nagarjun-arjun.workers.dev/api/sil/embed"
HEADERS = {
    "Content-Type": "application/json",
    # Cloudflare 403s the default Python-urllib agent.
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) (sil-export)",
    "Origin": "https://naya-advisor-dev.pages.dev",
}


def post(texts, retries=4):
    body = json.dumps({"texts": texts}).encode()
    err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(URL, data=body, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=180) as f:
                return json.load(f)
        except Exception as e:  # transient: connection reset, 5xx, timeout
            err = e
            time.sleep(2 + attempt * 4)
    raise RuntimeError(f"embed batch failed: {err}")


def post_proxy(proxy, model, texts, retries=6):
    """Embed via a local `wrangler dev --remote` proxy instead of the deployed
    worker. The deployed /api/sil/embed always uses the DEPLOYED model; fitting
    a projection for a candidate embedder needs that candidate's vectors, and
    dev deploys from main only — so the proxy is the door for a not-yet-shipped
    model. Response is the raw Workers AI shape (float lists, not base64)."""
    body = json.dumps({"text": texts}).encode()
    err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                f"{proxy}/{model}",
                data=body,
                # Cloudflare 403s the default urllib agent even on the tunnel.
                headers={"Content-Type": "application/json", "User-Agent": "curl/8.7.1"},
            )
            with urllib.request.urlopen(req, timeout=180) as f:
                out = json.load(f)
            r = out["result"]
            vecs = r.get("data") or r.get("response")
            if not vecs or len(vecs) != len(texts):
                raise RuntimeError(f"got {len(vecs or [])} vectors for {len(texts)} texts")
            return vecs
        except Exception as e:
            err = e
            time.sleep(2 + attempt * 4)
    raise RuntimeError(f"proxy embed batch failed: {err}")


def load_rows(registry):
    rows = []
    for line in open(registry):
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        # The index never holds quarantined or negative rows, so neither does
        # the experiment — otherwise the offline replay is not the live index.
        if r.get("quarantine") or r.get("is_negative"):
            continue
        p = (r.get("phrasing") or "").strip()
        k = r.get("intent_kind")
        if not p or not k:
            continue
        rows.append(
            {
                "id": r.get("id"),
                "text": p,
                "kind": k,
                "split": r.get("eval_split") or "train",
                "routable": bool(r.get("routable")),
                "pattern_id": r.get("pattern_id") or "",
                "language": r.get("language") or "",
            }
        )
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--registry", default="corpus/intent-registry.jsonl")
    ap.add_argument("--out", default="/tmp/sil")
    ap.add_argument("--batch", type=int, default=256, help="endpoint caps at 384")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0, help="0 = all rows")
    ap.add_argument("--proxy", default="", help="local Workers-AI proxy base, e.g. http://127.0.0.1:8799")
    ap.add_argument("--model", default="@cf/baai/bge-m3", help="model when --proxy is set")
    a = ap.parse_args()
    if a.proxy:
        a.batch = min(a.batch, 96)  # Workers AI caps embedding batches at 100

    rows = load_rows(a.registry)
    if a.limit:
        rows = rows[: a.limit]
    print(f"rows to embed: {len(rows)}", flush=True)

    batches = [rows[i : i + a.batch] for i in range(0, len(rows), a.batch)]
    vecs = [None] * len(batches)
    model = dims = None
    done = 0

    def run(ix):
        nonlocal model, dims, done
        texts = [r["text"] for r in batches[ix]]
        if a.proxy:
            floats = post_proxy(a.proxy, a.model, texts)
            model, dims = a.model, len(floats[0])
            arr = np.array(floats, dtype=np.float32)
        else:
            out = post(texts)
            model, dims = out.get("model"), out.get("dims")
            arr = np.zeros((len(texts), dims), dtype=np.float32)
            for j, b64 in enumerate(out.get("vectors") or []):
                if b64:
                    arr[j] = np.frombuffer(base64.b64decode(b64), dtype="<f4")
        vecs[ix] = arr
        done += 1
        print(f"  {done}/{len(batches)} batches", end="\r", flush=True)

    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        list(ex.map(run, range(len(batches))))
    print()

    X = np.vstack(vecs)
    empty = int((np.linalg.norm(X, axis=1) == 0).sum())
    outdir = Path(a.out)
    outdir.mkdir(parents=True, exist_ok=True)
    np.save(outdir / "vectors.npy", X)
    json.dump({"model": model, "dims": dims, "rows": rows}, open(outdir / "meta.json", "w"))
    print(f"model={model} dims={dims} shape={X.shape} empty_vectors={empty}")
    print(f"WROTE {outdir}/vectors.npy + meta.json")
    if empty:
        print("WARNING: some rows failed to embed; re-run before trusting metrics")
    return 0


if __name__ == "__main__":
    sys.exit(main())
