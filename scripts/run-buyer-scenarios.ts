#!/usr/bin/env npx tsx
/**
 * Live buyer scenarios against running ConverseSpine (/chat).
 * Records full transcripts under scenarios/runs/<timestamp>/ for review + reuse.
 *
 *   cd ConverseSpine && npm run dev   # :8789 (remote NayaDesk bindings)
 *   npx tsx scripts/run-buyer-scenarios.ts
 *   npx tsx scripts/run-buyer-scenarios.ts --only SA-G01,BUYER-LOK-01
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCENARIO_DIR = join(ROOT, 'scenarios', 'buyer');
const SPINE = (process.env.CONVERSE_SPINE_URL ?? 'http://127.0.0.1:8789').replace(/\/+$/, '');

interface AssertSpec {
  /** Reply must match (case-insensitive). */
  reply_includes?: string[];
  /** Reply must NOT match. */
  reply_excludes?: string[];
  /** Optional debug.speech_act when API returns debug. */
  speech_act?: string;
  /** Optional debug.goal.kind */
  goal_kind?: string;
  /** Optional debug.goal.topic */
  goal_topic?: string;
  /**
   * Media emit or honest miss: tools include mediaShare, reply has CDN URL,
   * whatsapp_actions present, or honest "no brochure / after visit" copy.
   */
  expect_media?: boolean;
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

interface TurnRecord {
  index: number;
  buyer: string;
  reply: string;
  conversation_id: string;
  debug?: Record<string, unknown>;
  pass: boolean;
  failures: string[];
}

interface ScenarioRecord {
  id: string;
  title: string;
  builder_id: string;
  phone: string;
  ok: boolean;
  turns: TurnRecord[];
}

function loadScenarios(only?: Set<string>): BuyerScenario[] {
  const files = readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.json')).sort();
  const out: BuyerScenario[] = [];
  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(SCENARIO_DIR, f), 'utf8')) as BuyerScenario | BuyerScenario[];
    const list = Array.isArray(raw) ? raw : [raw];
    for (const s of list) {
      if (only && !only.has(s.id)) continue;
      out.push(s);
    }
  }
  return out;
}

async function chat(
  builderId: string,
  phone: string,
  text: string,
  convId?: string,
): Promise<{
  reply_text: string;
  conversation_id: string;
  debug?: Record<string, unknown>;
  whatsapp_actions?: unknown[];
  error?: string;
}> {
  const r = await fetch(`${SPINE}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
    whatsapp_actions?: unknown[];
    error?: string;
  };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return {
    reply_text: body.reply_text ?? body.reply ?? '',
    conversation_id: body.conversation_id ?? '',
    debug: body.debug,
    whatsapp_actions: body.whatsapp_actions,
  };
}

function hasMediaSignal(
  reply: string,
  debug: Record<string, unknown> | undefined,
  whatsappActions?: unknown[],
): boolean {
  const tools = (debug?.tools as string[] | undefined) ?? [];
  if (tools.some((t) => /media/i.test(t))) return true;
  if (whatsappActions && whatsappActions.length > 0) return true;
  if (/https?:\/\/\S+/i.test(reply)) return true;
  // Honest miss — media tool path answered without inventing a file.
  if (
    /\b(?:no brochure|don'?t have|do not have|aren'?t published|after (?:a )?site visit|not (?:yet )?available|share that after)\b/i.test(
      reply,
    )
  ) {
    return true;
  }
  return false;
}

function checkAssert(
  reply: string,
  debug: Record<string, unknown> | undefined,
  a: AssertSpec,
  whatsappActions?: unknown[],
): string[] {
  const fails: string[] = [];
  const lower = reply.toLowerCase();
  for (const needle of a.reply_includes ?? []) {
    if (!lower.includes(needle.toLowerCase())) {
      fails.push(`expected reply to include "${needle}"`);
    }
  }
  for (const needle of a.reply_excludes ?? []) {
    if (lower.includes(needle.toLowerCase())) {
      fails.push(`expected reply to exclude "${needle}"`);
    }
  }
  if (a.speech_act && debug?.speech_act && debug.speech_act !== a.speech_act) {
    fails.push(`speech_act=${String(debug.speech_act)} want ${a.speech_act}`);
  }
  const goal = (debug?.goal ?? {}) as { kind?: string; topic?: string };
  if (a.goal_kind && goal.kind && goal.kind !== a.goal_kind) {
    fails.push(`goal.kind=${goal.kind} want ${a.goal_kind}`);
  }
  if (a.goal_topic && goal.topic && goal.topic !== a.goal_topic) {
    fails.push(`goal.topic=${goal.topic} want ${a.goal_topic}`);
  }
  if (a.expect_media && !hasMediaSignal(reply, debug, whatsappActions)) {
    fails.push('expected media emit (CDN/tools/whatsapp_actions) or honest media miss');
  }
  return fails;
}

function parseOnly(): Set<string> | undefined {
  const idx = process.argv.indexOf('--only');
  if (idx < 0 || !process.argv[idx + 1]) return undefined;
  return new Set(process.argv[idx + 1]!.split(',').map((s) => s.trim()).filter(Boolean));
}

async function main(): Promise<void> {
  const health = await fetch(`${SPINE}/health`).then((r) => r.json()).catch(() => null);
  if (!health || (health as { status?: string }).status !== 'ok') {
    console.error('ConverseSpine not up at', SPINE);
    process.exit(1);
  }

  const only = parseOnly();
  const scenarios = loadScenarios(only);
  if (!scenarios.length) {
    console.error('No scenarios in', SCENARIO_DIR);
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(ROOT, 'scenarios', 'runs', stamp);
  mkdirSync(runDir, { recursive: true });

  console.log(`\nBuyer scenarios → ${SPINE}`);
  console.log(`Recording → ${runDir}\n`);

  const summary: ScenarioRecord[] = [];

  for (const sc of scenarios) {
    const phone = `+9199${String(Date.now() % 1e10).padStart(10, '0')}${sc.id.length % 10}`;
    let convId: string | undefined;
    const turns: TurnRecord[] = [];
    let ok = true;

    console.log(`══ ${sc.id} — ${sc.title} (${sc.builder_id}) ══`);

    for (let i = 0; i < sc.turns.length; i++) {
      const turn = sc.turns[i]!;
      try {
        const resp = await chat(sc.builder_id, phone, turn.text, convId);
        convId = resp.conversation_id || convId;
        const failures = turn.assert
          ? checkAssert(resp.reply_text, resp.debug, turn.assert, resp.whatsapp_actions)
          : [];
        const pass = failures.length === 0;
        if (!pass) ok = false;
        turns.push({
          index: i + 1,
          buyer: turn.text,
          reply: resp.reply_text,
          conversation_id: convId ?? '',
          debug: {
            ...(resp.debug ?? {}),
            ...(resp.whatsapp_actions ? { whatsapp_actions: resp.whatsapp_actions } : {}),
          },
          pass,
          failures,
        });
        const mark = pass ? '✓' : '✗';
        console.log(`  ${mark} t${i + 1}  ${turn.text.slice(0, 60)}`);
        console.log(`         → ${resp.reply_text.replace(/\s+/g, ' ').slice(0, 140)}`);
        if (failures.length) {
          for (const f of failures) console.log(`         !! ${f}`);
        }
      } catch (e) {
        ok = false;
        const msg = e instanceof Error ? e.message : String(e);
        turns.push({
          index: i + 1,
          buyer: turn.text,
          reply: '',
          conversation_id: convId ?? '',
          pass: false,
          failures: [msg],
        });
        console.log(`  ✗ t${i + 1}  ERROR: ${msg}`);
        break;
      }
    }

    const record: ScenarioRecord = {
      id: sc.id,
      title: sc.title,
      builder_id: sc.builder_id,
      phone,
      ok,
      turns,
    };
    summary.push(record);
    writeFileSync(join(runDir, `${sc.id}.json`), JSON.stringify(record, null, 2));

    const md = [
      `# ${sc.id} — ${sc.title}`,
      '',
      `- builder: \`${sc.builder_id}\``,
      `- phone: \`${phone}\``,
      `- result: **${ok ? 'PASS' : 'FAIL'}**`,
      '',
      ...turns.flatMap((t) => [
        `## Turn ${t.index}`,
        '',
        `**Buyer:** ${t.buyer}`,
        '',
        `**Bot:** ${t.reply || '(empty)'}`,
        '',
        t.failures.length ? `**Failures:** ${t.failures.join('; ')}` : '',
        '',
      ]),
    ].join('\n');
    writeFileSync(join(runDir, `${sc.id}.md`), md);
  }

  writeFileSync(
    join(runDir, 'summary.json'),
    JSON.stringify(
      {
        spine: SPINE,
        at: new Date().toISOString(),
        passed: summary.filter((s) => s.ok).length,
        failed: summary.filter((s) => !s.ok).length,
        scenarios: summary.map((s) => ({ id: s.id, ok: s.ok, turns: s.turns.length })),
      },
      null,
      2,
    ),
  );

  const mdIndex = [
    `# Buyer scenario run ${stamp}`,
    '',
    `| ID | Result | Turns |`,
    `|----|--------|-------|`,
    ...summary.map((s) => `| [${s.id}](./${s.id}.md) | ${s.ok ? 'PASS' : 'FAIL'} | ${s.turns.length} |`),
    '',
  ].join('\n');
  writeFileSync(join(runDir, 'README.md'), mdIndex);

  console.log('\n── Summary ──');
  for (const s of summary) {
    console.log(`${s.ok ? '✅' : '❌'} ${s.id}`);
  }
  console.log(`\nRecorded: ${runDir}`);
  process.exit(summary.every((s) => s.ok) ? 0 : 1);
}

main();
