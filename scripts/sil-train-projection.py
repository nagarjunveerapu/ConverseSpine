"""Fit a learned projection over the intent embedding — a custom metric, no new model.

WHY THIS EXISTS
    `@cf/baai/bge-base-en-v1.5` is a general encoder. On this corpus its RANKING
    is already good, but its SCALE is not: real buyer turns land in a narrow
    0.65-0.91 cosine band, so a fixed tau cannot separate "I know this" from "I
    am guessing". Measured on live turns, the top-1 intent was usually correct
    and still fell below tau. That is a metric defect, not a capacity defect.

    A projection W re-metricises the SAME vectors: cos(Wx, Wy). Fitted on the
    labelled corpus it contracts within-intent variation (phrasing, language,
    project names) and stretches between-intent variation, so the score band
    spreads and tau becomes meaningful. Workers AI cannot serve a fine-tuned
    embedding model, but it does not need to: W is a matrix multiply the Worker
    can do itself, and W = I reproduces today's behaviour exactly.

METHOD (closed form, no gradient descent, seconds on CPU)
    Sw = within-class scatter, Sb = between-class scatter.
    A  = (Sw + shrink)^-1/2            whiten out within-intent variation
    M  = A Sb A^T = U diag(L) U^T      discriminant directions, Fisher-ranked
    W  = diag((L + eps)^alpha) U^T A   re-weight by discriminative power
    alpha=0 is plain whitening; alpha>0 with small eps approaches LDA. The
    sweep picks (shrink, alpha, eps) on a dev slice the fit never saw.

HONESTY PROTOCOL
    train rows split fit(80) / cal(10) / sel(10). W is fitted on `fit` only,
    tau is calibrated on `cal`, hyperparameters are chosen on `sel`. The
    frozen `holdout` split and the real-conversation turns are NOT touched
    here -- sil-eval-projection.py scores those once, at the end.

    python3 scripts/sil-train-projection.py --vec /tmp/sil --out /tmp/sil
"""
import argparse, json, sys
from pathlib import Path

import numpy as np

# Precision floor for hyperparameter selection.
#
# 0.95 looks like the natural choice (it is the live embedder's accuracy when
# confident) and it is the WRONG one: top-1 accuracy on this corpus is ~94-95%,
# so any configuration whose overall accuracy clears 0.95 scores "100%
# coverage" for free while one at 94.9% is forced down to ~20%. The metric
# becomes a coin-flip on the third decimal rather than a measure of separation.
#
# 0.98 sits well above the accuracy ceiling, so coverage can only be earned by
# actually pulling correct matches away from incorrect ones -- which is the
# whole point of learning a metric.
MIN_PRECISION = 0.98


def unit(X):
    n = np.linalg.norm(X, axis=1, keepdims=True)
    return X / np.maximum(n, 1e-12)


def scatters(X, y):
    """Within- and between-class scatter of L2-normalised rows."""
    classes = np.unique(y)
    mu = X.mean(axis=0)
    D = X.shape[1]
    Sw = np.zeros((D, D), dtype=np.float64)
    Sb = np.zeros((D, D), dtype=np.float64)
    for c in classes:
        Xc = X[y == c]
        if len(Xc) < 2:
            continue
        mc = Xc.mean(axis=0)
        Z = Xc - mc
        Sw += Z.T @ Z
        d = (mc - mu).reshape(-1, 1)
        Sb += len(Xc) * (d @ d.T)
    return Sw / len(X), Sb / len(X)


def fit_projection(X, y, shrink=0.1, alpha=0.5, eps=0.1, rank=None):
    """Return W (rank x D float64), rows ordered most- to least-discriminant.

    shrink/eps are fractions of the relevant mean eigenvalue, so the same
    settings transfer across corpus sizes. `rank` truncates to the top-k
    directions: with 33 intents Sb has rank <= 32, so everything past that is
    non-discriminant detail. Truncating shrinks BOTH the matrix the Worker
    carries and the Vectorize index it queries -- if the data says it costs
    nothing, take it.
    """
    Sw, Sb = scatters(X, y)
    dw, Vw = np.linalg.eigh(Sw)
    lam = shrink * float(dw.mean())
    A = Vw @ np.diag(1.0 / np.sqrt(np.maximum(dw + lam, 1e-12))) @ Vw.T
    M = A @ Sb @ A.T
    M = (M + M.T) / 2
    L, U = np.linalg.eigh(M)
    order = np.argsort(-L)  # most discriminant first, so rank-k = first k rows
    L, U = np.maximum(L[order], 0.0), U[:, order]
    # eps floors the non-discriminant directions: kept (so near-duplicate
    # phrasings still resolve) but weighted down against the ~32 that carry
    # class information.
    e = eps * float(L[L > 0].mean()) if (L > 0).any() else 1e-6
    S = np.power(L + e, alpha)
    W = np.diag(S) @ U.T @ A
    W = W[:rank] if rank else W
    # Tiny shrink can leave near-zero eigenvalues in Sw, whose inverse square
    # root overflows. Such a W is not a candidate, it is a numerical failure --
    # say so rather than letting NaNs quietly score as a bad configuration.
    return W.astype(np.float64) if np.isfinite(W).all() else None


def knn_scores(Q, Xi, yi, topk=5):
    """Replay Vectorize: cosine over normalised vectors, keep top-1 kind+score."""
    Qn, Xn = unit(Q), unit(Xi)
    top_kind, top_score, margin = [], [], []
    B = 512
    for i in range(0, len(Qn), B):
        S = Qn[i : i + B] @ Xn.T
        idx = np.argpartition(-S, kth=min(topk, S.shape[1] - 1), axis=1)[:, :topk]
        for r in range(S.shape[0]):
            cand = idx[r][np.argsort(-S[r, idx[r]])]
            kinds = yi[cand]
            scores = S[r, cand]
            top_kind.append(kinds[0])
            top_score.append(float(scores[0]))
            # margin to the best DIFFERENT kind -- how alone the winner stands
            diff = scores[kinds != kinds[0]]
            margin.append(float(scores[0] - diff[0]) if len(diff) else float(scores[0]))
    return np.array(top_kind), np.array(top_score), np.array(margin)


def coverage_at_precision(pred, score, truth, min_p=MIN_PRECISION):
    """Highest coverage whose accuracy-when-confident still clears min_p, + that tau."""
    ok = pred == truth
    order = np.argsort(-score)
    ok_s, sc_s = ok[order], score[order]
    cum = np.cumsum(ok_s)
    n = np.arange(1, len(ok_s) + 1)
    prec = cum / n
    valid = np.where(prec >= min_p)[0]
    if not len(valid):
        return 0.0, 1.0, 0.0
    k = valid[-1]
    return float((k + 1) / len(ok_s)), float(sc_s[k]), float(prec[k])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--vec", default="/tmp/sil", help="dir from sil-export-embeddings.py")
    ap.add_argument("--out", default="/tmp/sil")
    ap.add_argument("--seed", type=int, default=7)
    # Skip the sweep and fit one named configuration. Used to fit the compact
    # variant so the size/quality trade is measured on the same test sets
    # rather than argued about.
    ap.add_argument("--fixed", nargs=4, type=float, metavar=("SHRINK", "ALPHA", "EPS", "RANK"))
    a = ap.parse_args()

    X = np.load(Path(a.vec) / "vectors.npy").astype(np.float64)
    meta = json.load(open(Path(a.vec) / "meta.json"))
    rows = meta["rows"]
    y = np.array([r["kind"] for r in rows])
    split = np.array([r["split"] for r in rows])
    X = unit(X)

    tr = np.where(split == "train")[0]
    # Split by PATTERN, not by row. The corpus holds many phrasings per
    # pattern_id; a random row split puts near-duplicates on both sides, and
    # then every configuration scores well by retrieving a sibling of the query.
    # That inflates the absolute numbers and, worse, biases hyperparameter
    # choice toward whatever memorises best.
    rng = np.random.default_rng(a.seed)
    pat = np.array([rows[i]["pattern_id"] or f"_solo_{i}" for i in tr])
    groups = np.unique(pat)
    rng.shuffle(groups)
    g_fit = set(groups[: int(len(groups) * 0.8)])
    g_cal = set(groups[int(len(groups) * 0.8) : int(len(groups) * 0.9)])
    fit_ix = tr[np.isin(pat, list(g_fit))]
    cal_ix = tr[np.isin(pat, list(g_cal))]
    sel_ix = tr[~np.isin(pat, list(g_fit | g_cal))]
    print(f"train={len(tr)} in {len(groups)} patterns  "
          f"fit={len(fit_ix)} cal={len(cal_ix)} sel={len(sel_ix)}  (disjoint patterns)")
    print(f"holdout={(split=='holdout').sum()} (untouched here)\n")

    Xf, yf = X[fit_ix], y[fit_ix]
    ysel = y[sel_ix]

    def score_config(W=None):
        """Everything the choice should depend on, measured the same way."""
        Q = X[sel_ix] if W is None else X[sel_ix] @ W.T
        I = Xf if W is None else Xf @ W.T
        p, s, _ = knn_scores(Q, I, yf)
        ok = p == ysel
        cov, tau, _ = coverage_at_precision(p, s, ysel)
        # Separation is the property being bought: how far the scores of
        # correct top-1 matches sit above the scores of wrong ones. Coverage
        # follows from it; reporting it directly makes the mechanism visible
        # rather than inferred.
        sep = float(s[ok].mean() - s[~ok].mean()) if (~ok).any() else float("nan")
        return {"top1": float(ok.mean()), "cov": cov, "tau": tau, "sep": sep,
                "p10": float(np.percentile(s, 10)), "p90": float(np.percentile(s, 90))}

    b = score_config(None)
    print(f"BASELINE (identity)   top1={b['top1']*100:5.1f}%  "
          f"coverage@p>={MIN_PRECISION:.2f}={b['cov']*100:5.1f}%  tau={b['tau']:.3f}  "
          f"separation={b['sep']:+.4f}")
    print(f"  score band on sel   p10={b['p10']:.3f} p90={b['p90']:.3f}\n")

    best = None
    D = X.shape[1]
    if a.fixed:
        sh, al, ep, rk = a.fixed[0], a.fixed[1], a.fixed[2], int(a.fixed[3])
        r = score_config(fit_projection(Xf, yf, sh, al, ep, rk))
        best = {"shrink": sh, "alpha": al, "eps": ep, "rank": rk, **r}
        print(f"FIXED  shrink={sh} alpha={al} eps={ep} rank={rk} | "
              f"top1={r['top1']*100:.1f}% coverage={r['cov']*100:.1f}% sep={r['sep']:+.4f}")
    print(f"{'shrink':>7} {'alpha':>6} {'eps':>6} {'rank':>5} | {'top1':>6} {'cov@p':>7} "
          f"{'tau':>6} {'sep':>7} {'p10':>6} {'p90':>6}" if not a.fixed else "")
    # alpha=1.0 was swept and is consistently ~3 pts worse on top-1: weighting
    # by the full Fisher ratio over-trusts a handful of directions.
    for shrink in () if a.fixed else (0.01, 0.05, 0.1, 0.3, 1.0):
        for alpha in (0.0, 0.25, 0.5):
            for eps in (0.01, 0.1, 1.0):
                if alpha == 0.0 and eps != 0.01:
                    continue  # alpha=0 makes eps a no-op (S is constant)
                Wfull = fit_projection(Xf, yf, shrink, alpha, eps)
                if Wfull is None:
                    print(f"{shrink:7.2f} {alpha:6.2f} {eps:6.2f} {'-':>5} | "
                          f"non-finite (shrink too small)")
                    continue
                for rank in (32, 64, 128, 256, D):
                    r = score_config(Wfull[:rank])
                    print(f"{shrink:7.2f} {alpha:6.2f} {eps:6.2f} {rank:5} | {r['top1']*100:5.1f}% "
                          f"{r['cov']*100:6.1f}% {r['tau']:6.3f} {r['sep']:+7.4f} "
                          f"{r['p10']:6.3f} {r['p90']:6.3f}")
                    # Coverage at a precision floor above the accuracy ceiling,
                    # top-1 as the tie-break: never trade recognition for reach.
                    key = (round(r["cov"], 4), round(r["top1"], 4))
                    if best is None or key > (round(best["cov"], 4), round(best["top1"], 4)):
                        best = {"shrink": shrink, "alpha": alpha, "eps": eps,
                                "rank": int(rank), **r}

    print(f"\nBEST on sel: shrink={best['shrink']} alpha={best['alpha']} eps={best['eps']} "
          f"rank={best['rank']}  top1={best['top1']*100:.1f}%  coverage={best['cov']*100:.1f}%"
          f"  separation={best['sep']:+.4f}")
    print(f"  vs baseline: coverage {b['cov']*100:.1f}% -> {best['cov']*100:.1f}% "
          f"({(best['cov']-b['cov'])*100:+.1f} pts), separation {b['sep']:+.4f} -> {best['sep']:+.4f}")

    # Refit on ALL train rows (fit+cal+sel) with the chosen hyperparameters --
    # the shipped W should see every labelled row, not 80% of them.
    W = fit_projection(X[tr], y[tr], best["shrink"], best["alpha"], best["eps"], best["rank"])
    # Calibrate the shipped tau with the shipped W. The calibration rows must
    # NOT be in the index they are queried against -- a row retrieves itself at
    # cosine 1.0, which would set tau to a value no real turn can reach.
    keep = np.setdiff1d(tr, cal_ix)
    p, s, _ = knn_scores(X[cal_ix] @ W.T, X[keep] @ W.T, y[keep])
    _, tau, _ = coverage_at_precision(p, s, y[cal_ix])

    out = Path(a.out)
    np.save(out / "projection.npy", W.astype(np.float32))
    json.dump(
        {"shrink": best["shrink"], "alpha": best["alpha"], "eps": best["eps"],
         "rank": best["rank"], "dims_in": int(W.shape[1]), "dims_out": int(W.shape[0]),
         "bytes_float32": int(W.size * 4), "tau_suggested": tau,
         "min_precision": MIN_PRECISION,
         "sel_top1": best["top1"], "sel_coverage": best["cov"],
         "sel_separation": best["sep"],
         "baseline_sel_top1": b["top1"], "baseline_sel_coverage": b["cov"],
         "baseline_separation": b["sep"], "baseline_tau": b["tau"],
         "model": meta.get("model"), "train_rows": int(len(tr))},
        open(out / "projection-meta.json", "w"), indent=1)
    print(f"\nWROTE {out}/projection.npy  ({W.shape}, float32)  tau_suggested={tau:.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
