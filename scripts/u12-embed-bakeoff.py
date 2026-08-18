#!/usr/bin/env python3
"""
U12 — bake off @cf/baai/bge-m3 against the deployed @cf/baai/bge-base-en-v1.5.

Not a swap. m3 has 1024 dims to bge-base's 768, so adopting it means a new
Vectorize index, a full re-embed, and refitting the learned projection
`p256-f6665e0b79`, which was fitted to the current space. That price is only
worth paying if m3 is measurably better at the thing we actually fail at:
recognising a project name written the way buyers write it.

WHAT IS MEASURED
  Ranking, never raw cosine. The two models put their scores on different
  scales, so an absolute threshold tuned on one says nothing about the other —
  the same lesson U8/U9 learned about tau (see `vectorize-scores-are-lossy`).
  Every number below is either accuracy@1 or a margin, both scale-free.

  margin = (top1 - top2) / top1   — separation inside ONE model's ranking.

FAIRNESS
  bge-base-en-v1.5 is documented to want a query prefix ("Represent this
  sentence for searching relevant passages: "); m3 does not. Production uses
  NO prefix (every DEFAULT_EMBED_MODEL site passes raw text). So bge-base is
  run BOTH ways — as-deployed and best-practice — and the better of the two is
  what m3 has to beat. Handicapping the incumbent would make the result
  worthless.

CORPUS
  31 real dev projects (QA fixtures like `[tj:...]`, `qa260809`, `vfy4sfmb`
  excluded — they are test pollution, not catalog). Queries are CONSTRUCTED
  variant families, stated plainly because the ledger cannot supply ground
  truth: it records `also tell me about krishnaja greens` as binding *ayana*,
  a known wrong bind. Negatives ARE real ledger utterances.

  `translit` IS EXCLUDED FROM THE VERDICT — read this before trusting it.
  The family (project names in Devanagari/Kannada) is where bge-base collapses
  to 0.21 against m3's 1.00, and on the first read it carried the whole result.
  It does not describe anyone. Measured 17 Aug 2026:

      corpus/recovered-raw.jsonl   13,555 rows   ZERO Devanagari, ZERO Kannada
                                                 (the 4,119 rows tagged `hi-en`
                                                 are Hinglish in LATIN script —
                                                 "konsa better", "kaun better hai")
      turn_ledger (dev)            43,530 turns  46 Indic, every one of them from
                                                 the stress harness: top phone is
                                                 literally `+9190stress2026`

  Zero organic Indic buyers. The family was kept in the harness because the day
  a tenant serves buyers who type that way it is the measurement already built —
  but it must never be counted toward an adoption decision until such a buyer
  exists. Real code-mixing also has a different SHAPE than this family assumes:
  the 12 Indic turns carrying Latin text keep the project NAME in Latin and
  write the QUESTION in Indic ("ಒಂದು ಪ್ರಶ್ನೆ: brochure ಕಳುಹಿಸಿ"), which is a
  load on the intent lane, not on name retrieval — the thing this script scores.

  The verdict therefore rests on the five remaining families plus the real
  negatives. See docs/reports/u12-embed-bakeoff.html.

USAGE
  npx wrangler dev --remote     # in a worker with an [ai] binding
  python3 scripts/u12-embed-bakeoff.py --proxy http://127.0.0.1:8799
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.error
import urllib.request

BASE = "@cf/baai/bge-base-en-v1.5"
M3 = "@cf/baai/bge-m3"
BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "

# Real dev catalog, QA fixtures removed.
PROJECTS: list[tuple[str, str]] = [
    ("brigade-group", "Brigade 7 Gardens"),
    ("brigade-group", "Brigade Atmosphere"),
    ("brigade-group", "Brigade Avalon"),
    ("brigade-group", "Brigade Buena Vista"),
    ("brigade-group", "Brigade Calista"),
    ("brigade-group", "Brigade Cornerstone"),
    ("brigade-group", "Brigade Cornerstone Utopia"),
    ("brigade-group", "Brigade Eldorado"),
    ("brigade-group", "Brigade Eternia"),
    ("brigade-group", "Brigade Meadows"),
    ("brigade-group", "Brigade Northridge Neo"),
    ("brigade-group", "Brigade Oasis"),
    ("brigade-group", "Brigade Orchards"),
    ("brigade-group", "Brigade Sanctuary"),
    ("brigade-group", "HV Alder Court"),
    ("brigade-group", "HV Birch Lane"),
    ("brigade-group", "HV Cedar Rise"),
    ("brigade-group", "HV Dogwood Park"),
    ("brigade-group", "HV Echo Twin"),
    ("brigade-group", "Purva Palmbeach"),
    ("brigade-group", "Skyview"),
    ("lokations", "Ayana"),
    ("lokations", "Century Breeze"),
    ("lokations", "Clarks Exotica"),
    ("lokations", "Desire Spaces"),
    ("lokations", "Earth Aroma"),
    ("lokations", "Hillside County"),
    ("lokations", "Krishnaja Greens"),
    ("lokations", "My-Sooru"),
    ("lokations", "Vanam"),
    ("lokations", "Viva Greens"),
]

# Curated transliterations — only for names I can render responsibly. A bad
# transliteration would measure my Devanagari, not the model.
TRANSLIT: dict[str, list[str]] = {
    "Brigade Cornerstone": ["ब्रिगेड कॉर्नरस्टोन", "ಬ್ರಿಗೇಡ್ ಕಾರ್ನರ್‌ಸ್ಟೋನ್"],
    "Brigade Eldorado": ["ब्रिगेड एल्डोरैडो", "ಬ್ರಿಗೇಡ್ ಎಲ್ಡೊರಾಡೊ"],
    "Brigade Orchards": ["ब्रिगेड ऑर्चर्ड्स", "ಬ್ರಿಗೇಡ್ ಆರ್ಚರ್ಡ್ಸ್"],
    "Brigade Meadows": ["ब्रिगेड मीडोज"],
    "Ayana": ["अयाना", "ಅಯಾನ"],
    "Krishnaja Greens": ["कृष्णजा ग्रीन्स", "ಕೃಷ್ಣಜಾ ಗ್ರೀನ್ಸ್"],
    "Vanam": ["वनम", "ವನಂ"],
    "Skyview": ["स्काईव्यू"],
}


def distinctive(name: str) -> str:
    """The token a buyer actually types — drop the builder/collection prefix."""
    drop = {"brigade", "hv", "purva", "the"}
    toks = [t for t in name.split() if t.lower() not in drop]
    return " ".join(toks) if toks else name


def typo(s: str) -> str:
    """One realistic edit: drop a vowel from the longest token."""
    toks = s.split()
    i = max(range(len(toks)), key=lambda k: len(toks[k]))
    w = toks[i]
    for pos in range(len(w) - 2, 1, -1):
        if w[pos].lower() in "aeiou":
            toks[i] = w[:pos] + w[pos + 1 :]
            return " ".join(toks)
    return s


def build_queries() -> list[dict]:
    """Six families. `family` is what the report groups by."""
    out: list[dict] = []
    for builder, name in PROJECTS:
        short = distinctive(name)
        add = lambda fam, text: out.append(
            {"family": fam, "text": text, "gold": name, "builder": builder}
        )
        add("exact", name)
        add("short", short)
        add("typo", typo(short))
        add("hinglish", f"{short} ke baare mein batao")
        add("hinglish", f"{short} ka price kya hai")
        # The founder's long-sentence case: the name buried in multi-intent prose.
        add(
            "buried",
            f"hi we are looking for a 3 bhk around 1.8 cr for my parents and "
            f"someone mentioned {short}, can you send the cost sheet and also "
            f"tell me if a site visit is possible this saturday",
        )
        for t in TRANSLIT.get(name, []):
            add("translit", t)
    return out


def cosine(a: list[float], b: list[float]) -> float:
    num = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return num / (na * nb) if na and nb else 0.0


def embed(proxy: str, model: str, texts: list[str], batch: int = 96) -> list[list[float]]:
    vecs: list[list[float]] = []
    for i in range(0, len(texts), batch):
        chunk = texts[i : i + batch]
        req = urllib.request.Request(
            f"{proxy}/{model}",
            data=json.dumps({"text": chunk}).encode(),
            # Cloudflare fingerprints urllib's default User-Agent and answers
            # 403 before the Worker ever runs. Costs one header to avoid.
            headers={"content-type": "application/json", "user-agent": "curl/8.7.1"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                payload = json.load(r)
        except urllib.error.URLError as e:
            sys.exit(f"embed failed for {model}: {e}")
        if not payload.get("success"):
            sys.exit(f"embed error for {model}: {str(payload.get('error'))[:300]}")
        res = payload["result"]
        data = res.get("data") if isinstance(res, dict) else res
        vecs.extend(data)
        print(f"    {model}  {len(vecs)}/{len(texts)}", file=sys.stderr)
    return vecs


def run_arm(proxy: str, model: str, prefix: str, queries: list[dict], negatives: list[str]) -> dict:
    """One model, one query-prefix policy. Docs are never prefixed (bge convention)."""
    docs = [name for _, name in PROJECTS]
    dvecs = embed(proxy, model, docs)
    qtexts = [prefix + q["text"] for q in queries] + [prefix + n for n in negatives]
    qvecs = embed(proxy, model, qtexts)

    rows: list[dict] = []
    for q, qv in zip(queries, qvecs[: len(queries)]):
        scored = sorted(
            ((cosine(qv, dv), docs[i]) for i, dv in enumerate(dvecs)), reverse=True
        )
        top1, top2 = scored[0], scored[1]
        rows.append(
            {
                "family": q["family"],
                "text": q["text"],
                "gold": q["gold"],
                "pred": top1[1],
                "hit": top1[1] == q["gold"],
                "margin": (top1[0] - top2[0]) / top1[0] if top1[0] > 0 else 0.0,
                "top1": top1[0],
                "runner": top2[1],
            }
        )

    negrows: list[dict] = []
    for n, qv in zip(negatives, qvecs[len(queries) :]):
        scored = sorted(
            ((cosine(qv, dv), docs[i]) for i, dv in enumerate(dvecs)), reverse=True
        )
        top1, top2 = scored[0], scored[1]
        negrows.append(
            {
                "text": n,
                "pred": top1[1],
                "margin": (top1[0] - top2[0]) / top1[0] if top1[0] > 0 else 0.0,
                "top1": top1[0],
            }
        )
    return {"model": model, "prefixed": bool(prefix), "rows": rows, "negatives": negrows}


def summarise(arm: dict) -> dict:
    rows = arm["rows"]
    fams: dict[str, list[dict]] = {}
    for r in rows:
        fams.setdefault(r["family"], []).append(r)
    per = {
        f: {
            "n": len(v),
            "acc": sum(r["hit"] for r in v) / len(v),
            "margin": sum(r["margin"] for r in v) / len(v),
        }
        for f, v in sorted(fams.items())
    }
    return {
        "model": arm["model"],
        "prefixed": arm["prefixed"],
        "overall_acc": sum(r["hit"] for r in rows) / len(rows),
        "overall_margin": sum(r["margin"] for r in rows) / len(rows),
        "per_family": per,
        # A negative that separates strongly is a confident FALSE bind — the
        # "green open spaces" failure. Lower is better here.
        "neg_margin_p90": sorted(n["margin"] for n in arm["negatives"])[
            max(0, int(len(arm["negatives"]) * 0.9) - 1)
        ]
        if arm["negatives"]
        else 0.0,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--proxy", required=True, help="wrangler dev AI proxy base URL")
    ap.add_argument("--negatives", default="", help="JSON file of real no-name utterances")
    ap.add_argument("--out", default="u12-bakeoff.json")
    ap.add_argument(
        "--extra-models",
        default="",
        help="comma-separated Workers AI embedding models to add as raw (no-prefix) arms, "
        "e.g. @cf/baai/bge-large-en-v1.5,@cf/google/embeddinggemma-300m",
    )
    args = ap.parse_args()

    queries = build_queries()
    negatives: list[str] = []
    if args.negatives:
        negatives = json.load(open(args.negatives))
    print(
        f"{len(PROJECTS)} projects · {len(queries)} queries · {len(negatives)} negatives",
        file=sys.stderr,
    )

    arms = [
        ("bge-base (as deployed)", BASE, ""),
        ("bge-base (+query prefix)", BASE, BGE_QUERY_PREFIX),
        ("bge-m3", M3, ""),
    ]
    for m in filter(None, (s.strip() for s in args.extra_models.split(","))):
        # Raw text, same as the as-deployed arm. Some of these models document
        # their own query prefixes; a candidate that only wins WITH its prefix
        # can earn a bespoke arm later — the first question is the level field.
        arms.append((m.split("/")[-1], m, ""))
    results = []
    for label, model, prefix in arms:
        print(f"── {label}", file=sys.stderr)
        arm = run_arm(args.proxy, model, prefix, queries, negatives)
        arm["label"] = label
        results.append(arm)

    summaries = []
    for a in results:
        s = summarise(a)
        s["label"] = a["label"]
        summaries.append(s)

    json.dump({"summaries": summaries, "arms": results}, open(args.out, "w"), indent=1)

    fams = sorted({r["family"] for r in results[0]["rows"]})
    w = max(len(s["label"]) for s in summaries)
    print(f"\n{'arm':<{w}}  {'acc@1':>6} {'margin':>7} {'negP90':>7}  " + " ".join(f"{f:>9}" for f in fams))
    for s in summaries:
        cells = " ".join(f"{s['per_family'][f]['acc']:>9.2f}" for f in fams)
        print(
            f"{s['label']:<{w}}  {s['overall_acc']:>6.3f} {s['overall_margin']:>7.3f} "
            f"{s['neg_margin_p90']:>7.3f}  {cells}"
        )
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
