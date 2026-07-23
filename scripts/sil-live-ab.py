"""Live A/B of the learned intent metric — two deployed workers, one variable.

    ctrldev  raw model vectors      index: naya-intent-ident-ctrl-dev
    projdev  learned projection     index: naya-intent-p256-...-dev

Both indexes hold EXACTLY the same 10,646 corpus rows, so the vector space is
the only difference. Both are probed through the engine's own `embedderRouting`
via /api/sil/probe, so this measures the shipped path, not a simulation.

WHY THIS EXISTS AND THE OFFLINE EVAL DOES NOT SUFFICE
    Vectorize does not return exact cosine. Querying a vector against ITSELF by
    id scores ~0.87-0.90, not 1.0 — its stored vectors are lossy. An offline
    numpy replay therefore reports a score distribution the live index will
    never reproduce, for either arm. Only a live A/B settles it.

    python3 scripts/sil-live-ab.py --n 600
"""
import argparse, json, sys, time, urllib.request
from pathlib import Path

ARMS = {
    "baseline": "https://converse-spine-ctrldev.nagarjun-arjun.workers.dev/api/sil/probe",
    "projection": "https://converse-spine-projdev.nagarjun-arjun.workers.dev/api/sil/probe",
}
HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) (sil-live-ab)",
    "Origin": "https://naya-advisor-dev.pages.dev",
}
# Configured bind thresholds per arm — what each deployment actually uses.
TAU = {"baseline": 0.78, "projection": 0.829}

# The graded real turns live in scripts/sil-real-turns.json — the same set the
# offline eval scores, kept in one file so the two measurements cannot drift.


def probe(url, items, retries=4):
    body = json.dumps({"builder_id": "naya-advisor", "items": items}).encode()
    err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=180) as f:
                return json.load(f).get("results", [])
        except Exception as e:
            err = e
            time.sleep(2 + attempt * 4)
    raise RuntimeError(f"probe failed: {err}")


def load_holdout(registry, n, seed=7):
    import random
    rows = []
    for line in open(registry):
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get("eval_split") != "holdout":
            continue
        if r.get("quarantine") or r.get("is_negative") or not r.get("routable"):
            continue
        p, k = (r.get("phrasing") or "").strip(), r.get("intent_kind")
        if p and k:
            rows.append({"text": p, "expected": k})
    random.Random(seed).shuffle(rows)
    return rows[:n]


def summarise(results, tau, gold=None):
    """gold: text -> set of acceptable kinds (real turns). None = use `expected`."""
    n = ok = bound = ok_and_bound = 0
    scored = []
    for r in results:
        if gold is not None:
            acc = gold.get(r["text"])
            if not acc:
                continue
            hit = r.get("top_kind") in acc
        else:
            if not r.get("expected"):
                continue
            hit = r.get("top_kind") == r["expected"]
        s = r.get("top_score") or 0.0
        n += 1
        ok += hit
        b = s >= tau
        bound += b
        ok_and_bound += hit and b
        scored.append((s, hit))
    if not n:
        return {}
    scored.sort(key=lambda x: -x[0])
    curve = []
    cum = 0
    for i, (s, hit) in enumerate(scored, 1):
        cum += hit
        curve.append({"tau": s, "coverage": i / n, "precision": cum / i})
    return {
        "n": n,
        "top1": ok / n,
        "tau": tau,
        "coverage": bound / n,
        "precision_when_bound": (ok_and_bound / bound) if bound else 0.0,
        "correct_and_bound": ok_and_bound / n,
        "curve": curve[:: max(1, len(curve) // 40)],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--registry", default="corpus/intent-registry.jsonl")
    ap.add_argument("--real", default="scripts/sil-real-turns.json")
    ap.add_argument("--n", type=int, default=600)
    ap.add_argument("--out", default="/tmp/sil/live-ab.json")
    a = ap.parse_args()

    holdout = load_holdout(a.registry, a.n)
    real = json.load(open(a.real))
    gold = {t: set(k) for t, k in real.items()}
    print(f"holdout queries: {len(holdout)}   real turns: {len(gold)}")

    report = {}
    for arm, url in ARMS.items():
        hs = []
        for i in range(0, len(holdout), 100):
            hs.extend(probe(url, holdout[i : i + 100]))
            print(f"  {arm} holdout {min(i+100,len(holdout))}/{len(holdout)}", end="\r", flush=True)
        rs = probe(url, [{"text": t} for t in gold])
        print()
        report[arm] = {
            "holdout": summarise(hs, TAU[arm]),
            "real": summarise(rs, TAU[arm], gold),
            "real_rows": [
                {"text": r["text"], "kind": r.get("top_kind"), "score": r.get("top_score"),
                 "gold": sorted(gold[r["text"]]), "ok": r.get("top_kind") in gold[r["text"]],
                 "bound": (r.get("top_score") or 0) >= TAU[arm]}
                for r in rs if r["text"] in gold
            ],
        }
        for which in ("holdout", "real"):
            m = report[arm][which]
            print(f"  {arm:11} {which:8} n={m['n']:4}  top1={m['top1']*100:5.1f}%  "
                  f"tau={m['tau']:.3f} coverage={m['coverage']*100:5.1f}%  "
                  f"precision-when-bound={m['precision_when_bound']*100:5.1f}%  "
                  f"correct&bound={m['correct_and_bound']*100:5.1f}%")

    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    json.dump(report, open(a.out, "w"), indent=1)
    print(f"\nWROTE {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
