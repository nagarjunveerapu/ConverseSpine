#!/usr/bin/env python3
"""
Score the shadow ranking against what buyers actually did next.

    python3 scripts/chips-score-shadow.py [--env dev] [--since-ms N]

For every ledger turn carrying a `chip_shadow`, the NEXT turn in the same
conversation is the truth. Two numbers come out:

  top-1 / top-3   did the buyer's next state appear in what we would have shown
  chip lane       when the buyer TAPPED something, was it a chip we ranked

The second matters more and will be thin at first: it only counts turns whose
input_source is `chip`, which today are the static chips. It becomes the real
metric once the ranker drives the UI.

Reported against the same fixed-list baseline the offline evaluation used, so
the live number is comparable to the 85.4% / 51.5% measured on dev replays.
"""
import argparse, json, subprocess, sys
from collections import Counter

SQL = """
WITH t AS (
  SELECT conversation_id cid, created_at,
         json_extract(action_plan_json,'$.chip_shadow') shadow,
         COALESCE(json_extract(action_plan_json,'$.kind'),'') kind,
         COALESCE(json_extract(action_plan_json,'$.topic'),'') topic,
         COALESCE(json_extract(snapshot_in,'$.input_source'),'') src
  FROM turn_ledger WHERE created_at > {since}
), s AS (
  SELECT cid, shadow,
         LEAD(kind || CASE WHEN topic <> '' THEN '/'||topic ELSE '' END)
           OVER (PARTITION BY cid ORDER BY created_at) nx,
         LEAD(src) OVER (PARTITION BY cid ORDER BY created_at) nx_src
  FROM t
)
SELECT shadow, nx, nx_src FROM s WHERE shadow IS NOT NULL AND nx IS NOT NULL AND nx <> ''
"""


def d1(db, env, sql):
    out = subprocess.run(
        ['npx', 'wrangler', 'd1', 'execute', db, '--env', env, '--remote', '--json',
         '--command', ' '.join(sql.split())],
        capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f'wrangler failed:\n{out.stdout}\n{out.stderr}')
    return json.loads(out.stdout[out.stdout.index('['):])[0]['results']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--env', default='dev')
    ap.add_argument('--db', default='naya-db-dev')
    ap.add_argument('--since-ms', type=int, default=0)
    args = ap.parse_args()

    rows = d1(args.db, args.env, SQL.format(since=args.since_ms))
    if not rows:
        print('no shadow rows yet — deploy and drive some turns first')
        return

    hit1 = hit3 = 0
    tap_n = tap_hit = 0
    levels, held = Counter(), Counter()
    for r in rows:
        sh = json.loads(r['shadow']) if isinstance(r['shadow'], str) else r['shadow']
        pred = [c['state'] for c in sh.get('ranked', [])]
        levels[sh.get('level', '?')] += 1
        for h in sh.get('held', []):
            held[f"{h['state']}:{h['why']}"] += 1
        if pred and pred[0] == r['nx']:
            hit1 += 1
        if r['nx'] in pred:
            hit3 += 1
        if r['nx_src'] == 'chip':
            tap_n += 1
            if r['nx'] in pred:
                tap_hit += 1

    n = len(rows)
    print(f'{n} scored turns\n')
    print(f'  next state in top-1   {100*hit1/n:5.1f}%')
    print(f'  next state in top-3   {100*hit3/n:5.1f}%')
    print(f'  (offline on dev replays: 85.4% top-3 vs 51.5% for one fixed list)\n')
    if tap_n:
        print(f'  buyer TAPPED a chip   {tap_n} turns — ranked it in top-3 {100*tap_hit/tap_n:5.1f}%')
    else:
        print('  buyer TAPPED a chip   0 turns — nothing to say about the chip lane yet')
    print(f'\n  backoff  {dict(levels)}')
    if held:
        print('\n  most often held back (catalogue or data gaps):')
        for k, v in held.most_common(8):
            print(f'    {v:5d}  {k}')


if __name__ == '__main__':
    main()
