"""Score the learned projection ONCE against everything it never saw.

Two test sets, deliberately different in character:

  1. HOLDOUT  -- 1,880 frozen corpus rows. Clean, single-intent, same
     distribution as training. Measures whether the metric generalises.
  2. REAL TURNS -- 34 buyer turns from the 16 replayed conversations,
     including 5 multi-intent asks. Messy, Hinglish, elliptical, out of
     distribution. This is the set the current embedder covers only 58.8% of,
     and it is the one that decides whether the projection is worth shipping.

Both are replayed the way Vectorize actually behaves: cosine over normalised
vectors against the train rows, top-1 kind wins. Baseline (identity) and
projection run through the SAME replay on the SAME index, so the only variable
is the metric.

Reports a precision-coverage CURVE, not just one operating point -- a single
tau can be chosen to flatter either side; a curve cannot.

    python3 scripts/sil-eval-projection.py --vec /tmp/sil --out /tmp/sil
"""
import argparse, base64, json, sys, time, urllib.request
from pathlib import Path

import numpy as np

URL = "https://converse-spine-dev.nagarjun-arjun.workers.dev/api/sil/embed"
HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) (sil-eval)",
    "Origin": "https://naya-advisor-dev.pages.dev",
}
# Two operating points, because they answer different questions: .95 is what
# the live embedder achieves today, .98 is the floor a learned metric should
# be able to hold. Reporting one alone invites picking the flattering one.
PRECISION_POINTS = (0.95, 0.98)

# ---------------------------------------------------------------------------
# Gold labels for the real conversation turns.
#
# `accept` is a SET because several of these turns genuinely carry more than
# one intent -- scoring a multi-intent ask against a single "right answer"
# would manufacture failures that are really labelling artefacts. Where a turn
# is state-dependent rather than semantic ("yes"), it is excluded: no metric
# over sentence meaning can or should resolve it, that is the rule ladder's job.
# ---------------------------------------------------------------------------
REAL_TURNS = [
    ("3 BHK Devanahalli 2.5 cr",                                  {"find_projects", "get_price"}),
    ("show me options",                                           {"find_projects", "recommend"}),
    ("tell me about Brigade Orchards",                            {"get_project_info"}),
    ("price details please",                                      {"get_price"}),
    ("site visit saturday",                                       {"book_visit"}),
    ("yes",                                                       None),  # state-dependent
    ("compare Brigade Eldorado and Brigade Orchards",             {"compare_projects"}),
    ("which is better for families?",                             {"compare_projects"}),
    ("compare Brigade Eldorado, Brigade Orchards and Brigade Cornerstone", {"compare_projects"}),
    ("what 2 BHK and 3 BHK configurations are available?",        {"get_availability", "get_unit_configs"}),
    ("tell me about Brigade Eldorado",                            {"get_project_info"}),
    ("send me the brochure please",                               {"get_brochure"}),
    ("can I see the 3 BHK floor plan?",                           {"get_brochure"}),
    ("tell me about Brigade Cornerstone",                         {"get_project_info"}),
    ("is it RERA registered?",                                    {"get_legal_info"}),
    ("seems too far from city",                                   {"express_objection", "get_location_info"}),
    ("show me closer options",                                    {"find_projects", "recommend"}),
    ("Devanahalli mein 3 BHK chahiye budget 2 crore",             {"find_projects"}),
    ("options dikhao",                                            {"find_projects", "recommend"}),
    ("Orchards ke baare mein batao",                              {"get_project_info"}),
    ("pricing?",                                                  {"get_price"}),
    # --- multi-intent: either component counts as understood ---
    ("what's the price and are there good schools nearby?",       {"get_price", "get_location_info"}),
    ("is it RERA registered and when is possession?",             {"get_legal_info", "ask_delivery_timeline"}),
    ("send me the brochure and book a visit for saturday",        {"get_brochure", "book_visit"}),
    ("compare Brigade Eldorado and Brigade Orchards and tell me which is cheaper",
                                                                  {"compare_projects", "get_price"}),
    ("3 BHK in Devanahalli under 2.5 crore, and what would the EMI be?",
                                                                  {"find_projects", "compute_emi", "get_price"}),
]


def unit(X):
    return X / np.maximum(np.linalg.norm(X, axis=1, keepdims=True), 1e-12)


def embed(texts, retries=4):
    body = json.dumps({"texts": texts}).encode()
    err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(URL, data=body, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=180) as f:
                out = json.load(f)
            return np.vstack(
                [np.frombuffer(base64.b64decode(v), dtype="<f4") for v in out["vectors"]]
            ).astype(np.float64)
        except Exception as e:
            err = e
            time.sleep(2 + attempt * 4)
    raise RuntimeError(f"embed failed: {err}")


def replay(Q, Xi, yi, topk=5):
    """Vectorize's behaviour, exactly: cosine, top-1 kind + its score."""
    Qn, Xn = unit(Q), unit(Xi)
    kinds, scores, seconds = [], [], []
    B = 256
    for i in range(0, len(Qn), B):
        S = Qn[i : i + B] @ Xn.T
        idx = np.argpartition(-S, kth=topk, axis=1)[:, :topk]
        for r in range(S.shape[0]):
            cand = idx[r][np.argsort(-S[r, idx[r]])]
            k, sc = yi[cand], S[r, cand]
            kinds.append(k[0])
            scores.append(float(sc[0]))
            other = sc[k != k[0]]
            seconds.append(float(other[0]) if len(other) else 0.0)
    return np.array(kinds), np.array(scores), np.array(seconds)


def curve(ok, score, points=41):
    """(coverage, precision) as tau sweeps -- the whole trade-off, not one point."""
    out = []
    for tau in np.linspace(score.min(), score.max(), points):
        m = score >= tau
        if m.sum() == 0:
            continue
        out.append({"tau": float(tau), "coverage": float(m.mean()),
                    "precision": float(ok[m].mean())})
    return out


def op_point(ok, score, min_p):
    order = np.argsort(-score)
    cum = np.cumsum(ok[order])
    n = np.arange(1, len(ok) + 1)
    prec = cum / n
    valid = np.where(prec >= min_p)[0]
    if not len(valid):
        return {"coverage": 0.0, "tau": 1.0, "precision": 1.0}
    k = valid[-1]
    return {"coverage": float((k + 1) / len(ok)), "tau": float(score[order][k]),
            "precision": float(prec[k])}


def op_points(ok, score):
    return {f"p{int(p*100)}": op_point(ok, score, p) for p in PRECISION_POINTS}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--vec", default="/tmp/sil")
    ap.add_argument("--out", default="/tmp/sil")
    a = ap.parse_args()

    X = unit(np.load(Path(a.vec) / "vectors.npy").astype(np.float64))
    meta = json.load(open(Path(a.vec) / "meta.json"))
    rows = meta["rows"]
    y = np.array([r["kind"] for r in rows])
    split = np.array([r["split"] for r in rows])
    W = np.load(Path(a.vec) / "projection.npy").astype(np.float64)
    pmeta = json.load(open(Path(a.vec) / "projection-meta.json"))

    tr = np.where(split == "train")[0]
    ho = np.where(split == "holdout")[0]
    # Match the live eval's filter: routable rows only (an unroutable kind
    # cannot bind no matter how well it is recognised).
    ho = np.array([i for i in ho if rows[i]["routable"]])
    print(f"index={len(tr)} train rows | holdout queries={len(ho)}")
    print(f"projection: shrink={pmeta['shrink']} alpha={pmeta['alpha']} eps={pmeta['eps']}\n")

    report = {"projection": pmeta, "index_rows": int(len(tr)), "holdout_rows": int(len(ho))}

    # ---------------- holdout ----------------
    Xi, yi = X[tr], y[tr]
    Pi = X[tr] @ W.T
    for name, (Q, I) in {
        "baseline": (X[ho], Xi),
        "projection": (X[ho] @ W.T, Pi),
    }.items():
        k, s, s2 = replay(Q, I, yi)
        ok = (k == y[ho]).astype(float)
        okb = ok.astype(bool)
        r = {
            "top1": float(ok.mean()),
            "ops": op_points(ok, s),
            "curve": curve(ok, s),
            "band": {"p10": float(np.percentile(s, 10)), "p50": float(np.percentile(s, 50)),
                     "p90": float(np.percentile(s, 90)), "max": float(s.max())},
            "margin_mean": float((s - s2).mean()),
            "separation": float(s[okb].mean() - s[~okb].mean()) if (~okb).any() else None,
        }
        report.setdefault("holdout", {})[name] = r
        print(f"HOLDOUT {name:11} top1={r['top1']*100:5.1f}%  "
              f"cov@p95={r['ops']['p95']['coverage']*100:5.1f}% (tau={r['ops']['p95']['tau']:.3f})  "
              f"cov@p98={r['ops']['p98']['coverage']*100:5.1f}% (tau={r['ops']['p98']['tau']:.3f})  "
              f"band {r['band']['p10']:.3f}/{r['band']['p90']:.3f}  "
              f"sep={r['separation']:+.4f}")

    # per-intent, projection vs baseline
    kb, sb, _ = replay(X[ho], Xi, yi)
    kp, sp, _ = replay(X[ho] @ W.T, Pi, yi)
    per = {}
    for c in sorted(set(y[ho])):
        m = y[ho] == c
        if m.sum() < 6:
            continue
        per[c] = {"n": int(m.sum()),
                  "baseline": float((kb[m] == c).mean()),
                  "projection": float((kp[m] == c).mean())}
    report["holdout_per_intent"] = per

    # ---------------- real conversation turns ----------------
    texts = [t for t, _ in REAL_TURNS]
    print(f"\nembedding {len(texts)} real turns ...")
    Qr = embed(texts)
    graded = [i for i, (_, acc) in enumerate(REAL_TURNS) if acc]
    real = {}
    for name, (Q, I) in {
        "baseline": (Qr, Xi),
        "projection": (Qr @ W.T, Pi),
    }.items():
        k, s, s2 = replay(Q, I, yi)
        ok = np.array([float(k[i] in REAL_TURNS[i][1]) for i in graded])
        sc = s[graded]
        # tau is frozen from the HOLDOUT calibration -- choosing it on the real
        # turns would be scoring the exam with the answer key in hand.
        tau = report["holdout"][name]["ops"]["p98"]["tau"]
        bound = sc >= tau
        real[name] = {
            "top1": float(ok.mean()),
            "tau": tau,
            "coverage": float(bound.mean()),
            "precision_when_bound": float(ok[bound].mean()) if bound.any() else 0.0,
            "correct_and_bound": float((ok.astype(bool) & bound).mean()),
            "ops": op_points(ok, sc),
            "curve": curve(ok, sc, points=25),
            "rows": [
                {"text": REAL_TURNS[i][0], "gold": sorted(REAL_TURNS[i][1]),
                 "kind": str(k[i]), "score": float(s[i]),
                 "ok": bool(k[i] in REAL_TURNS[i][1]), "bound": bool(s[i] >= tau)}
                for i in graded
            ],
        }
        r = real[name]
        print(f"REAL    {name:11} top1={r['top1']*100:5.1f}%  coverage@tau={r['coverage']*100:5.1f}%"
              f"  precision-when-bound={r['precision_when_bound']*100:5.1f}%"
              f"  correct&bound={r['correct_and_bound']*100:5.1f}%")
    report["real"] = real

    # ---------------- matched-precision comparison ----------------
    # The only fair question: at equal precision, which metric reaches further?
    # Production runs tau=0.78 in identity space. That number is meaningless in
    # the projected space, so instead of transplanting it, find the projected
    # tau that delivers the SAME precision on holdout, then compare coverage on
    # the real turns. Neither side gets to pick its own threshold.
    PROD_TAU = 0.78
    kb_ho, sb_ho, _ = replay(X[ho], Xi, yi)
    okb_ho = (kb_ho == y[ho])
    base_bound = sb_ho >= PROD_TAU
    base_prec = float(okb_ho[base_bound].mean()) if base_bound.any() else 0.0
    kp_ho, sp_ho, _ = replay(X[ho] @ W.T, Pi, yi)
    okp_ho = (kp_ho == y[ho])
    # lowest projected tau still holding base_prec
    order = np.argsort(-sp_ho)
    prec_curve = np.cumsum(okp_ho[order]) / np.arange(1, len(okp_ho) + 1)
    valid = np.where(prec_curve >= base_prec)[0]
    proj_tau = float(sp_ho[order][valid[-1]]) if len(valid) else 1.0

    kb_r, sb_r, _ = replay(Qr, Xi, yi)
    kp_r, sp_r, _ = replay(Qr @ W.T, Pi, yi)
    okb_r = np.array([float(kb_r[i] in REAL_TURNS[i][1]) for i in graded])
    okp_r = np.array([float(kp_r[i] in REAL_TURNS[i][1]) for i in graded])
    matched = {
        "target_precision": base_prec,
        "baseline": {"tau": PROD_TAU,
                     "holdout_coverage": float(base_bound.mean()),
                     "real_coverage": float((sb_r[graded] >= PROD_TAU).mean()),
                     "real_correct_and_bound":
                         float((okb_r.astype(bool) & (sb_r[graded] >= PROD_TAU)).mean())},
        "projection": {"tau": proj_tau,
                       "holdout_coverage": float((sp_ho >= proj_tau).mean()),
                       "real_coverage": float((sp_r[graded] >= proj_tau).mean()),
                       "real_correct_and_bound":
                           float((okp_r.astype(bool) & (sp_r[graded] >= proj_tau)).mean())},
    }
    report["matched_precision"] = matched
    print(f"\nMATCHED PRECISION ({base_prec*100:.1f}% on holdout)")
    for n in ("baseline", "projection"):
        m = matched[n]
        print(f"  {n:11} tau={m['tau']:.3f}  holdout-coverage={m['holdout_coverage']*100:5.1f}%"
              f"  REAL coverage={m['real_coverage']*100:5.1f}%"
              f"  REAL correct&bound={m['real_correct_and_bound']*100:5.1f}%")

    # per-row real-turn table, both metrics side by side
    report["real_rows"] = [
        {"text": REAL_TURNS[i][0], "gold": sorted(REAL_TURNS[i][1]),
         "base_kind": str(kb_r[i]), "base_score": float(sb_r[i]),
         "base_ok": bool(kb_r[i] in REAL_TURNS[i][1]),
         "base_bound": bool(sb_r[i] >= PROD_TAU),
         "proj_kind": str(kp_r[i]), "proj_score": float(sp_r[i]),
         "proj_ok": bool(kp_r[i] in REAL_TURNS[i][1]),
         "proj_bound": bool(sp_r[i] >= proj_tau)}
        for i in graded
    ]

    json.dump(report, open(Path(a.out) / "eval-report.json", "w"), indent=1)
    print(f"\nWROTE {a.out}/eval-report.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
