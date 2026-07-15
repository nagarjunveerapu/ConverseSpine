"""Dump id+metadata of every vector in naya-intent-phrasings-dev to JSONL.

Phase 1 registry recovery (SEMANTIC_INTENT_LAYER_LLD 4.1). Vector values are
NOT kept - the registry stores phrasing+labels; embeddings are a build artifact.
"""
import json, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

CWD = "/Users/arjun/Nayaworkspace/ConverseSpine-holds"
INDEX = "naya-intent-phrasings-dev"
OUT = "/private/tmp/claude-501/-Users-arjun-Nayaworkspace-NayaDesk/b05c466b-73c1-414e-99de-c606a5768b41/scratchpad/intent-registry-dump.jsonl"

def wrangler(args, retries=3):
    for attempt in range(retries):
        p = subprocess.run(["npx", "wrangler"] + args, cwd=CWD, capture_output=True, text=True, timeout=180)
        if p.returncode == 0:
            return p.stdout
        time.sleep(2 + attempt * 3)
    raise RuntimeError(f"wrangler failed: {args[:3]} :: {p.stderr[-300:]}")

# -- 1. collect all ids ------------------------------------------------------
ids, cursor = [], None
while True:
    args = ["vectorize", "list-vectors", INDEX, "--count", "1000", "--json"]
    if cursor:
        args += ["--cursor", cursor]
    out = wrangler(args)
    m = re.search(r"\{.*\}|\[.*\]", out, re.S)
    data = json.loads(m.group(0))
    page = data.get("vectors", data if isinstance(data, list) else [])
    page_ids = [v["id"] if isinstance(v, dict) else v for v in page]
    ids.extend(page_ids)
    cursor = data.get("nextCursor") if isinstance(data, dict) else None
    print(f"listed {len(ids)} ids", flush=True)
    if not cursor or not page_ids:
        break
print(f"TOTAL ids: {len(ids)}", flush=True)

# -- 2. fetch metadata in batches --------------------------------------------
BATCH = 20  # API hard cap (code 40007: max id count is 20)
batches = [ids[i:i + BATCH] for i in range(0, len(ids), BATCH)]

def fetch(batch):
    out = wrangler(["vectorize", "get-vectors", INDEX, "--ids"] + batch)
    m = re.search(r"\[.*\]", out, re.S)
    vecs = json.loads(m.group(0))
    return [{"id": v["id"], **(v.get("metadata") or {})} for v in vecs]

rows, done = [], 0
with ThreadPoolExecutor(max_workers=6) as ex:
    for chunk in ex.map(fetch, batches):
        rows.extend(chunk)
        done += 1
        if done % 20 == 0:
            print(f"fetched {len(rows)}/{len(ids)}", flush=True)

with open(OUT, "w") as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
print(f"WROTE {len(rows)} rows -> {OUT}", flush=True)
