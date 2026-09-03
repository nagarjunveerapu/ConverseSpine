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

# chat-report.py has the hyphen a module name cannot, and there is no
# reason to have two renderers drifting apart.
_spec = importlib.util.spec_from_file_location('chatreport', HERE / 'chat-report.py')
_cr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_cr)

DIM, BOLD, CYAN, RED, GREY, RESET = (
    ('\033[2m', '\033[1m', '\033[36m', '\033[31m', '\033[90m', '\033[0m')
    if sys.stdout.isatty() else ('', '', '', '', '', ''))


# Embedding cuts ACROSS the phases rather than sitting between them — the lanes
# fire inside pre_extract, routing and mid — so summing embed_ms with the phases
# would double-count it and make `unaccounted` read negative. It gets its own
# line, and the count leads: Workers AI is priced per call, not per text.
_SPANNING = ('embed_ms',)


def fmt_timing(t):
    if not t:
        return f'{GREY}(no timings in debug — is this an old deployment?){RESET}'
    total = t.get('total_ms', 0)
    phases = {k: v for k, v in t.items()
              if k.endswith('_ms') and k != 'total_ms' and k not in _SPANNING}
    parts = [f'{k[:-3]} {v}ms' for k, v in sorted(phases.items(), key=lambda kv: -kv[1]) if v]
    unaccounted = total - sum(phases.values())
    line = (f'{GREY}' + '  '.join(parts)
            + f'  |  unaccounted {unaccounted}ms  |  total {total}ms{RESET}')

    calls = t.get('embed_calls')
    if calls:
        ms, texts = t.get('embed_ms', 0), t.get('embed_texts', 0)
        share = f'{100 * ms / total:.0f}%' if total else '?'
        # Red at 2+ because one turn should reach Workers AI once. Every extra
        # call is a fixed ~266ms the buyer waits for, whatever the text size.
        tone = RED if calls > 1 else GREY
        line += (f'\n{tone}embed  {calls} call{"s" if calls != 1 else ""}'
                 f' · {texts} text{"s" if texts != 1 else ""}'
                 f' · {ms}ms ({share} of the turn){RESET}')
    return line


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='https://converse-spine-dev.nagarjun-arjun.workers.dev')
    ap.add_argument('--allow-prod', action='store_true',
                    help='required to point this at anything that is not a dev deployment')
    ap.add_argument('--builder', default='naya-advisor')
    ap.add_argument('--session', help='resume an existing session id')
    ap.add_argument('--report', default=None, help='where to write the HTML transcript')
    a = ap.parse_args()

    # Dev by default is not the same as dev only. Prod is one --url away in the
    # same config (converse-spine -> nayadesk), and a real conversation written
    # to prod is not something you can quietly undo. Production is deferred
    # pre-MVP, so reaching it has to be a sentence someone typed on purpose.
    #
    # Check the WORKER NAME, not the url. Every Cloudflare worker lives under
    # `.workers.dev`, so a substring test for 'dev' passes prod — which is what
    # the first version of this guard did, and it let
    # converse-spine.nagarjun-arjun.workers.dev straight through.
    host = a.url.split('://')[-1].split('/')[0].split(':')[0]
    worker = host.split('.')[0]
    is_dev = worker.endswith('dev') or host in ('localhost', '127.0.0.1')
    if not is_dev and not a.allow_prod:
        sys.exit(f'{RED}refusing: worker "{worker}" is not a dev deployment.{RESET}\n'
                 f'Production is deferred pre-MVP and these turns write real leads.\n'
                 f'Pass --allow-prod if you really mean it.')

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
            print(fmt_timing(((last or {}).get('debug') or {}).get('timings')), '\n')
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
            'nd': resp.get('nd_thread_id'),
            'timings': debug.get('timings') or {},
        })

        slow = RED if secs > 2 else GREY
        print(f'{BOLD}naya>{RESET} {reply}')
        print(f'{GREY}{kind}{RESET}  {slow}{secs:.2f}s{RESET}')
        if debug.get('timings'):
            print(fmt_timing(debug['timings']))
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
