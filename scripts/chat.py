#!/usr/bin/env python3
"""
Talk to the bot from a terminal. Pure free text — no chips, no brief funnel.

    python3 scripts/chat.py                     # against dev
    python3 scripts/chat.py --report run.html   # ...and write the transcript

Type and press enter. The reply comes back with the goal it chose and how long
it took. Commands:

    /new        start a clean session (new conversation, new lead)
    /report     write the HTML transcript so far
    /timing     show the per-phase breakdown for the last turn
    /raw        dump the last full response body
    /quit       write the report and exit

This is the pure-chat path on purpose: no `preferences`, no `action_id`. The
four-question funnel is a SPA construct built out of chips; sending free text
straight at the door is the conversation without it, which is the thing worth
judging.

Every session writes an HTML report on exit — the transcript is the artifact,
not the numbers printed here.
"""
import argparse, datetime, importlib.util, json, os, pathlib, subprocess, sys, time, uuid

HERE = pathlib.Path(__file__).parent

# conversation-report.py has the hyphen a module name cannot, and there is no
# reason to have two renderers drifting apart.
_spec = importlib.util.spec_from_file_location('convreport', HERE / 'conversation-report.py')
_cr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_cr)

DIM, BOLD, CYAN, RED, GREY, RESET = (
    ('\033[2m', '\033[1m', '\033[36m', '\033[31m', '\033[90m', '\033[0m')
    if sys.stdout.isatty() else ('', '', '', '', '', ''))


def fmt_timing(t):
    if not t:
        return f'{GREY}(no timing — deploy feat/turn-timing to see the breakdown){RESET}'
    total = t.get('total', 0)
    parts = [f'{k} {v}ms' for k, v in t.items() if k != 'total']
    unaccounted = total - sum(v for k, v in t.items() if k != 'total')
    return (f'{GREY}' + '  '.join(parts)
            + f'  |  unaccounted {unaccounted}ms  |  total {total}ms{RESET}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='https://converse-spine-dev.nagarjun-arjun.workers.dev')
    ap.add_argument('--builder', default='naya-advisor')
    ap.add_argument('--session', help='resume an existing session id')
    ap.add_argument('--report', default=None, help='where to write the HTML transcript')
    a = ap.parse_args()

    session = a.session or f'cli-{int(time.time())}-{uuid.uuid4().hex[:6]}'
    turns, last = [], None

    def write_report(path):
        scn = {'name': f'Terminal session — {session}',
               'intent': 'Free text only, straight at the door: no chips, no brief funnel.'}
        for t in turns:
            t.setdefault('expect', [])
            t['checks'] = _cr.check(t)
        meta = {'session': session, 'deployment': a.url.replace('https://', ''),
                'turns': len(turns),
                'run': datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}
        pathlib.Path(path).write_text(_cr.render(scn, turns, meta))
        print(f'{CYAN}wrote {path}{RESET}  ({len(turns)} turns)')

    print(f'{BOLD}naya{RESET} {DIM}· {a.url.replace("https://","")} · {a.builder}{RESET}')
    print(f'{DIM}session {session} — /new /report /timing /raw /quit{RESET}\n')

    while True:
        try:
            text = input(f'{CYAN}you>{RESET} ').strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not text:
            continue
        if text == '/quit':
            break
        if text == '/new':
            session = f'cli-{int(time.time())}-{uuid.uuid4().hex[:6]}'
            turns, last = [], None
            print(f'{DIM}new session {session}{RESET}\n')
            continue
        if text == '/report':
            write_report(a.report or f'chat-{session}.html')
            continue
        if text == '/timing':
            print(fmt_timing(((last or {}).get('debug') or {}).get('timing')), '\n')
            continue
        if text == '/raw':
            print(json.dumps(last, indent=2)[:4000], '\n')
            continue

        try:
            resp, secs = _cr.post(f'{a.url}/api/advisor/turn',
                                  {'session_id': session, 'message': text,
                                   'builder_id': a.builder})
        except Exception as e:
            print(f'{RED}request failed: {e}{RESET}\n')
            continue

        last = resp
        debug = resp.get('debug') or {}
        goal = debug.get('goal', {})
        kind = goal.get('kind', '?') + (f"/{goal['topic']}" if goal.get('topic') else '')
        reply = resp.get('reply') or resp.get('error') or '(empty)'

        turns.append({
            'say': text, 'reply': reply, 'secs': secs, 'goal': goal.get('kind', '-'),
            'topic': goal.get('topic'), 'prefs': resp.get('prefs_snapshot') or {},
            'chips': (resp.get('nba') or {}).get('chips') or [],
            'nd': resp.get('nd_conversation_id'),
        })

        slow = RED if secs > 2 else GREY
        print(f'{BOLD}naya>{RESET} {reply}')
        print(f'{GREY}{kind}{RESET}  {slow}{secs:.2f}s{RESET}')
        if debug.get('timing'):
            print(fmt_timing(debug['timing']))
        prefs = resp.get('prefs_snapshot') or {}
        if prefs:
            brief = ' · '.join(f'{k}={v}' for k, v in prefs.items()
                               if k in ('location', 'bhk', 'budget', 'property_type', 'purpose'))
            if brief:
                print(f'{GREY}brief: {brief}{RESET}')
        print()

    if turns:
        write_report(a.report or f'chat-{session}.html')


if __name__ == '__main__':
    main()
