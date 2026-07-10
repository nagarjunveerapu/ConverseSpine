#!/usr/bin/env npx tsx
/**
 * Run buyer scenarios and emit a line-by-line HTML report focused on P6 BAML.
 *
 *   CONVERSE_SPINE_URL=https://converse-spine-dev... \
 *     npx tsx scripts/baml-scenario-report.ts --only ADV-H01,ADV-F01,MEM-G01,SA-G01,V01
 *
 * Optional second baseline for reply A/B (promote vs shadow/off):
 *   BASELINE_DIR=scenarios/runs/<prior> npx tsx scripts/baml-scenario-report.ts ...
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCENARIO_DIR = join(ROOT, 'scenarios', 'buyer');
const SPINE = (process.env.CONVERSE_SPINE_URL ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev').replace(
  /\/+$/,
  '',
);

interface AssertSpec {
  reply_includes?: string[];
  reply_excludes?: string[];
  speech_act?: string;
  goal_kind?: string;
  goal_topic?: string;
}

interface ScenarioTurn {
  text: string;
  assert?: AssertSpec;
}

interface BuyerScenario {
  id: string;
  title: string;
  builder_id: string;
  turns: ScenarioTurn[];
}

interface BamlReport {
  mode?: string;
  called?: boolean;
  would_fill?: string[];
  disagree?: string[];
  confidence?: string;
  abstain_reason?: string;
}

interface TurnRow {
  index: number;
  buyer: string;
  reply: string;
  pass: boolean;
  failures: string[];
  phase?: string;
  goalKind?: string;
  goalTopic?: string;
  speechAct?: string;
  baml?: BamlReport;
  extractPath?: string;
}

interface ScenarioRow {
  id: string;
  title: string;
  builder_id: string;
  ok: boolean;
  turns: TurnRow[];
}

function parseOnly(): Set<string> | undefined {
  const idx = process.argv.indexOf('--only');
  if (idx < 0 || !process.argv[idx + 1]) return undefined;
  return new Set(process.argv[idx + 1]!.split(',').map((s) => s.trim()).filter(Boolean));
}

function loadScenarios(only?: Set<string>): BuyerScenario[] {
  const files = readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.json')).sort();
  const out: BuyerScenario[] = [];
  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(SCENARIO_DIR, f), 'utf8')) as BuyerScenario | BuyerScenario[];
    for (const s of Array.isArray(raw) ? raw : [raw]) {
      if (only && !only.has(s.id)) continue;
      out.push(s);
    }
  }
  return out;
}

function checkAssert(reply: string, debug: Record<string, unknown> | undefined, a: AssertSpec): string[] {
  const fails: string[] = [];
  const lower = reply.toLowerCase();
  for (const needle of a.reply_includes ?? []) {
    if (!lower.includes(needle.toLowerCase())) fails.push(`include "${needle}"`);
  }
  for (const needle of a.reply_excludes ?? []) {
    if (lower.includes(needle.toLowerCase())) fails.push(`exclude "${needle}"`);
  }
  if (a.speech_act && debug?.speech_act && debug.speech_act !== a.speech_act) {
    fails.push(`speech_act=${String(debug.speech_act)}`);
  }
  const goal = (debug?.goal ?? {}) as { kind?: string; topic?: string };
  if (a.goal_kind && goal.kind && goal.kind !== a.goal_kind) fails.push(`goal.kind=${goal.kind}`);
  if (a.goal_topic && goal.topic && goal.topic !== a.goal_topic) fails.push(`goal.topic=${goal.topic}`);
  return fails;
}

async function chat(
  builderId: string,
  phone: string,
  text: string,
  convId?: string,
): Promise<{ reply_text: string; conversation_id: string; debug?: Record<string, unknown> }> {
  const r = await fetch(`${SPINE}/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 (compatible; NayaBamlReport/1.0)',
    },
    body: JSON.stringify({
      builder_id: builderId,
      buyer_phone: phone,
      text,
      ...(convId ? { conversation_id: convId } : {}),
    }),
  });
  const body = (await r.json()) as {
    reply_text?: string;
    reply?: string;
    conversation_id?: string;
    debug?: Record<string, unknown>;
    error?: string;
  };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return {
    reply_text: body.reply_text ?? body.reply ?? '',
    conversation_id: body.conversation_id ?? '',
    debug: body.debug,
  };
}

function extractBaml(debug?: Record<string, unknown>): BamlReport | undefined {
  const prov = debug?.extract_provenance as { baml?: BamlReport; path?: string } | undefined;
  return prov?.baml;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bamlBadge(b?: BamlReport): string {
  if (!b?.called) return '<span class="badge muted">BAML not called</span>';
  if (b.confidence === 'abstain') {
    return `<span class="badge warn">BAML abstain${b.abstain_reason ? `: ${esc(b.abstain_reason)}` : ''}</span>`;
  }
  const fill = (b.would_fill ?? []).join(', ') || '—';
  const disagree = (b.disagree ?? []).join(', ') || '—';
  return `<span class="badge ok">called (${esc(b.mode ?? '?')})</span>
    <div class="meta">would_fill: <code>${esc(fill)}</code></div>
    <div class="meta">disagree: <code>${esc(disagree)}</code></div>`;
}

function loadBaseline(dir: string): Map<string, ScenarioRow> {
  const map = new Map<string, ScenarioRow>();
  if (!existsSync(dir)) return map;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'summary.json')) {
    const row = JSON.parse(readFileSync(join(dir, f), 'utf8')) as ScenarioRow;
    map.set(row.id, row);
  }
  return map;
}

function renderHtml(
  label: string,
  spine: string,
  scenarios: ScenarioRow[],
  baseline?: Map<string, ScenarioRow>,
): string {
  const bamlCalled = scenarios.reduce(
    (n, s) => n + s.turns.filter((t) => t.baml?.called).length,
    0,
  );
  const wouldFill = scenarios.reduce(
    (n, s) => n + s.turns.filter((t) => (t.baml?.would_fill?.length ?? 0) > 0).length,
    0,
  );
  const replyDiffs = baseline
    ? scenarios.reduce((n, s) => {
        const b = baseline.get(s.id);
        if (!b) return n;
        return (
          n +
          s.turns.filter((t, i) => {
            const bt = b.turns[i];
            return bt && normalizeReply(bt.reply) !== normalizeReply(t.reply);
          }).length
        );
      }, 0)
    : 0;

  const sections = scenarios
    .map((s) => {
      const base = baseline?.get(s.id);
      const turns = s.turns
        .map((t, i) => {
          const bt = base?.turns[i];
          const replyChanged = bt ? normalizeReply(bt.reply) !== normalizeReply(t.reply) : false;
          return `<article class="turn ${t.pass ? 'pass' : 'fail'} ${replyChanged ? 'changed' : ''}">
  <header>
    <strong>T${t.index}</strong>
    <span class="pill">${esc(t.phase ?? '?')} · ${esc(t.goalKind ?? '?')}${t.goalTopic ? '/' + esc(t.goalTopic) : ''}</span>
    <span class="pill">${esc(t.speechAct ?? '—')}</span>
    ${t.pass ? '<span class="badge ok">assert HOLD</span>' : `<span class="badge bad">BREAK: ${esc(t.failures.join('; '))}</span>`}
    ${replyChanged ? '<span class="badge hot">REPLY CHANGED vs baseline</span>' : ''}
  </header>
  <div class="buyer"><div class="label">Buyer</div><div>${esc(t.buyer)}</div></div>
  <div class="bot"><div class="label">Bot ${label}</div><div>${esc(t.reply || '(empty)')}</div></div>
  ${
    bt
      ? `<div class="bot baseline"><div class="label">Bot baseline</div><div>${esc(bt.reply || '(empty)')}</div></div>`
      : ''
  }
  <div class="baml"><div class="label">P6 BAML</div>${bamlBadge(t.baml)}</div>
</article>`;
        })
        .join('\n');
      return `<section class="scenario">
  <h2>${esc(s.id)} — ${esc(s.title)} ${s.ok ? '✅' : '❌'}</h2>
  <p class="sub">${esc(s.builder_id)}</p>
  ${turns}
</section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>BAML scenario report — ${esc(label)}</title>
  <style>
    :root { --bg:#0f1419; --card:#1a222c; --ink:#e7eef7; --muted:#8b9bb0; --ok:#3ecf8e; --bad:#ff6b6b; --hot:#ffb020; --line:#2a3544; }
    body { margin:0; font:15px/1.45 ui-sans-serif, system-ui, sans-serif; background:var(--bg); color:var(--ink); }
    main { max-width: 980px; margin: 0 auto; padding: 28px 18px 80px; }
    h1 { font-size: 1.6rem; margin: 0 0 8px; }
    h2 { font-size: 1.15rem; margin: 28px 0 8px; }
    .sub, .lede { color: var(--muted); }
    .stats { display:grid; grid-template-columns: repeat(4,1fr); gap:10px; margin: 18px 0 28px; }
    .stat { background: var(--card); border:1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
    .stat strong { display:block; font-size: 1.35rem; }
    .turn { background: var(--card); border:1px solid var(--line); border-radius: 12px; padding: 14px; margin: 12px 0; }
    .turn.changed { border-color: var(--hot); }
    .turn.fail { border-color: var(--bad); }
    header { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom: 10px; }
    .buyer, .bot, .baml { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
    .bot.baseline { opacity: 0.85; }
    .label { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
    .badge, .pill { display:inline-block; border-radius: 999px; padding: 2px 8px; font-size: 12px; border:1px solid var(--line); }
    .badge.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 50%, var(--line)); }
    .badge.bad, .badge.hot { color: var(--hot); }
    .badge.warn { color: #f0c674; }
    .badge.muted { color: var(--muted); }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    .meta { color: var(--muted); font-size: 13px; margin-top: 4px; }
    .note { background:#142018; border:1px solid #244032; border-radius:10px; padding:12px 14px; margin: 12px 0 20px; }
  </style>
</head>
<body>
<main>
  <h1>P6 BAML — scenario line-by-line</h1>
  <p class="lede">${esc(label)} · ${esc(spine)} · ${esc(new Date().toISOString())}</p>
  <div class="note">
    <strong>How to read this:</strong> With <code>BAML_EXTRACT_MODE=shadow</code> (default on Dev),
    buyer-visible replies should match pre-P6. The BAML panel shows whether ExtractTurnFacts was
    called and what it <em>would</em> fill (<code>would_fill</code>) without merging.
    If a baseline dir was provided, reply diffs highlight what <code>promote</code> (or another mode) changed.
  </div>
  <div class="stats">
    <div class="stat"><strong>${scenarios.length}</strong>scenarios</div>
    <div class="stat"><strong>${scenarios.filter((s) => s.ok).length}</strong>passed</div>
    <div class="stat"><strong>${bamlCalled}</strong>turns BAML called</div>
    <div class="stat"><strong>${wouldFill}</strong>turns with would_fill${baseline ? ` · <strong>${replyDiffs}</strong> reply diffs` : ''}</div>
  </div>
  ${sections}
</main>
</body>
</html>`;
}

function normalizeReply(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

async function main(): Promise<void> {
  const only = parseOnly();
  const scenarios = loadScenarios(only);
  if (!scenarios.length) {
    console.error('No scenarios');
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(ROOT, 'scenarios', 'runs', `baml-${stamp}`);
  mkdirSync(runDir, { recursive: true });

  const label = process.env.BAML_REPORT_LABEL ?? 'dev-shadow';
  const baselineDir = process.env.BASELINE_DIR;
  const baseline = baselineDir ? loadBaseline(baselineDir) : undefined;

  console.log(`Spine → ${SPINE}`);
  console.log(`Out → ${runDir}`);
  if (baselineDir) console.log(`Baseline → ${baselineDir}`);

  const rows: ScenarioRow[] = [];
  for (const sc of scenarios) {
    const phone = `+9199${String(Date.now() % 1e10).padStart(10, '0')}${sc.id.length % 10}`;
    let convId: string | undefined;
    const turns: TurnRow[] = [];
    let ok = true;
    console.log(`\n══ ${sc.id} ══`);
    for (let i = 0; i < sc.turns.length; i++) {
      const turn = sc.turns[i]!;
      try {
        const resp = await chat(sc.builder_id, phone, turn.text, convId);
        convId = resp.conversation_id || convId;
        const failures = turn.assert ? checkAssert(resp.reply_text, resp.debug, turn.assert) : [];
        const pass = failures.length === 0;
        if (!pass) ok = false;
        const goal = (resp.debug?.goal ?? {}) as { kind?: string; topic?: string };
        const prov = resp.debug?.extract_provenance as { path?: string; baml?: BamlReport } | undefined;
        const row: TurnRow = {
          index: i + 1,
          buyer: turn.text,
          reply: resp.reply_text,
          pass,
          failures,
          phase: typeof resp.debug?.phase === 'string' ? resp.debug.phase : undefined,
          goalKind: goal.kind,
          goalTopic: goal.topic,
          speechAct: typeof resp.debug?.speech_act === 'string' ? resp.debug.speech_act : undefined,
          baml: extractBaml(resp.debug),
          extractPath: prov?.path,
        };
        turns.push(row);
        const bamlNote = row.baml?.called
          ? `baml:${row.baml.mode}/${row.baml.confidence} fill=${(row.baml.would_fill ?? []).join('|') || '—'}`
          : 'baml:—';
        console.log(`  ${pass ? '✓' : '✗'} t${i + 1} ${turn.text.slice(0, 40)} · ${bamlNote}`);
      } catch (e) {
        ok = false;
        turns.push({
          index: i + 1,
          buyer: turn.text,
          reply: '',
          pass: false,
          failures: [e instanceof Error ? e.message : String(e)],
        });
        console.log(`  ✗ t${i + 1} ERROR`);
        break;
      }
    }
    const record: ScenarioRow = {
      id: sc.id,
      title: sc.title,
      builder_id: sc.builder_id,
      ok,
      turns,
    };
    rows.push(record);
    writeFileSync(join(runDir, `${sc.id}.json`), JSON.stringify(record, null, 2));
  }

  writeFileSync(join(runDir, 'summary.json'), JSON.stringify({ spine: SPINE, label, at: new Date().toISOString(), rows }, null, 2));
  const htmlPath = join(runDir, 'baml-report.html');
  writeFileSync(htmlPath, renderHtml(label, SPINE, rows, baseline));
  console.log(`\nHTML → ${htmlPath}`);
  process.exit(rows.every((r) => r.ok) ? 0 : 1);
}

main();
