/**
 * Did teaching it actually change the answer?
 *
 * Every flag in the understanding layer is defended by a score, and a score can
 * improve while no buyer's reply moves — that is exactly how the routing verdict
 * sat unconsumed for weeks with `bind_source: embed_intent` climbing. So the
 * acceptance test for a flag flip is not a number. It is:
 *
 *     teach a phrasing whose answer already exists in the book
 *     → ask it
 *     → read the reply
 *
 * Two phases, because the teach click belongs on the Desk understanding board
 * (a human with `bot_ops` — `PATCH /:queue_id/promote` refuses `x-bot-secret`,
 * deliberately). This script owns everything either side of that click:
 *
 *   --phase before   ask each phrasing, record reply + routing verdict
 *   ‹ teach on the board ›
 *   --phase after    force the index rebuild, wait for it to be queryable,
 *                    ask again, diff, write the HTML report
 *
 * The rebuild is forced rather than waited for: `POST /internal/intent-rebuild`
 * exists precisely so a cutover does not sit until Monday 03:30.
 *
 * Usage:
 *   BOT_SHARED_SECRET=… npx tsx scripts/teach-then-ask.ts --phase before \
 *     --builder naya-advisor --ask "what facilities are there" --ask "any gym"
 *   ‹ promote those turns on the board ›
 *   BOT_SHARED_SECRET=… npx tsx scripts/teach-then-ask.ts --phase after
 *
 * `--expect <regex>` per ask makes the verdict mechanical instead of a read:
 *   --ask "any gym|gym|clubhouse|amenit"      (ask text | expected-answer regex)
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const SPINE =
  process.env.CONVERSE_SPINE_URL ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev';
const STATE = process.env.TEACH_LOOP_STATE ?? '.teach-then-ask.json';

/** The secret, from env or .dev.vars — same resolution the other scripts use. */
function secret(): string {
  if (process.env.BOT_SHARED_SECRET) return process.env.BOT_SHARED_SECRET.trim();
  try {
    const line = fs
      .readFileSync('.dev.vars', 'utf8')
      .split('\n')
      .find((l) => l.startsWith('BOT_SHARED_SECRET='));
    return line ? line.slice('BOT_SHARED_SECRET='.length).trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}

interface Probe {
  ask: string;
  expect?: string;
  reply: string;
  goal?: string;
  bind_source?: string;
  embedder_intent_kind?: string;
  embedder_score?: number;
  asked_topic?: string;
  answered: boolean | null;
}

interface Snapshot {
  phase: 'before' | 'after';
  at: string;
  builder: string;
  spine: string;
  probes: Probe[];
  rebuild?: unknown;
}

function args(): {
  phase: 'before' | 'after';
  builder: string;
  asks: Array<{ ask: string; expect?: string }>;
  skipRebuild: boolean;
} {
  const a = process.argv.slice(2);
  const get = (k: string, d?: string) => {
    const i = a.indexOf(k);
    return i >= 0 && a[i + 1] ? a[i + 1]! : d;
  };
  const asks: Array<{ ask: string; expect?: string }> = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--ask' && a[i + 1]) {
      // "text|regex" — the pipe splits the question from what a real answer holds
      const [ask, expect] = a[i + 1]!.split('|', 2);
      asks.push({ ask: ask!.trim(), ...(expect ? { expect: expect.trim() } : {}) });
    }
  }
  return {
    phase: (get('--phase', 'before') as 'before' | 'after') ?? 'before',
    builder: get('--builder', 'naya-advisor')!,
    asks,
    skipRebuild: a.includes('--no-rebuild'),
  };
}

/**
 * One cold turn per phrasing. A fresh uuid buyer each time — `sessionToPhone`
 * truncates to 10 chars, so readable ids silently share one buyer and the
 * second probe would answer from the first one's state.
 */
async function ask(builder: string, text: string): Promise<Omit<Probe, 'ask' | 'expect' | 'answered'>> {
  const r = await fetch(`${SPINE}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bot-secret': secret() },
    body: JSON.stringify({
      builder_id: builder,
      buyer_phone: `+9199${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`,
      thread_id: randomUUID(),
      text,
      channel: 'advisor_web',
    }),
  });
  const body = (await r.json()) as {
    reply?: string;
    debug?: {
      goal?: { kind?: string; askedTopic?: string };
      extract_provenance?: {
        routing_bind?: { bind_source?: string; top_kind?: string; top_score?: number };
      };
    };
  };
  const bind = body.debug?.extract_provenance?.routing_bind;
  return {
    reply: body.reply ?? '',
    ...(body.debug?.goal?.kind ? { goal: body.debug.goal.kind } : {}),
    ...(bind?.bind_source ? { bind_source: bind.bind_source } : {}),
    ...(bind?.top_kind ? { embedder_intent_kind: bind.top_kind } : {}),
    ...(bind?.top_score !== undefined ? { embedder_score: bind.top_score } : {}),
    ...(body.debug?.goal?.askedTopic ? { asked_topic: body.debug.goal.askedTopic } : {}),
  };
}

/** Force the corpus into the index. Without CS #210 this is a no-op on a flag
 *  flip — the manifest hash did not carry the embed mode, so nothing re-embeds. */
async function rebuild(): Promise<unknown> {
  const r = await fetch(`${SPINE}/internal/intent-rebuild`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bot-secret': secret() },
    body: JSON.stringify({}),
  });
  return (await r.json()) as unknown;
}

const esc = (s: string): string =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

function report(before: Snapshot, after: Snapshot, out: string): void {
  const rows = after.probes.map((a, i) => {
    const b = before.probes[i];
    const moved = b && b.reply.trim() !== a.reply.trim();
    const verdict =
      a.answered === null ? 'no-expect' : a.answered ? 'answered' : b?.answered ? 'REGRESSED' : 'still missing';
    return `<tr class="${verdict.replace(/\s/g, '-')}">
      <td class="q">${esc(a.ask)}${a.expect ? `<code>${esc(a.expect)}</code>` : ''}</td>
      <td><div class="r">${esc(b?.reply ?? '')}</div><span class="m">${esc(b?.goal ?? '')} · ${esc(b?.bind_source ?? '')} ${esc(b?.embedder_intent_kind ?? '')}</span></td>
      <td><div class="r">${esc(a.reply)}</div><span class="m">${esc(a.goal ?? '')} · ${esc(a.bind_source ?? '')} ${esc(a.embedder_intent_kind ?? '')}</span></td>
      <td class="v">${verdict}${moved ? '' : '<br><span class="m">reply unchanged</span>'}</td>
    </tr>`;
  });
  const gained = after.probes.filter((a, i) => a.answered && !before.probes[i]?.answered).length;
  fs.writeFileSync(
    out,
    `<!doctype html><meta charset="utf-8"><title>teach → ask</title>
<style>
:root{--bg:#fbfaf8;--ink:#1a1a1a;--mut:#6b6b6b;--line:#e3e0da;--ok:#1a7f4b;--bad:#b3261e}
@media(prefers-color-scheme:dark){:root{--bg:#14140f;--ink:#eeece6;--mut:#9a978f;--line:#33322c}}
body{background:var(--bg);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui;margin:0;padding:32px}
h1{font-size:20px;margin:0 0 4px}p.sub{color:var(--mut);margin:0 0 24px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--line)}
th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut)}
td.q{width:20%;font-weight:600}code{display:block;font-size:11px;color:var(--mut);font-weight:400;margin-top:4px}
.r{max-width:38ch}.m{font-size:11px;color:var(--mut)}
td.v{width:12%;font-weight:600}tr.answered td.v{color:var(--ok)}tr.REGRESSED td.v,tr.still-missing td.v{color:var(--bad)}
</style>
<h1>teach → ask</h1>
<p class="sub">${esc(after.builder)} · ${esc(after.spine)} · before ${esc(before.at)} → after ${esc(after.at)}
 · <strong>${gained}</strong> of ${after.probes.length} newly answered</p>
<table><tr><th>asked</th><th>before teaching</th><th>after teaching + rebuild</th><th>verdict</th></tr>
${rows.join('\n')}</table>
<p class="sub" style="margin-top:24px">Rebuild report: <code>${esc(JSON.stringify(after.rebuild ?? {}))}</code></p>`,
  );
}

async function main(): Promise<void> {
  const { phase, builder, asks, skipRebuild } = args();
  if (!secret()) {
    console.error('BOT_SHARED_SECRET missing (env or .dev.vars)');
    process.exit(1);
  }

  if (phase === 'before') {
    if (!asks.length) {
      console.error('--phase before needs at least one --ask "text|expected-regex"');
      process.exit(1);
    }
    const probes: Probe[] = [];
    for (const { ask: q, expect } of asks) {
      const got = await ask(builder, q);
      const answered = expect ? new RegExp(expect, 'i').test(got.reply) : null;
      probes.push({ ask: q, ...(expect ? { expect } : {}), ...got, answered });
      console.log(`  ${answered === null ? '·' : answered ? '✓' : '✗'} ${q}\n    ${got.reply.slice(0, 120)}`);
    }
    const snap: Snapshot = {
      phase: 'before',
      at: new Date().toISOString(),
      builder,
      spine: SPINE,
      probes,
    };
    fs.writeFileSync(STATE, JSON.stringify(snap, null, 2));
    console.log(`\nbaseline saved → ${STATE}`);
    console.log('Now promote those phrasings on the Desk understanding board, then re-run with --phase after.');
    return;
  }

  if (!fs.existsSync(STATE)) {
    console.error(`no baseline at ${STATE} — run --phase before first`);
    process.exit(1);
  }
  const before = JSON.parse(fs.readFileSync(STATE, 'utf8')) as Snapshot;

  let rep: unknown;
  if (!skipRebuild) {
    rep = await rebuild();
    console.log('rebuild:', JSON.stringify(rep));
    // Vectorize writes are queryable after 5–10s. Asking sooner reads the old
    // index and reports a false negative on a rebuild that actually worked.
    await new Promise((r) => setTimeout(r, 15_000));
  }

  const probes: Probe[] = [];
  for (const p of before.probes) {
    const got = await ask(before.builder, p.ask);
    const answered = p.expect ? new RegExp(p.expect, 'i').test(got.reply) : null;
    probes.push({ ask: p.ask, ...(p.expect ? { expect: p.expect } : {}), ...got, answered });
    console.log(`  ${answered === null ? '·' : answered ? '✓' : '✗'} ${p.ask}\n    ${got.reply.slice(0, 120)}`);
  }
  const after: Snapshot = {
    phase: 'after',
    at: new Date().toISOString(),
    builder: before.builder,
    spine: SPINE,
    probes,
    ...(rep ? { rebuild: rep } : {}),
  };
  const out = path.resolve('teach-then-ask.html');
  report(before, after, out);
  const gained = probes.filter((a, i) => a.answered && !before.probes[i]?.answered).length;
  console.log(`\n${gained}/${probes.length} newly answered → ${out}`);
  // Non-zero exit when a probe that used to answer stopped — a flag flip that
  // costs an answer must fail the gate, not read as "0 gained".
  const regressed = probes.filter((a, i) => before.probes[i]?.answered && a.answered === false).length;
  if (regressed) {
    console.error(`${regressed} REGRESSED`);
    process.exit(2);
  }
}

void main();
