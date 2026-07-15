"""Dump id+metadata of every vector in a Vectorize index to JSONL.

Phase 1 registry recovery (SEMANTIC_INTENT_LAYER_LLD §4.1). Vector values are
NOT kept - the registry stores phrasing+labels; embeddings are a build artifact.

Reproducible from any checkout (no hardcoded paths):
    python3 scripts/vectorize-dump-registry.py
    python3 scripts/vectorize-dump-registry.py --index naya-intent-phrasings-dev \
            --out corpus/recovered-raw.jsonl
"""
import argparse, json, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

def wrangler(args, cwd, retries=3):
    err = ""
    for attempt in range(retries):
        p = subprocess.run(["npx", "wrangler"] + args, cwd=cwd,
                           capture_output=True, text=True, timeout=180)
        if p.returncode == 0:
            return p.stdout
        err = p.stderr[-300:]
        time.sleep(2 + attempt * 3)
    raise RuntimeError(f"wrangler failed: {args[:3]} :: {err}")

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--index", default="naya-intent-phrasings-dev")
    ap.add_argument("--out", default="corpus/recovered-raw.jsonl")
    ap.add_argument("--cwd", default=str(Path.cwd()),
                    help="repo root wrangler runs in (needs wrangler.toml)")
    ap.add_argument("--batch", type=int, default=20, help="get-vectors id cap is 20")
    ap.add_argument("--workers", type=int, default=6)
    a = ap.parse_args()

    ids, cursor = [], None
    while True:
        args = ["vectorize", "list-vectors", a.index, "--count", "1000", "--json"]
        if cursor:
            args += ["--cursor", cursor]
        data = json.loads(re.search(r"\{.*\}|\[.*\]", wrangler(args, a.cwd), re.S).group(0))
        page = data.get("vectors", data if isinstance(data, list) else [])
        page_ids = [v["id"] if isinstance(v, dict) else v for v in page]
        ids.extend(page_ids)
        cursor = data.get("nextCursor") if isinstance(data, dict) else None
        print(f"listed {len(ids)} ids", flush=True)
        if not cursor or not page_ids:
            break
    print(f"TOTAL ids: {len(ids)}", flush=True)

    batches = [ids[i:i + a.batch] for i in range(0, len(ids), a.batch)]
    def fetch(batch):
        out = wrangler(["vectorize", "get-vectors", a.index, "--ids"] + batch, a.cwd)
        vecs = json.loads(re.search(r"\[.*\]", out, re.S).group(0))
        return [{"id": v["id"], **(v.get("metadata") or {})} for v in vecs]

    rows = []
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        for i, chunk in enumerate(ex.map(fetch, batches)):
            rows.extend(chunk)
            if (i + 1) % 20 == 0:
                print(f"fetched {len(rows)}/{len(ids)}", flush=True)

    out_path = Path(a.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"WROTE {len(rows)} rows -> {out_path}", flush=True)

if __name__ == "__main__":
    sys.exit(main())
