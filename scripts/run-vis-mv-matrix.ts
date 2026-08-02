#!/usr/bin/env npx tsx
/**
 * Dual-channel soak for VIS-MV + VIS-ADV visit matrix (chat /chat + advisor /api/advisor/turn).
 *
 *   CONVERSE_SPINE_URL=https://converse-spine-dev… npx tsx scripts/run-vis-mv-matrix.ts
 *   npx tsx scripts/run-vis-mv-matrix.ts --only VIS-MV-01,VIS-ADV-01
 *   npx tsx scripts/run-vis-mv-matrix.ts --channel chat
 *   npx tsx scripts/run-vis-mv-matrix.ts --channel advisor
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCENARIO_DIR = join(ROOT, 'scenarios', 'buyer');
const SPINE = (process.env.CONVERSE_SPINE_URL ?? 'http://127.0.0.1:8789').replace(/\/+$/, '');

function loadBotSecret(): string {
  if (process.env.BOT_SHARED_SECRET) return process.env.BOT_SHARED_SECRET.trim();
  const p = join(ROOT, '.dev.vars');
  if (!existsSync(p)) return '';
  const line = readFileSync(p, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('BOT_SHARED_SECRET='));
  return line ? line.slice('BOT_SHARED_SECRET='.length).trim().replace(/^["']|["']$/g, '') : '';
}
const BOT_SECRET = loadBotSecret();

interface AssertSpec {
  reply_includes?: string[];
  reply_includes_any?: string[];
  reply_excludes?: string[];
  goal_kind?: string;
  goal_kind_not?: string;
  phase?: string;
  phase_not?: string;
}

interface ScenarioTurn {
  text: string;
  assert?: AssertSpec;
}

interface BuyerScenario {
  id: string;
  title: string;
  builder_id: string;
  tags?: string[];
  turns: ScenarioTurn[];
}

type Channel = 'chat' | 'advisor';

function loadMvScenarios(only?: Set<string>): BuyerScenario[] {
  const files = readdirSync(SCENARIO_DIR)
    .filter((f) => (f.startsWith('VIS-MV-') || f.startsWith('VIS-ADV-')) && f.endsWith('.json'))
    .sort();
  const out: BuyerScenario[] = [];
  for (const f of files) {
    const s = JSON.parse(readFileSync(join(SCENARIO_DIR, f), 'utf8')) as BuyerScenario;
    if (only && !only.has(s.id)) continue;
    out.push(s);
  }
  return out;
}

function checkAssert(reply: string, debug: Record<string, unknown> | undefined, a: AssertSpec): string[] {
  const fails: string[] = [];
  const lower = reply.toLowerCase();
  for (const needle of a.reply_includes ?? []) {
    if (!lower.includes(needle.toLowerCase())) fails.push(`expected reply to include "${needle}"`);
  }
  if (a.reply_includes_any?.length) {
    const hit = a.reply_includes_any.some((n) => lower.includes(n.toLowerCase()));
    if (!hit) fails.push(`expected reply to include one of: ${a.reply_includes_any.join(' | ')}`);
  }
  for (const needle of a.reply_excludes ?? []) {
    if (lower.includes(needle.toLowerCase())) fails.push(`expected reply to exclude "${needle}"`);
  }
  const goal = (debug?.goal ?? {}) as { kind?: string };
  if (a.goal_kind && goal.kind && goal.kind !== a.goal_kind) {
    fails.push(`goal.kind=${goal.kind} want ${a.goal_kind}`);
  }
  if (a.goal_kind_not && goal.kind && goal.kind === a.goal_kind_not) {
    fails.push(`goal.kind must not be ${a.goal_kind_not}`);
  }
  const phase = typeof debug?.phase === 'string' ? debug.phase : undefined;
  if (a.phase && phase && phase !== a.phase) fails.push(`phase=${phase} want ${a.phase}`);
  if (a.phase_not && phase && phase === a.phase_not) fails.push(`phase must not be ${a.phase_not}`);
  return fails;
}

async function chatTurn(
  builderId: string,
  phone: string,
  text: string,
  convId?: string,
): Promise<{ reply: string; conversation_id: string; debug?: Record<string, unknown> }> {
  const r = await fetch(`${SPINE}/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(BOT_SECRET ? { 'x-bot-secret': BOT_SECRET } : {}),
    },
    body: JSON.stringify({
      builder_id: builderId,
      buyer_phone: phone,
      text,
      channel: 'whatsapp',
      ...(convId ? { conversation_id: convId } : {}),
    }),
  });
  const body = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(body.error ?? `HTTP ${r.status}`));
  return {
    reply: String(body.reply_text ?? body.reply ?? ''),
    conversation_id: String(body.conversation_id ?? ''),
    debug: body.debug as Record<string, unknown> | undefined,
  };
}

async function advisorTurn(
  builderId: string,
  sessionId: string,
  text: string,
): Promise<{ reply: string; conversation_id: string; debug?: Record<string, unknown> }> {
  const r = await fetch(`${SPINE}/api/advisor/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      builder_id: builderId,
      text,
      buyer_phone: `+91${sessionId.replace(/\D/g, '').slice(-10).padStart(10, '0')}`,
    }),
  });
  const body = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(body.error ?? `HTTP ${r.status}`));
  const debug =
    (body.debug as Record<string, unknown> | undefined) ??
    ({
      goal: body.goal,
      phase: body.phase,
      tools: body.tools,
    } as Record<string, unknown>);
  return {
    reply: String(body.reply ?? ''),
    conversation_id: String(body.conversation_id ?? ''),
    debug,
  };
}

function parseOnly(): Set<string> | undefined {
  const idx = process.argv.indexOf('--only');
  if (idx < 0 || !process.argv[idx + 1]) return undefined;
  return new Set(process.argv[idx + 1]!.split(',').map((s) => s.trim()).filter(Boolean));
}

function parseChannels(): Channel[] {
  const idx = process.argv.indexOf('--channel');
  const v = idx >= 0 ? process.argv[idx + 1] : 'both';
  if (v === 'chat') return ['chat'];
  if (v === 'advisor') return ['advisor'];
  return ['chat', 'advisor'];
}

async function runScenario(
  sc: BuyerScenario,
  channel: Channel,
): Promise<{
  id: string;
  channel: Channel;
  ok: boolean;
  turns: Array<{
    index: number;
    buyer: string;
    reply: string;
    pass: boolean;
    failures: string[];
  }>;
}> {
  const stamp = Date.now();
  const phone = `+9199${String(stamp % 1e10).padStart(10, '0')}`;
  const sessionId = `mv-${sc.id}-${channel}-${stamp}`;
  let convId: string | undefined;
  const turns: Array<{
    index: number;
    buyer: string;
    reply: string;
    pass: boolean;
    failures: string[];
  }> = [];
  let ok = true;

  console.log(`\n══ [${channel}] ${sc.id} — ${sc.title} (${sc.builder_id}) ══`);

  for (let i = 0; i < sc.turns.length; i++) {
    const turn = sc.turns[i]!;
    try {
      const resp =
        channel === 'chat'
          ? await chatTurn(sc.builder_id, phone, turn.text, convId)
          : await advisorTurn(sc.builder_id, sessionId, turn.text);
      if (resp.conversation_id) convId = resp.conversation_id;
      const failures = turn.assert ? checkAssert(resp.reply, resp.debug, turn.assert) : [];
      const pass = failures.length === 0;
      if (!pass) ok = false;
      turns.push({ index: i + 1, buyer: turn.text, reply: resp.reply, pass, failures });
      console.log(`  ${pass ? '✓' : '✗'} t${i + 1}  ${turn.text.slice(0, 70)}`);
      console.log(`         → ${resp.reply.replace(/\s+/g, ' ').slice(0, 160)}`);
      for (const f of failures) console.log(`         !! ${f}`);
    } catch (e) {
      ok = false;
      const msg = e instanceof Error ? e.message : String(e);
      turns.push({ index: i + 1, buyer: turn.text, reply: '', pass: false, failures: [msg] });
      console.log(`  ✗ t${i + 1}  ERROR: ${msg}`);
      break;
    }
  }

  return { id: sc.id, channel, ok, turns };
}

async function main(): Promise<void> {
  const health = await fetch(`${SPINE}/health`)
    .then((r) => r.json())
    .catch(() => null);
  if (!health || (health as { status?: string }).status !== 'ok') {
    console.error('ConverseSpine not up at', SPINE);
    process.exit(1);
  }

  const scenarios = loadMvScenarios(parseOnly());
  const channels = parseChannels();
  if (!scenarios.length) {
    console.error('No VIS-MV-* / VIS-ADV-* scenarios found');
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(ROOT, 'scenarios', 'runs', `vis-mv-${stamp}`);
  mkdirSync(runDir, { recursive: true });

  console.log(`VIS-MV + VIS-ADV matrix → ${SPINE}`);
  console.log(`Channels: ${channels.join(', ')}`);
  console.log(`Recording → ${runDir}`);

  const rows: Array<Awaited<ReturnType<typeof runScenario>>> = [];
  for (const channel of channels) {
    for (const sc of scenarios) {
      const row = await runScenario(sc, channel);
      rows.push(row);
      writeFileSync(join(runDir, `${row.channel}-${row.id}.json`), JSON.stringify(row, null, 2));
    }
  }

  console.log('\n── Summary ──');
  for (const channel of channels) {
    console.log(`\n[${channel}]`);
    for (const r of rows.filter((x) => x.channel === channel)) {
      console.log(`${r.ok ? '✅' : '❌'} ${r.id}`);
    }
  }

  writeFileSync(join(runDir, 'summary.json'), JSON.stringify({ spine: SPINE, channels, rows }, null, 2));

  const html = `<!doctype html><meta charset="utf-8"><title>VIS-MV ${stamp}</title>
<style>body{font-family:system-ui;max-width:960px;margin:2rem auto;padding:0 1rem}
.fail{color:#b00020}.ok{color:#0a7}pre{white-space:pre-wrap;background:#f6f6f6;padding:.75rem;border-radius:8px}</style>
<h1>VIS-MV matrix</h1><p>${SPINE}</p>
${rows
  .map(
    (r) => `<h2 class="${r.ok ? 'ok' : 'fail'}">[${r.channel}] ${r.id} ${r.ok ? 'PASS' : 'FAIL'}</h2>
${r.turns
  .map(
    (t) => `<p><b>t${t.index}</b> ${t.pass ? '✓' : '✗'} ${escapeHtml(t.buyer)}<br>→ ${escapeHtml(t.reply.slice(0, 400))}${
      t.failures.length ? `<br><span class="fail">${escapeHtml(t.failures.join('; '))}</span>` : ''
    }</p>`,
  )
  .join('')}`,
  )
  .join('')}
`;
  writeFileSync(join(runDir, 'report.html'), html);
  console.log(`\nHTML: ${runDir}/report.html`);
  process.exit(rows.every((r) => r.ok) ? 0 : 1);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
