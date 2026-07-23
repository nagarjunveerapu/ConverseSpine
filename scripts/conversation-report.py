#!/usr/bin/env python3
"""
Drive a conversation against a live deployment and publish what happened.

    python3 scripts/conversation-report.py scripts/scenarios/budget-fit.json \
        [--url https://converse-spine-dev...workers.dev] [--out report.html]

Every test run produces one of these. The founder's rule: the report contains
the CONVERSATION, not a summary of it. Aggregate numbers have twice been wrong
here in ways only a transcript would have exposed, and a good aggregate can sit
on top of a reply that lies to the buyer.

A scenario is a JSON file:

    {"name": "...", "builder_id": "naya-advisor",
     "turns": [
       {"say": "3 BHK in Devanahalli, budget 50-70L",
        "expect": [{"kind": "not_contains", "value": "within your budget",
                    "why": "the 3 BHK starts at Rs 89L"}],
        "note": "free text, optional commentary shown beside the turn"}]}

`expect` kinds: contains / not_contains / goal_is / max_seconds.
Each is checked against the real reply and rendered pass/fail beside the turn.

Per-turn instrumentation (goal, chip shadow) is read back from the ledger
afterwards, so the report shows what the engine DID, not what it reported.
"""
import argparse, html, json, subprocess, sys, time, urllib.request, datetime

# ── driving ───────────────────────────────────────────────────────────────

def post(url, body, timeout=60):
    """curl, not urllib — the edge 403s urllib's fingerprint, and a report
    built on eight failed requests looks exactly like a report on eight bad
    replies. Failures raise; they never become transcript text."""
    t0 = time.time()
    out = subprocess.run(
        ['curl', '-sS', '--fail-with-body', '-m', str(timeout), '-X', 'POST', url,
         '-H', 'content-type: application/json', '-d', json.dumps(body)],
        capture_output=True, text=True)
    secs = time.time() - t0
    if out.returncode != 0:
        raise RuntimeError(f'HTTP failed ({out.returncode}): {out.stderr.strip()[:200]}')
    return json.loads(out.stdout), secs


def d1(db, env, sql):
    out = subprocess.run(
        ['npx', 'wrangler', 'd1', 'execute', db, '--env', env, '--remote',
         '--json', '--command', ' '.join(sql.split())],
        capture_output=True, text=True)
    if out.returncode != 0:
        return []
    try:
        return json.loads(out.stdout[out.stdout.index('['):])[0]['results']
    except Exception:
        return []


def run_scenario(scn, url, session_id):
    turns = []
    for t in scn['turns']:
        body = {'session_id': session_id, 'message': t['say'],
                'builder_id': scn.get('builder_id', 'naya-advisor')}
        # A chip tap carries an action_id; that is the ONLY thing separating it
        # from prose, and several findings turn on chips whose label got parsed
        # as buyer text. A scenario has to be able to send both.
        if t.get('action_id'):
            body['action_id'] = t['action_id']
        if t.get('preferences'):
            body['preferences'] = t['preferences']
        try:
            resp, secs = post(f'{url}/api/advisor/turn', body)
        except Exception as e:
            # Abort rather than render. A transcript of failed requests reads
            # like a transcript of bad answers, and that is a worse lie than
            # no report at all.
            sys.exit(f'ABORT on turn {len(turns) + 1} ({t["say"][:40]!r}): {e}')
        turns.append({
            **t,
            'reply': resp.get('reply') or resp.get('error') or '',
            'secs': secs,
            'goal': (resp.get('debug') or {}).get('goal', {}).get('kind', '-'),
            'topic': (resp.get('debug') or {}).get('goal', {}).get('topic'),
            'prefs': resp.get('prefs_snapshot') or {},
            'projects': [p.get('name') for p in (resp.get('projects') or [])],
            'chips': (resp.get('nba') or {}).get('chips') or [],
            # The ledger is keyed on the Desk conversation, not the advisor
            # session. Take the id the response hands back rather than
            # guessing a join — the first attempt guessed and silently
            # attached nothing.
            'nd': resp.get('nd_conversation_id') or resp.get('conversation_id'),
        })
    return turns


def check(turn):
    """Evaluate the scenario's assertions against the real reply."""
    out = []
    reply = (turn.get('reply') or '').lower()
    for e in turn.get('expect', []):
        kind, val = e['kind'], e.get('value')
        if kind == 'contains':
            ok = str(val).lower() in reply
        elif kind == 'not_contains':
            ok = str(val).lower() not in reply
        elif kind == 'goal_is':
            ok = turn.get('goal') == val
        elif kind == 'max_seconds':
            ok = turn.get('secs', 99) <= float(val)
        else:
            ok = None
        out.append({**e, 'ok': ok})
    return out


def attach_shadow(turns, db, env):
    nd = next((t.get('nd') for t in turns if t.get('nd')), None)
    if not nd:
        print('  (no nd_conversation_id on any turn — no shadow to attach)')
        return turns
    rows = d1(db, env, f"""
        SELECT json_extract(action_plan_json,'$.chip_shadow') sh
        FROM turn_ledger WHERE conversation_id = '{nd}' ORDER BY created_at""")
    shadows = [json.loads(r['sh']) if isinstance(r['sh'], str) else r['sh']
               for r in rows if r.get('sh')]
    if not shadows:
        print(f'  (no chip_shadow rows for {nd} — is the shadow branch deployed?)')
    for i, t in enumerate(turns):
        if i < len(shadows):
            t['shadow'] = shadows[i]
    return turns

# ── rendering ─────────────────────────────────────────────────────────────

E = html.escape

CSS = """
:root{
  --ink:#161a20; --ink-2:#4a5361; --ink-3:#79828f;
  --paper:#f7f8fa; --card:#ffffff; --line:#e2e6ec;
  --accent:#1f5f8b; --accent-soft:#e8f0f6;
  --bad:#a4262c; --bad-soft:#fbeaea;
  --warn:#8a5a00; --warn-soft:#fdf3e0;
  --good:#1e6b45; --good-soft:#e6f3ec;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;
}
@media (prefers-color-scheme:dark){:root{
  --ink:#e6eaf0; --ink-2:#a8b2c0; --ink-3:#78828f;
  --paper:#0e1116; --card:#161a21; --line:#262c36;
  --accent:#69a8d4; --accent-soft:#16283a;
  --bad:#e8797f; --bad-soft:#2e1a1c;
  --warn:#d9a441; --warn-soft:#2c2313;
  --good:#6cc294; --good-soft:#14291f;
}}
:root[data-theme="dark"]{
  --ink:#e6eaf0; --ink-2:#a8b2c0; --ink-3:#78828f;
  --paper:#0e1116; --card:#161a21; --line:#262c36;
  --accent:#69a8d4; --accent-soft:#16283a;
  --bad:#e8797f; --bad-soft:#2e1a1c;
  --warn:#d9a441; --warn-soft:#2c2313;
  --good:#6cc294; --good-soft:#14291f;
}
:root[data-theme="light"]{
  --ink:#161a20; --ink-2:#4a5361; --ink-3:#79828f;
  --paper:#f7f8fa; --card:#ffffff; --line:#e2e6ec;
  --accent:#1f5f8b; --accent-soft:#e8f0f6;
  --bad:#a4262c; --bad-soft:#fbeaea;
  --warn:#8a5a00; --warn-soft:#fdf3e0;
  --good:#1e6b45; --good-soft:#e6f3ec;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
  font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:40px 24px 96px;
  display:flex;flex-direction:column;gap:36px}
header h1{margin:0 0 6px;font-size:26px;letter-spacing:-.02em;text-wrap:balance}
.sub{color:var(--ink-2);font-size:14px}
.meta{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:14px;
  font:12px/1.5 var(--mono);color:var(--ink-3)}
.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.stat .k{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3)}
.stat .v{font:600 22px/1.2 var(--mono);font-variant-numeric:tabular-nums;margin-top:6px}
.stat.bad .v{color:var(--bad)} .stat.good .v{color:var(--good)} .stat.warn .v{color:var(--warn)}
h2{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);
  margin:0 0 14px;font-weight:600}
.turn{background:var(--card);border:1px solid var(--line);border-radius:12px;
  margin-bottom:14px;overflow:hidden}
.turn-head{display:flex;gap:12px;align-items:baseline;padding:12px 16px;
  border-bottom:1px solid var(--line);background:var(--accent-soft)}
.turn-n{font:600 11px var(--mono);color:var(--accent);flex:none}
.say{font-weight:600;flex:1;min-width:0}
.tag{font:11px var(--mono);color:var(--ink-3);white-space:nowrap;
  font-variant-numeric:tabular-nums}
.tag.slow{color:var(--bad);font-weight:600}
.body{display:grid;grid-template-columns:1fr 280px;gap:0}
@media(max-width:760px){.body{grid-template-columns:1fr}}
.reply{padding:14px 16px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}
.rail{border-left:1px solid var(--line);padding:14px 16px;background:var(--paper)}
@media(max-width:760px){.rail{border-left:0;border-top:1px solid var(--line)}}
.rail h4{margin:0 0 8px;font:600 10px/1 var(--mono);letter-spacing:.09em;
  text-transform:uppercase;color:var(--ink-3)}
.chip{display:flex;justify-content:space-between;gap:8px;font:12px var(--mono);
  padding:3px 0;color:var(--ink-2)}
.chip b{color:var(--ink);font-variant-numeric:tabular-nums;font-weight:600}
.assert{display:flex;gap:8px;padding:9px 16px;font-size:13px;border-top:1px solid var(--line)}
.assert.fail{background:var(--bad-soft)} .assert.pass{background:var(--good-soft)}
.assert .m{font:600 11px var(--mono);flex:none;padding-top:2px}
.assert.fail .m{color:var(--bad)} .assert.pass .m{color:var(--good)}
.assert .why{color:var(--ink-2)}
.note{padding:9px 16px;border-top:1px solid var(--line);background:var(--warn-soft);
  font-size:13px;color:var(--ink-2)}
.essay{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px 28px}
.essay :where(h3){font-size:16px;margin:26px 0 8px;letter-spacing:-.01em}
.essay :where(h3):first-child{margin-top:0}
.essay :where(p,li){color:var(--ink-2);max-width:68ch}
.essay code{font:13px var(--mono);background:var(--accent-soft);padding:1px 5px;border-radius:4px}
.essay table{border-collapse:collapse;width:100%;font-size:13px;margin:12px 0}
.essay th,.essay td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}
.essay th{font:600 11px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
.scroll{overflow-x:auto}
footer{color:var(--ink-3);font-size:12px;border-top:1px solid var(--line);padding-top:16px}
"""


def render(scn, turns, meta, essay_html=''):
    fails = sum(1 for t in turns for c in t['checks'] if c['ok'] is False)
    slow = sum(1 for t in turns if t['secs'] > 2)
    worst = max((t['secs'] for t in turns), default=0)

    parts = [f'<title>{E(scn["name"])}</title><style>{CSS}</style>',
             '<div class="wrap">',
             '<header>',
             f'<h1>{E(scn["name"])}</h1>',
             f'<div class="sub">{E(scn.get("intent",""))}</div>',
             '<div class="meta">'
             + ' '.join(f'<span>{E(k)} {E(str(v))}</span>' for k, v in meta.items())
             + '</div></header>']

    parts.append('<section class="strip">'
        + f'<div class="stat"><div class="k">Turns</div><div class="v">{len(turns)}</div></div>'
        + f'<div class="stat {"bad" if fails else "good"}"><div class="k">Failed checks</div>'
          f'<div class="v">{fails}</div></div>'
        + f'<div class="stat {"bad" if slow else "good"}"><div class="k">Over 2s</div>'
          f'<div class="v">{slow}/{len(turns)}</div></div>'
        + f'<div class="stat {"bad" if worst>2 else "good"}"><div class="k">Slowest turn</div>'
          f'<div class="v">{worst:.1f}s</div></div>'
        + '</section>')

    parts.append('<section><h2>The conversation</h2>')
    for i, t in enumerate(turns, 1):
        slow_cls = ' slow' if t['secs'] > 2 else ''
        goal = t['goal'] + (f"/{t['topic']}" if t.get('topic') else '')
        parts.append(f'''<article class="turn">
          <div class="turn-head"><span class="turn-n">{i:02d}</span>
            <span class="say">{E(t["say"])}</span>
            <span class="tag">{E(goal)}</span>
            <span class="tag{slow_cls}">{t["secs"]:.2f}s</span></div>
          <div class="body"><div class="reply">{E(t["reply"]) or "<em>(empty)</em>"}</div>
          <div class="rail">''')
        # The brief the engine is holding. The SPA renders the buyer's brief
        # from this snapshot, so a correction that moves the engine but not
        # this still shows the buyer their old number.
        if t.get('prefs'):
            parts.append('<h4>Brief held after this turn</h4>')
            for k in ('location', 'bhk', 'budget', 'property_type', 'purpose'):
                if t['prefs'].get(k):
                    parts.append(f'<div class="chip"><span>{E(k)}</span>'
                                 f'<b>{E(str(t["prefs"][k]))}</b></div>')
            parts.append('<div style="height:14px"></div>')
        sh = t.get('shadow')
        if sh:
            parts.append(f'<h4>Chips the ranker would offer</h4>')
            if sh.get('ranked'):
                for c in sh['ranked']:
                    a = ' *' if c.get('assumed') else ''
                    parts.append(f'<div class="chip"><span>{E(c["label"])}{a}</span>'
                                 f'<b>{c["p"]*100:.0f}%</b></div>')
            else:
                parts.append('<div class="chip"><span>none offerable</span></div>')
            parts.append(f'<div class="chip" style="margin-top:8px;color:var(--ink-3)">'
                         f'<span>from {E(sh["from"])}</span><b>n={sh["support"]}</b></div>')
        if t.get('chips'):
            parts.append('<h4 style="margin-top:14px">Chips actually shown</h4>')
            for c in t['chips'][:6]:
                parts.append(f'<div class="chip"><span>{E(c)}</span></div>')
        parts.append('</div></div>')
        if t.get('note'):
            parts.append(f'<div class="note">{E(t["note"])}</div>')
        for c in t['checks']:
            if c['ok'] is None:
                continue
            cls = 'pass' if c['ok'] else 'fail'
            mark = 'PASS' if c['ok'] else 'FAIL'
            desc = f'{c["kind"]} “{c.get("value","")}”'
            why = f' — {c["why"]}' if c.get('why') else ''
            parts.append(f'<div class="assert {cls}"><span class="m">{mark}</span>'
                         f'<span><code>{E(desc)}</code><span class="why">{E(why)}</span></span></div>')
        parts.append('</article>')
    parts.append('</section>')

    if essay_html:
        parts.append(f'<section><h2>Reading</h2><div class="essay">{essay_html}</div></section>')

    parts.append(f'<footer>Generated by scripts/conversation-report.py against '
                 f'{E(meta.get("deployment",""))}. Every turn above is a real request; '
                 f'replies are verbatim.</footer></div>')
    return '\n'.join(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('scenario')
    ap.add_argument('--url', default='https://converse-spine-dev.nagarjun-arjun.workers.dev')
    ap.add_argument('--db', default='naya-db-dev')
    ap.add_argument('--env', default='dev')
    ap.add_argument('--essay', help='HTML fragment inlined as the closing section')
    ap.add_argument('--out', default='conversation-report.html')
    a = ap.parse_args()

    scn = json.load(open(a.scenario))
    sid = f"rep-{int(time.time())}"
    turns = run_scenario(scn, a.url, sid)
    for t in turns:
        t['checks'] = check(t)
    time.sleep(4)                                   # let the ledger settle
    turns = attach_shadow(turns, a.db, a.env)

    essay = open(a.essay).read() if a.essay else ''
    meta = {
        'scenario': a.scenario.split('/')[-1],
        'session': sid,
        'deployment': a.url.replace('https://', ''),
        'run': datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC'),
    }
    open(a.out, 'w').write(render(scn, turns, meta, essay))
    fails = sum(1 for t in turns for c in t['checks'] if c['ok'] is False)
    print(f'{a.out}  —  {len(turns)} turns, {fails} failed checks')
    for t in turns:
        bad = [c for c in t['checks'] if c['ok'] is False]
        print(f'  {t["secs"]:5.2f}s  {t["goal"]:<10} {t["say"][:52]:<52} {"FAIL " * len(bad)}')


if __name__ == '__main__':
    main()
