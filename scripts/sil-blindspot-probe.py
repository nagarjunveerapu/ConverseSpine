"""Probe the LADDER on language it was never tuned for.

The 14 recorded transcripts are the scenarios the regex ladder was BUILT
against, so of course it handles them — comparing arms there is circular. This
replays held-out corpus phrasings instead: real mined buyer language, frozen
out of the index, spread across every intent kind. Nothing here was chosen to
flatter either arm.

Each phrasing runs in a fresh 2-turn session — "tell me about Brigade Orchards"
to establish focus the way a real conversation would, then the test phrasing —
so the comparison isolates understanding of the utterance, not of the context.

    python3 scripts/sil-blindspot-probe.py --arm embed_first --set probe.json --out arm.json
"""
import argparse, json, random, sys, time, urllib.request
from pathlib import Path

URL = "https://converse-spine-projdev.nagarjun-arjun.workers.dev/api/advisor/turn"
H = {"Content-Type": "application/json",
     "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) (blindspot)",
     "Origin": "https://naya-advisor-dev.pages.dev"}
FOCUS = "tell me about Brigade Orchards"


def post(body, retries=3):
    err = None
    for a in range(retries):
        try:
            req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers=H)
            with urllib.request.urlopen(req, timeout=90) as f:
                return json.load(f)
        except Exception as e:
            err = e
            time.sleep(2 + a * 3)
    return {"_error": str(err)[:120]}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--arm", required=True)
    ap.add_argument("--set", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    items = json.load(open(a.set))
    out = []
    for n, it in enumerate(items, 1):
        sid = f"bs{random.randint(1, 10**9)}".ljust(64, "0")
        post({"session_id": sid, "text": FOCUS, "builder_id": "naya-advisor"})
        r = post({"session_id": sid, "text": it["text"], "builder_id": "naya-advisor"})
        g = (r.get("debug") or {}).get("goal") or {}
        out.append({
            "arm": a.arm, "text": it["text"], "gold_intent": it["intent"],
            "goal": g.get("kind"), "topic": g.get("topic"),
            "reply": (r.get("reply") or "")[:400],
            "err": r.get("_error"),
        })
        print(f"   {n}/{len(items)}", end="\r", flush=True)
    print()
    Path(a.out).write_text(json.dumps(out, indent=1))
    print(f"arm={a.arm} probed={len(out)} errors={sum(1 for x in out if x['err'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
