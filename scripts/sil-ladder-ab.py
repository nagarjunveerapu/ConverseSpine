"""A/B the routing LADDER on real conversations: regex-first vs embed-first.

Replays the 14 recorded buyer scenarios as sessions against converse-spine-projdev
and records, per turn, which layer decided it. Run once with SIL_EMBED_FIRST=false
and once with "true" (redeploy between runs) — the worker config is the only
variable, the transcripts and session shape are identical.

The primary metric needs no human grading: `provenance.routing_bind.bind_source`
says whether the embedding or a regex produced the routing, and
`provenance.fields.askTopics` says the same for topic understanding. Goal kinds
are captured too, so any turn whose ANSWER changed can be hand-read.

    python3 scripts/sil-ladder-ab.py --arm regex_first  --out /tmp/arm1.json
    python3 scripts/sil-ladder-ab.py --arm embed_first  --out /tmp/arm2.json
"""
import argparse, glob, json, random, sys, time, urllib.request
from pathlib import Path

URL = "https://converse-spine-projdev.nagarjun-arjun.workers.dev/api/advisor/turn"
H = {"Content-Type": "application/json",
     "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) (ladder-ab)",
     "Origin": "https://naya-advisor-dev.pages.dev"}


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
    ap.add_argument("--arm", required=True, choices=["regex_first", "embed_first"])
    ap.add_argument("--transcripts", required=True, help="dir of s*.jsonl replays")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    rows = []
    for fp in sorted(glob.glob(f"{a.transcripts}/s*.jsonl")):
        turns = []
        for line in open(fp):
            if not line.strip():
                continue
            o = json.loads(line)
            if "buyer" in o:
                turns.append(o["buyer"])
        sid = f"la{random.randint(1, 10**9)}".ljust(64, "0")
        name = fp.split("/")[-1]
        print(f"── {name:26} {len(turns)} turns", flush=True)
        for i, t in enumerate(turns):
            r = post({"session_id": sid, "text": t, "builder_id": "naya-advisor"})
            dbg = r.get("debug") or {}
            prov = dbg.get("extract_provenance") or {}
            bind = prov.get("routing_bind") or {}
            rows.append({
                "arm": a.arm, "file": name, "i": i, "text": t[:120],
                "goal": (dbg.get("goal") or {}).get("kind"),
                "topic": (dbg.get("goal") or {}).get("topic"),
                "bind_source": bind.get("bind_source"),
                "embed_gate": bind.get("embed_gate"),
                "embed_fired": bind.get("embed_fired"),
                "top_kind": bind.get("top_kind"),
                "top_score": bind.get("top_score"),
                "miss": bind.get("miss_reason"),
                "fields": prov.get("fields"),
                # Join key for the Desk ledger, where routing_bind actually
                # persists — the HTTP debug drops provenance on most paths.
                "nd_conv": r.get("nd_conversation_id") or r.get("conversation_id"),
                "reply": (r.get("reply") or "")[:300],
                "err": r.get("_error"),
            })
            print(f"   {i+1}/{len(turns)}", end="\r", flush=True)
        print()

    Path(a.out).write_text(json.dumps(rows, indent=1))
    ok = [r for r in rows if r["bind_source"]]
    print(f"\narm={a.arm}  turns={len(rows)}  with routing_bind={len(ok)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
