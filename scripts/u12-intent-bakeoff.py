#!/usr/bin/env python3
"""U12 second half — which embedder recognises buyer INTENT most clearly?

The name bake-off (u12-embed-bakeoff.py) measured project-name binding. This
measures the other job riding the same embedder: classifying what the buyer
WANTS (get_price, book_visit, negotiate_price, ...) — the SIL lane.

MECHANICS mirror production: corpus phrasings are embedded into an index, an
incoming message is embedded and the nearest phrasing's intent wins (Vectorize
topK behaviour). Split is deterministic (hash-sorted stride), no randomness.

  margin = (best score of winning intent − best score of any OTHER intent)
           / best score           — same scale-free separation as the name test.

THE HARD-NEGATIVE BATTERY is the sharpest edge: 94 corpus rows written to be
mistaken for a neighbouring intent ("yes, Saturday 12pm works fine" is a
confirm_action that smells like book_visit; a request_callback that smells like
book_visit). Each carries its true label AND the trap label, so we can score
not just wrong/right but fell-in-the-trap-it-was-built-for.

CAVEAT the production lane adds a learned projection (p256) trained per-space,
plus tau gating. This measures the raw geometry each model hands that machinery
— the floor, not the shipped ceiling.

USAGE
  python3 scripts/u12-intent-bakeoff.py --proxy http://127.0.0.1:8799 \
      --corpus corpus/recovered-raw.jsonl --out intent-bakeoff.json \
      --models @cf/baai/bge-base-en-v1.5,@cf/baai/bge-m3
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import urllib.request

INDEX_PER_INTENT = 40
QUERIES_PER_INTENT = 10


def embed(proxy: str, model: str, texts: list[str], batch: int = 96) -> list[list[float]]:
    out: list[list[float]] = []
    for i in range(0, len(texts), batch):
        req = urllib.request.Request(
            f"{proxy}/{model}",
            data=json.dumps({"text": texts[i : i + batch]}).encode(),
            headers={"content-type": "application/json", "user-agent": "curl/8.7.1"},
        )
        body = json.loads(urllib.request.urlopen(req, timeout=180).read())
        r = body["result"]
        out.extend(r.get("data") or r.get("response"))
        print(f"    {model}  {min(i + batch, len(texts))}/{len(texts)}", file=sys.stderr)
    return [norm(v) for v in out]


def norm(v: list[float]) -> list[float]:
    m = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / m for x in v]


def stable_sorted(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda r: hashlib.md5(r["phrasing"].encode()).hexdigest())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--proxy", required=True)
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--out", default="intent-bakeoff.json")
    ap.add_argument("--models", required=True, help="comma-separated Workers AI models")
    args = ap.parse_args()

    rows = [json.loads(l) for l in open(args.corpus, encoding="utf-8") if l.strip()]
    pos = [r for r in rows if not r.get("is_negative")]
    hard = [
        r
        for r in rows
        if r.get("is_negative") and r.get("hard_negative_for")
        # A trap for its own true intent is corpus noise, not a trap.
        and r["hard_negative_for"] != r["intent_kind"]
    ]

    by_intent: dict[str, list[dict]] = {}
    for r in pos:
        by_intent.setdefault(r["intent_kind"], []).append(r)

    index_rows: list[dict] = []
    query_rows: list[dict] = []
    for kind, members in sorted(by_intent.items()):
        members = stable_sorted(members)
        if len(members) < 2:  # cannot both index and query this intent
            continue
        q_n = min(QUERIES_PER_INTENT, max(1, len(members) // 5))
        query_rows.extend(members[:q_n])
        index_rows.extend(members[q_n : q_n + INDEX_PER_INTENT])

    print(
        f"{len(by_intent)} intents · index {len(index_rows)} · "
        f"queries {len(query_rows)} · hard negatives {len(hard)}",
        file=sys.stderr,
    )

    results = []
    for model in filter(None, (s.strip() for s in args.models.split(","))):
        print(f"── {model}", file=sys.stderr)
        doc_v = embed(args.proxy, model, [r["phrasing"] for r in index_rows])
        docs = list(zip(doc_v, [r["intent_kind"] for r in index_rows]))

        def classify(vec: list[float]) -> tuple[str, float]:
            best: dict[str, float] = {}
            for dv, kind in docs:
                s = sum(a * b for a, b in zip(vec, dv))
                if s > best.get(kind, -2.0):
                    best[kind] = s
            ranked = sorted(best.items(), key=lambda kv: -kv[1])
            (k1, s1), s2 = ranked[0], ranked[1][1]
            return k1, (s1 - s2) / s1 if s1 else 0.0

        arm_rows = []
        for r, qv in zip(query_rows, embed(args.proxy, model, [r["phrasing"] for r in query_rows])):
            pred, margin = classify(qv)
            arm_rows.append(
                {
                    "text": r["phrasing"],
                    "gold": r["intent_kind"],
                    "lang": r.get("language"),
                    "pred": pred,
                    "hit": pred == r["intent_kind"],
                    "margin": margin,
                }
            )

        trap_rows = []
        for r, qv in zip(hard, embed(args.proxy, model, [r["phrasing"] for r in hard])):
            pred, margin = classify(qv)
            trap_rows.append(
                {
                    "text": r["phrasing"],
                    "gold": r["intent_kind"],
                    "trap": r["hard_negative_for"],
                    "pred": pred,
                    "hit": pred == r["intent_kind"],
                    "fell_in_trap": pred == r["hard_negative_for"],
                    "margin": margin,
                }
            )

        acc = sum(r["hit"] for r in arm_rows) / len(arm_rows)
        margins = sorted(r["margin"] for r in arm_rows if r["hit"])
        trap_acc = sum(r["hit"] for r in trap_rows) / len(trap_rows)
        trapped = sum(r["fell_in_trap"] for r in trap_rows) / len(trap_rows)
        results.append(
            {
                "model": model,
                "acc": acc,
                "mean_margin": sum(margins) / len(margins) if margins else 0.0,
                "trap_acc": trap_acc,
                "trapped": trapped,
                "rows": arm_rows,
                "traps": trap_rows,
            }
        )

    json.dump(results, open(args.out, "w"), indent=1)
    w = max(len(r["model"]) for r in results)
    print(f"\n{'model':<{w}}  {'acc@1':>6} {'margin':>7} {'trap-acc':>9} {'fell-in-trap':>13}")
    for r in results:
        print(
            f"{r['model']:<{w}}  {r['acc']:>6.3f} {r['mean_margin']:>7.3f} "
            f"{r['trap_acc']:>9.3f} {r['trapped']:>13.3f}"
        )
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
