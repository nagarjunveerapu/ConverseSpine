"""Build corpus/mask-vocab.json — the entity vocabulary for canonicalization.

Sources (data, never hardcoded engine regex — P5 / no-hardcoded-places):
  1. NayaDesk D1 area registry (name + aliases + city)   [--areas areas.json]
  2. NayaDesk D1 projects (name)                          [--projects projects.json]
  3. corpus/gazetteer-seed.json — entities OBSERVED in corpus phrasings that are
     outside today's catalog (other cities, national builders). Grows via the
     weekly mining pipeline's review queue, never via engine code.

Output shape: {"places": [...], "builders": [...], "projects": [...], "provenance": {...}}
Longest-match-first is the consumer's job (registry-v2.py / the shared masker lib).

    python3 scripts/build-mask-vocab.py --areas <d1_areas.json> --projects <d1_projects.json>
"""
import argparse, json, time
from pathlib import Path

def d1_rows(path):
    d = json.load(open(path))
    return d[0]["results"] if isinstance(d, list) else d["results"]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--areas", required=True)
    ap.add_argument("--projects", required=True)
    ap.add_argument("--seed", default="corpus/gazetteer-seed.json")
    ap.add_argument("--out", default="corpus/mask-vocab.json")
    a = ap.parse_args()

    places, builders, projects = set(), set(), set()

    for r in d1_rows(a.areas):
        places.add(r["name"].lower())
        for al in json.loads(r.get("aliases") or "[]"):
            places.add(al.lower())
        if r.get("city"):
            places.add(r["city"].lower())

    for r in d1_rows(a.projects):
        projects.add(r["name"].lower())

    seed = json.load(open(a.seed))
    places |= {p.lower() for p in seed.get("places", [])}
    builders |= {b.lower() for b in seed.get("builders", [])}
    projects |= {p.lower() for p in seed.get("projects", [])}

    out = {
        "places": sorted(places),
        "builders": sorted(builders),
        "projects": sorted(projects),
        "provenance": {
            "desk_d1": "naya-db-dev area+projects",
            "gazetteer_seed": a.seed,
            "built_at": int(time.time() * 1000),
        },
    }
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(f"{a.out}: places={len(places)} builders={len(builders)} projects={len(projects)}")

if __name__ == "__main__":
    main()
