#!/usr/bin/env npx tsx
/**
 * Broader scenario board + latency profile (local or dig).
 *
 *   npx tsx scripts/run-latency-scenario-board.ts
 *   # defaults to converse-spine-dev; override only if needed
 *
 * Runs quality-factory packs (subset) sequentially with gaps; records wall +
 * engine timings (extract/compose/total) and llm_used. Does not claim dig SLO
 * from local wrangler — prints distribution for diagnosis.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
/** Always dig unless explicitly overridden — never default to local wrangler. */
const SPINE = (
  process.env.CONVERSE_SPINE_URL ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev'
).replace(/\/+$/, '');
const GAP_MS = Number(process.env.SMOKE_GAP_MS ?? '2000');
const JOURNEY_GAP_MS = Number(process.env.SMOKE_JOURNEY_GAP_MS ?? '4000');

type Assert = {
  goal_kind?: string;
  goal_kind_not?: string;
  phase?: string;
  reply_includes?: string[];
  reply_includes_any?: string[];
  reply_excludes?: string[];
};

type PackTurn = { text: string; assert?: Assert };
type PackScenario = {
  id: string;
  title?: string;
  builder_id: string;
  turns: PackTurn[];
};

type TurnRec = {
  index: number;
  buyer: string;
  reply: string;
  wall_ms: number;
  extract_ms?: number;
  compose_ms?: number;
  total_ms?: number;
  llm_used?: boolean;
  compose_template?: boolean;
  goal?: unknown;
  phase?: string;
  pass: boolean;
  failures: string[];
};

function pct(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

function checkAssert(reply: string, debug: Record<string, unknown>, a?: Assert): string[] {
  if (!a) return [];
  const fails: string[] = [];
  const goal = debug.goal as { kind?: string } | undefined;
  const phase = String(debug.phase ?? '');
  const lower = reply.toLowerCase();
  if (a.goal_kind && goal?.kind !== a.goal_kind) fails.push(`goal=${goal?.kind} want ${a.goal_kind}`);
  if (a.goal_kind_not && goal?.kind === a.goal_kind_not) fails.push(`goal forbidden ${a.goal_kind_not}`);
  if (a.phase && phase !== a.phase) fails.push(`phase=${phase} want ${a.phase}`);
  for (const s of a.reply_includes ?? []) {
    if (!lower.includes(s.toLowerCase())) fails.push(`missing "${s}"`);
  }
  if (a.reply_includes_any?.length) {
    if (!a.reply_includes_any.some((s) => lower.includes(s.toLowerCase()))) {
      fails.push(`missing any of [${a.reply_includes_any.join('|')}]`);
    }
  }
  for (const s of a.reply_excludes ?? []) {
    if (lower.includes(s.toLowerCase())) fails.push(`excluded "${s}"`);
  }
  return fails;
}

async function chat(builderId: string, phone: string, text: string, threadId?: string) {
  const t0 = Date.now();
  const r = await fetch(`${SPINE}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      builder_id: builderId,
      buyer_phone: phone,
      text,
      ...(threadId ? { thread_id: threadId } : {}),
    }),
  });
  const body = (await r.json()) as Record<string, unknown>;
  const wall_ms = Date.now() - t0;
  if (!r.ok || body.status === 'error') {
    throw new Error(String(body.error ?? `HTTP ${r.status}`));
  }
  return {
    reply: String(body.reply_text ?? body.reply ?? ''),
    thread_id: String(body.thread_id ?? ''),
    debug: (body.debug as Record<string, unknown>) ?? {},
    wall_ms,
  };
}

function loadPack(name: string, limit?: number): PackScenario[] {
  const path = join(ROOT, 'scenarios/buyer/generated', name);
  const all = JSON.parse(readFileSync(path, 'utf8')) as PackScenario[];
  return limit != null ? all.slice(0, limit) : all;
}

/** Extra journeys for cost-stance / visit / ivory (generic classes). */
const EXTRA: PackScenario[] = [
  {
    id: 'EXTRA-PACKED-PRICE-LEGAL',
    title: 'Packed brochure + RERA (multi-intent)',
    builder_id: 'brigade-group',
    turns: [
      { text: 'hi' },
      { text: 'Brigade Eldorado' },
      {
        text: 'brochure and RERA please',
        assert: {
          reply_includes_any: ['rera', 'brochure', 'PRM', 'registration'],
        },
      },
    ],
  },
  {
    id: 'EXTRA-PACKED-SCHOOLS-PRICE',
    title: 'Packed schools + price',
    builder_id: 'brigade-group',
    turns: [
      { text: 'hi' },
      { text: '2 BHK apartment in Devanahalli under 1.5 Cr' },
      { text: 'Brigade Eldorado' },
      {
        text: 'schools nearby and starting price?',
        assert: {
          reply_includes_any: ['school', '₹', 'lakh', 'price'],
        },
      },
    ],
  },
  {
    id: 'EXTRA-COST-STANCE-EN',
    title: 'English evaluative cost after focus',
    builder_id: 'brigade-group',
    turns: [
      { text: 'hi' },
      { text: '2 BHK apartment in North Bangalore under 1.5 Cr' },
      { text: 'Brigade Eldorado' },
      {
        text: 'a bit expensive for me',
        assert: {
          goal_kind_not: 'clarify_intent',
          reply_excludes: ["couldn't make sense"],
        },
      },
    ],
  },
  {
    id: 'EXTRA-COST-STANCE-BUDGET',
    title: 'Budget-boundary stance',
    builder_id: 'brigade-group',
    turns: [
      { text: 'hi' },
      { text: '2 BHK apartment in Devanahalli under 80 lakh' },
      { text: 'Brigade Orchards' },
      {
        text: 'out of my budget',
        assert: { goal_kind_not: 'clarify_intent' },
      },
    ],
  },
  {
    id: 'EXTRA-VISIT-ORIGIN',
    title: 'Visit day + origin latch',
    builder_id: 'brigade-group',
    turns: [
      { text: 'hi' },
      { text: '2 BHK apartment in Devanahalli under 80 lakh' },
      { text: 'Brigade Orchards' },
      { text: 'I want to visit' },
      {
        text: 'saturday morning possible? coming from whitefield',
        assert: {
          goal_kind_not: 'clarify_intent',
          reply_includes_any: ['visit', 'saturday', 'confirm', 'yes', '10'],
        },
      },
    ],
  },
  {
    id: 'EXTRA-IVORY-ALLIN',
    title: 'Ivory pin then all-in',
    builder_id: 'brigade-group',
    turns: [
      { text: 'hi I already like Brigade Orchards — heard from a friend' },
      {
        text: '2 bhk ivory if you have',
        assert: { reply_includes_any: ['ivory', '₹', 'lakh'] },
      },
      {
        text: 'full price with all charges not just bsp',
        assert: {
          reply_includes_any: ['₹', 'charge', 'gst', 'maintenance', 'lakh', 'all-in', 'total'],
        },
      },
    ],
  },
];

async function main() {
  const health = await fetch(`${SPINE}/health`).then((r) => r.json()).catch(() => null);
  if (!health || (health as { status?: string }).status !== 'ok') {
    console.error('Spine down', SPINE);
    process.exit(1);
  }
  console.log(`Board → ${SPINE} deepseek=${(health as { deepseek?: boolean }).deepseek}\n`);

  const scenarios: PackScenario[] = [
    ...loadPack('OBJ-pack.json'),
    ...loadPack('DISC-pack.json', 4),
    ...loadPack('CHAOS-pack.json'),
    ...loadPack('PACKED-pack.json'),
    ...loadPack('GEO-pack.json', 3),
    ...EXTRA,
  ];

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join(ROOT, 'docs/reports/quality-factory-2026-08-12', `latency-board-${stamp}`);
  mkdirSync(outDir, { recursive: true });

  const allWall: number[] = [];
  const allExtract: number[] = [];
  const allCompose: number[] = [];
  const allTotal: number[] = [];
  let llmTurns = 0;
  let turnCount = 0;
  let failedScenarios = 0;
  const rows: unknown[] = [];

  for (const sc of scenarios) {
    console.log(`══ ${sc.id} ══ ${sc.title ?? ''}`);
    const phone = `+9198${Date.now().toString().slice(-10)}`;
    let conv: string | undefined;
    const turns: TurnRec[] = [];
    let ok = true;
    for (let i = 0; i < sc.turns.length; i++) {
      const t = sc.turns[i]!;
      try {
        const resp = await chat(sc.builder_id, phone, t.text, conv);
        conv = resp.thread_id || conv;
        const timings = (resp.debug.timings as {
          extract_ms?: number;
          compose_ms?: number;
          total_ms?: number;
        }) ?? {};
        const fails = checkAssert(resp.reply, resp.debug, t.assert);
        const pass = fails.length === 0;
        if (!pass) ok = false;
        turnCount++;
        allWall.push(resp.wall_ms);
        if (timings.extract_ms != null) allExtract.push(timings.extract_ms);
        if (timings.compose_ms != null) allCompose.push(timings.compose_ms);
        if (timings.total_ms != null) allTotal.push(timings.total_ms);
        if (resp.debug.llm_used) llmTurns++;
        const rec: TurnRec = {
          index: i + 1,
          buyer: t.text,
          reply: resp.reply,
          wall_ms: resp.wall_ms,
          ...timings,
          llm_used: Boolean(resp.debug.llm_used),
          compose_template: Boolean(resp.debug.compose_template),
          goal: resp.debug.goal,
          phase: String(resp.debug.phase ?? ''),
          pass,
          failures: fails,
        };
        turns.push(rec);
        console.log(
          `  ${pass ? '✓' : '✗'} t${i + 1} wall=${resp.wall_ms}ms` +
            (timings.total_ms != null ? ` eng=${timings.total_ms}ms` : '') +
            (timings.extract_ms != null ? ` ex=${timings.extract_ms}` : '') +
            (timings.compose_ms != null ? ` co=${timings.compose_ms}` : '') +
            ` llm=${resp.debug.llm_used ? 'y' : 'n'} goal=${JSON.stringify(resp.debug.goal)}`,
        );
        console.log(`     ${resp.reply.slice(0, 160).replace(/\n/g, ' / ')}`);
        if (!pass) for (const f of fails) console.log(`         !! ${f}`);
        await new Promise((r) => setTimeout(r, GAP_MS));
      } catch (e) {
        ok = false;
        console.log(`  ✗ t${i + 1} ERROR ${e}`);
        turns.push({
          index: i + 1,
          buyer: t.text,
          reply: '',
          wall_ms: 0,
          pass: false,
          failures: [e instanceof Error ? e.message : String(e)],
        });
        break;
      }
    }
    if (!ok) failedScenarios++;
    const rec = { id: sc.id, title: sc.title, ok, turns };
    rows.push(rec);
    writeFileSync(join(outDir, `${sc.id}.json`), JSON.stringify(rec, null, 2));
    await new Promise((r) => setTimeout(r, JOURNEY_GAP_MS));
  }

  const sort = (a: number[]) => [...a].sort((x, y) => x - y);
  const wall = sort(allWall);
  const extract = sort(allExtract);
  const compose = sort(allCompose);
  const total = sort(allTotal);
  const summary = {
    spine: SPINE,
    scenarios: scenarios.length,
    passed: scenarios.length - failedScenarios,
    failed: failedScenarios,
    turns: turnCount,
    llm_turns: llmTurns,
    llm_rate: turnCount ? llmTurns / turnCount : 0,
    latency_ms: {
      wall: {
        n: wall.length,
        p50: pct(wall, 50),
        p95: pct(wall, 95),
        max: wall[wall.length - 1] ?? null,
      },
      engine_total: {
        n: total.length,
        p50: pct(total, 50),
        p95: pct(total, 95),
        max: total[total.length - 1] ?? null,
      },
      extract: {
        n: extract.length,
        p50: pct(extract, 50),
        p95: pct(extract, 95),
        max: extract[extract.length - 1] ?? null,
      },
      compose: {
        n: compose.length,
        p50: pct(compose, 50),
        p95: pct(compose, 95),
        max: compose[compose.length - 1] ?? null,
      },
    },
    note: 'Local wrangler wall times include remote Desk/AI; dig SLO is separate.',
  };
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ summary, rows }, null, 2));

  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Latency board</title>
<style>
body{font-family:ui-sans-serif,system-ui;margin:24px;background:#0f1419;color:#e7ecf1}
h1,h2{font-weight:600} table{border-collapse:collapse;width:100%;margin:12px 0}
td,th{border:1px solid #2a3440;padding:6px 8px;font-size:13px;vertical-align:top}
.ok{color:#6dce8a}.bad{color:#f07178} .muted{color:#8b9aab;font-size:12px}
pre{white-space:pre-wrap;font-size:12px}
</style></head><body>
<h1>Scenario + latency board</h1>
<p class="muted">${SPINE} · ${summary.passed}/${summary.scenarios} scenarios · llm_rate=${(summary.llm_rate * 100).toFixed(1)}%</p>
<h2>Latency (ms)</h2>
<table><tr><th></th><th>n</th><th>p50</th><th>p95</th><th>max</th></tr>
<tr><td>wall</td><td>${summary.latency_ms.wall.n}</td><td>${summary.latency_ms.wall.p50}</td><td>${summary.latency_ms.wall.p95}</td><td>${summary.latency_ms.wall.max}</td></tr>
<tr><td>engine total</td><td>${summary.latency_ms.engine_total.n}</td><td>${summary.latency_ms.engine_total.p50}</td><td>${summary.latency_ms.engine_total.p95}</td><td>${summary.latency_ms.engine_total.max}</td></tr>
<tr><td>extract</td><td>${summary.latency_ms.extract.n}</td><td>${summary.latency_ms.extract.p50}</td><td>${summary.latency_ms.extract.p95}</td><td>${summary.latency_ms.extract.max}</td></tr>
<tr><td>compose</td><td>${summary.latency_ms.compose.n}</td><td>${summary.latency_ms.compose.p50}</td><td>${summary.latency_ms.compose.p95}</td><td>${summary.latency_ms.compose.max}</td></tr>
</table>
<p class="muted">${summary.note}</p>
${(rows as Array<{ id: string; title?: string; ok: boolean; turns: TurnRec[] }>)
  .map(
    (r) => `<h2 class="${r.ok ? 'ok' : 'bad'}">${r.id} ${r.ok ? 'PASS' : 'FAIL'}</h2>
<p class="muted">${r.title ?? ''}</p>
<table><tr><th>#</th><th>wall</th><th>eng</th><th>ex</th><th>co</th><th>llm</th><th>goal</th><th>buyer / bot</th></tr>
${r.turns
  .map(
    (t) => `<tr class="${t.pass ? '' : 'bad'}"><td>${t.index}</td><td>${t.wall_ms}</td><td>${t.total_ms ?? '—'}</td>
<td>${t.extract_ms ?? '—'}</td><td>${t.compose_ms ?? '—'}</td><td>${t.llm_used ? 'y' : 'n'}</td>
<td><code>${JSON.stringify(t.goal)}</code></td>
<td><b>${escapeHtml(t.buyer)}</b><br/>${escapeHtml(t.reply.slice(0, 280))}${t.failures.length ? `<br/><span class="bad">${escapeHtml(t.failures.join('; '))}</span>` : ''}</td></tr>`,
  )
  .join('\n')}
</table>`,
  )
  .join('\n')}
</body></html>`;
  writeFileSync(join(outDir, 'board.html'), html);

  console.log('\n—— Latency ——');
  console.log(JSON.stringify(summary.latency_ms, null, 2));
  console.log(`llm_rate ${(summary.llm_rate * 100).toFixed(1)}% (${llmTurns}/${turnCount})`);
  console.log(`\n${failedScenarios ? 'FAIL' : 'PASS'} ${summary.passed}/${summary.scenarios}`);
  console.log(`Recorded ${outDir}`);
  console.log(`Open ${join(outDir, 'board.html')}`);
  process.exit(failedScenarios ? 1 : 0);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
