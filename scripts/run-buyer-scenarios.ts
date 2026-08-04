#!/usr/bin/env npx tsx
/**
 * Live buyer scenarios against running ConverseSpine (/chat).
 * Records full transcripts under scenarios/runs/<timestamp>/ for review + reuse.
 *
 *   cd ConverseSpine && npm run dev   # :8789 (remote NayaDesk bindings)
 *   npx tsx scripts/run-buyer-scenarios.ts
 *   npx tsx scripts/run-buyer-scenarios.ts --only SA-G01,BUYER-LOK-01
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCENARIO_DIR = join(ROOT, process.env.SCENARIO_DIR ?? join('scenarios', 'buyer'));
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
  /** Reply must match (case-insensitive). */
  reply_includes?: string[];
  /** At least one of these must appear (case-insensitive). */
  reply_includes_any?: string[];
  /** Reply must NOT match. */
  reply_excludes?: string[];
  /** Optional debug.speech_act when API returns debug. */
  speech_act?: string;
  /** Optional debug.goal.kind */
  goal_kind?: string;
  /** Optional: goal.kind must NOT equal this */
  goal_kind_not?: string;
  /** Optional debug.goal.topic */
  goal_topic?: string;
  /** Optional conversation phase (focused / discover / …). */
  phase?: string;
  /** Phase must not equal this (e.g. discover after a focus-hold ask). */
  phase_not?: string;
  /** debug.tools must include each of these */
  tools_include?: string[];
  /**
   * Media emit or honest miss: `media_attachments[]`, mediaShare tool,
   * whatsapp_actions, or honest "no brochure / after visit" copy.
   * Successful shares must NOT paste raw https URLs in reply prose.
   */
  expect_media?: boolean;
  /** Advisor `prefs_snapshot` values must include these (case-insensitive). */
  prefs_includes?: Record<string, string>;
  /** Advisor `prefs_snapshot` values must NOT include these substrings. */
  prefs_excludes?: Record<string, string>;
  /** Advisor response `projects[]` length must be >= this. */
  projects_min?: number;
  /** A4 — fail if reply dumps WhatsApp-style `*Name* in market` catalog lines. */
  no_wa_project_dump?: boolean;
}

interface ScenarioTurn {
  text: string;
  /** Advisor brief chips — sent on /api/advisor/turn as `preferences`. */
  preferences?: Record<string, string | undefined>;
  assert?: AssertSpec;
}

interface RevealSpec {
  /** Use project id from last turn that returned projects[]. */
  project_id_from?: 'projects';
  project_id?: string;
  buyer_name: string;
  buyer_phone: string;
  visit_label?: string;
  assert?: {
    source_builder_id?: string;
    source_project_id_includes?: string;
  };
}

interface BuyerScenario {
  id: string;
  title: string;
  builder_id: string;
  /** Default chat (/chat). advisor → /api/advisor/turn (NayaAdvisor door). */
  channel?: 'chat' | 'advisor';
  tags?: string[];
  turns: ScenarioTurn[];
  /** A5 — POST /api/advisor/reveal after turns (advisor channel). */
  reveal?: RevealSpec;
}

interface MediaAttachmentRecord {
  asset_kind?: string;
  label?: string;
  url?: string;
  delivery?: string;
  filename?: string;
  project_name?: string;
}

interface TurnRecord {
  index: number;
  buyer: string;
  reply: string;
  conversation_id: string;
  media_attachments?: MediaAttachmentRecord[];
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
  media_attachments?: MediaAttachmentRecord[];
  error?: string;
}> {
  const r = await fetch(`${SPINE}/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'converse-spine-buyer-scenarios/1.0',
      ...(BOT_SECRET ? { 'x-bot-secret': BOT_SECRET } : {}),
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
    whatsapp_actions?: unknown[];
    media_attachments?: MediaAttachmentRecord[];
    error?: string;
  };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return {
    reply_text: body.reply_text ?? body.reply ?? '',
    conversation_id: body.conversation_id ?? '',
    debug: body.debug,
    whatsapp_actions: body.whatsapp_actions,
    media_attachments: body.media_attachments,
  };
}

async function advisor(
  builderId: string,
  sessionId: string,
  text: string,
  convId?: string,
  preferences?: Record<string, string | undefined>,
): Promise<{
  reply_text: string;
  conversation_id: string;
  debug?: Record<string, unknown>;
  whatsapp_actions?: unknown[];
  media_attachments?: MediaAttachmentRecord[];
  prefs_snapshot?: Record<string, string>;
  projects?: Array<{ id?: string; name?: string }>;
  error?: string;
}> {
  const r = await fetch(`${SPINE}/api/advisor/turn`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'converse-spine-buyer-scenarios/1.0',
    },
    body: JSON.stringify({
      builder_id: builderId,
      session_id: sessionId,
      text,
      ...(convId ? { conversation_id: convId } : {}),
      ...(preferences && Object.keys(preferences).length > 0
        ? { preferences }
        : {}),
    }),
  });
  const body = (await r.json()) as {
    reply?: string;
    conversation_id?: string;
    debug?: Record<string, unknown>;
    media_attachments?: MediaAttachmentRecord[];
    prefs_snapshot?: Record<string, string>;
    projects?: Array<{ id?: string; name?: string }>;
    status?: string;
    error?: string;
  };
  if (!r.ok || body.status === 'error') {
    throw new Error(body.error ?? `HTTP ${r.status}`);
  }
  return {
    reply_text: body.reply ?? '',
    conversation_id: body.conversation_id ?? '',
    debug: body.debug,
    media_attachments: body.media_attachments,
    prefs_snapshot: body.prefs_snapshot,
    projects: body.projects,
  };
}

function hasMediaSignal(
  reply: string,
  debug: Record<string, unknown> | undefined,
  whatsappActions?: unknown[],
  mediaAttachments?: MediaAttachmentRecord[],
): boolean {
  if (mediaAttachments?.some((a) => a.url && a.label)) return true;
  const tools = (debug?.tools as string[] | undefined) ?? [];
  if (tools.some((t) => /media/i.test(t))) return true;
  if (whatsappActions && whatsappActions.length > 0) return true;
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
  mediaAttachments?: MediaAttachmentRecord[],
  prefsSnapshot?: Record<string, string>,
  projects?: Array<{ id?: string; name?: string }>,
): string[] {
  const fails: string[] = [];
  const lower = reply.toLowerCase();
  for (const needle of a.reply_includes ?? []) {
    if (!lower.includes(needle.toLowerCase())) {
      fails.push(`expected reply to include "${needle}"`);
    }
  }
  if (a.reply_includes_any?.length) {
    const hit = a.reply_includes_any.some((n) => lower.includes(n.toLowerCase()));
    if (!hit) {
      fails.push(`expected reply to include one of: ${a.reply_includes_any.join(' | ')}`);
    }
  }
  for (const needle of a.reply_excludes ?? []) {
    if (lower.includes(needle.toLowerCase())) {
      fails.push(`expected reply to exclude "${needle}"`);
    }
  }
  if (a.prefs_includes) {
    const snap = prefsSnapshot ?? {};
    for (const [k, want] of Object.entries(a.prefs_includes)) {
      const got = (snap[k] ?? '').toLowerCase();
      if (!got.includes(want.toLowerCase())) {
        fails.push(`prefs_snapshot.${k}=${snap[k] ?? '(missing)'} want includes "${want}"`);
      }
    }
  }
  if (a.prefs_excludes) {
    const snap = prefsSnapshot ?? {};
    for (const [k, needle] of Object.entries(a.prefs_excludes)) {
      const got = (snap[k] ?? '').toLowerCase();
      if (got.includes(needle.toLowerCase())) {
        fails.push(`prefs_snapshot.${k}=${snap[k] ?? '(missing)'} must not include "${needle}"`);
      }
    }
  }
  if (typeof a.projects_min === 'number') {
    const n = projects?.length ?? 0;
    if (n < a.projects_min) {
      fails.push(`projects.length=${n} want >= ${a.projects_min}`);
    }
  }
  if (a.no_wa_project_dump && /\*[^*]+\*\s+in\s+/i.test(reply)) {
    fails.push('reply must not dump *Project* in market (cards own catalog)');
  }
  if (a.speech_act && debug?.speech_act && debug.speech_act !== a.speech_act) {
    fails.push(`speech_act=${String(debug.speech_act)} want ${a.speech_act}`);
  }
  const goal = (debug?.goal ?? {}) as { kind?: string; topic?: string };
  if (a.goal_kind && goal.kind && goal.kind !== a.goal_kind) {
    fails.push(`goal.kind=${goal.kind} want ${a.goal_kind}`);
  }
  if (a.goal_kind_not && goal.kind && goal.kind === a.goal_kind_not) {
    fails.push(`goal.kind must not be ${a.goal_kind_not}`);
  }
  if (a.goal_topic && goal.topic && goal.topic !== a.goal_topic) {
    fails.push(`goal.topic=${goal.topic} want ${a.goal_topic}`);
  }
  const phase = typeof debug?.phase === 'string' ? debug.phase : undefined;
  if (a.phase && phase && phase !== a.phase) {
    fails.push(`phase=${phase} want ${a.phase}`);
  }
  if (a.phase_not && phase && phase === a.phase_not) {
    fails.push(`phase must not be ${a.phase_not}`);
  }
  if (a.tools_include?.length) {
    const tools = Array.isArray(debug?.tools) ? (debug!.tools as string[]) : [];
    for (const need of a.tools_include) {
      if (!tools.includes(need)) fails.push(`expected tools to include "${need}" (got ${tools.join(',') || 'none'})`);
    }
  }
  if (a.expect_media) {
    if (!hasMediaSignal(reply, debug, whatsappActions, mediaAttachments)) {
      fails.push('expected media_attachments / media tool / honest media miss');
    }
    // Successful attach: prose must not dump signed URLs (cards / WA native own the link).
    if (mediaAttachments?.some((x) => x.url) && /https?:\/\/\S+/i.test(reply)) {
      fails.push('reply must not paste raw media URL when media_attachments present');
    }
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
    const channel = sc.channel === 'advisor' ? 'advisor' : 'chat';
    const sessionId = `adv-scen-${sc.id}-${Date.now().toString(36)}`;
    let convId: string | undefined;
    const turns: TurnRecord[] = [];
    let ok = true;
    let lastProjects: Array<{ id?: string; name?: string }> = [];

    console.log(`══ ${sc.id} — ${sc.title} (${sc.builder_id} / ${channel}) ══`);

    for (let i = 0; i < sc.turns.length; i++) {
      const turn = sc.turns[i]!;
      try {
        const resp =
          channel === 'advisor'
            ? await advisor(sc.builder_id, sessionId, turn.text, convId, turn.preferences)
            : await chat(sc.builder_id, phone, turn.text, convId);
        convId = resp.conversation_id || convId;
        const projects =
          'projects' in resp ? (resp.projects as Array<{ id?: string; name?: string }> | undefined) : undefined;
        if (projects?.length) lastProjects = projects;
        const failures = turn.assert
          ? checkAssert(
              resp.reply_text,
              resp.debug,
              turn.assert,
              resp.whatsapp_actions,
              resp.media_attachments,
              'prefs_snapshot' in resp ? resp.prefs_snapshot : undefined,
              projects,
            )
          : [];
        const pass = failures.length === 0;
        if (!pass) ok = false;
        turns.push({
          index: i + 1,
          buyer: turn.text,
          reply: resp.reply_text,
          conversation_id: convId ?? '',
          ...(resp.media_attachments?.length
            ? { media_attachments: resp.media_attachments }
            : {}),
          debug: {
            ...(resp.debug ?? {}),
            ...(resp.whatsapp_actions ? { whatsapp_actions: resp.whatsapp_actions } : {}),
            ...(resp.media_attachments?.length
              ? { media_attachments: resp.media_attachments }
              : {}),
            ...('prefs_snapshot' in resp && resp.prefs_snapshot
              ? { prefs_snapshot: resp.prefs_snapshot }
              : {}),
            ...(projects?.length ? { projects } : {}),
          },
          pass,
          failures,
        });
        const mark = pass ? '✓' : '✗';
        console.log(`  ${mark} t${i + 1}  ${turn.text.slice(0, 60)}`);
        console.log(`         → ${resp.reply_text.replace(/\s+/g, ' ').slice(0, 140)}`);
        if (resp.media_attachments?.length) {
          console.log(
            `         📎 ${resp.media_attachments.map((a) => a.label ?? a.asset_kind).join(', ')}`,
          );
        }
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

    if (ok && sc.reveal && channel === 'advisor') {
      const rev = sc.reveal;
      const projectId =
        rev.project_id ??
        (rev.project_id_from === 'projects'
          ? (lastProjects.find(
              (p) => /eldorado/i.test(p.name ?? '') || /eldorado/i.test(p.id ?? ''),
            )?.id ?? lastProjects[0]?.id)
          : undefined);
      const revealFailures: string[] = [];
      if (!projectId) {
        revealFailures.push('reveal: no project_id from prior turns');
        ok = false;
        turns.push({
          index: turns.length + 1,
          buyer: '[reveal]',
          reply: '',
          conversation_id: convId ?? '',
          pass: false,
          failures: revealFailures,
        });
        console.log(`  ✗ reveal  ${revealFailures.join('; ')}`);
      } else {
        try {
          const r = await fetch(`${SPINE}/api/advisor/reveal`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'user-agent': 'converse-spine-buyer-scenarios/1.0',
            },
            body: JSON.stringify({
              session_id: sessionId,
              project_id: projectId,
              buyer_name: rev.buyer_name,
              buyer_phone: rev.buyer_phone,
              ...(rev.visit_label ? { visit_label: rev.visit_label } : {}),
            }),
          });
          const body = (await r.json()) as {
            status?: string;
            source_builder_id?: string;
            source_project_id?: string;
            conversation_id?: string;
            error?: string;
          };
          if (!r.ok || body.status === 'error') {
            revealFailures.push(`reveal HTTP/error: ${body.error ?? r.status}`);
          } else {
            if (
              rev.assert?.source_builder_id &&
              body.source_builder_id !== rev.assert.source_builder_id
            ) {
              revealFailures.push(
                `source_builder_id=${body.source_builder_id} want ${rev.assert.source_builder_id}`,
              );
            }
            if (
              rev.assert?.source_project_id_includes &&
              !(body.source_project_id ?? '')
                .toLowerCase()
                .includes(rev.assert.source_project_id_includes.toLowerCase())
            ) {
              revealFailures.push(
                `source_project_id=${body.source_project_id} want includes ${rev.assert.source_project_id_includes}`,
              );
            }
          }
          const pass = revealFailures.length === 0;
          if (!pass) ok = false;
          turns.push({
            index: turns.length + 1,
            buyer: `[reveal] ${rev.buyer_name} ${rev.buyer_phone}`,
            reply: pass
              ? `ok · source=${body.source_builder_id}/${body.source_project_id} · lead=${body.conversation_id}`
              : body.error ?? 'reveal_failed',
            conversation_id: body.conversation_id ?? convId ?? '',
            pass,
            failures: revealFailures,
            debug: { reveal: body },
          });
          console.log(`  ${pass ? '✓' : '✗'} reveal  ${projectId}`);
          console.log(
            `         → ${
              pass
                ? `source ${body.source_builder_id}/${body.source_project_id}`
                : revealFailures.join('; ')
            }`,
          );
        } catch (e) {
          ok = false;
          const msg = e instanceof Error ? e.message : String(e);
          turns.push({
            index: turns.length + 1,
            buyer: '[reveal]',
            reply: '',
            conversation_id: convId ?? '',
            pass: false,
            failures: [msg],
          });
          console.log(`  ✗ reveal  ERROR: ${msg}`);
        }
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

  const passed = summary.filter((s) => s.ok).length;
  const failed = summary.filter((s) => !s.ok).length;
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Buyer soak ${esc(stamp)}</title>
<style>
:root { --bg:#0f1419; --panel:#1a222c; --text:#e7ecf1; --muted:#8b9aab; --ok:#3dd68c; --bad:#ff6b6b; --line:#2a3542; }
* { box-sizing:border-box; }
body { margin:0; font:14px/1.45 ui-sans-serif, system-ui, sans-serif; background:var(--bg); color:var(--text); }
header.top { padding:20px 24px; border-bottom:1px solid var(--line); background:#121820; position:sticky; top:0; }
h1 { margin:0 0 6px; font-size:18px; }
.meta { color:var(--muted); font-size:12px; }
nav { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
nav a { color:var(--text); text-decoration:none; background:var(--panel); border:1px solid var(--line); padding:4px 10px; border-radius:6px; font-size:12px; }
main { max-width:980px; margin:0 auto; padding:20px 24px 80px; }
.scen { background:var(--panel); border:1px solid var(--line); border-radius:10px; margin:0 0 14px; overflow:hidden; }
.scen.fail { border-color:#6b3030; }
.scen > header { padding:10px 14px; background:#151c24; border-bottom:1px solid var(--line); display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; }
.status { font-size:11px; font-weight:700; letter-spacing:.04em; padding:2px 6px; border-radius:4px; }
.pass .status { background:#143528; color:var(--ok); }
.fail .status { background:#3a1515; color:var(--bad); }
.turn { padding:12px 14px; border-bottom:1px solid var(--line); }
.turn:last-child { border-bottom:0; }
.turn.t-bad { background:#1c1416; }
.lbl { display:inline-block; min-width:60px; color:var(--muted); font-size:11px; text-transform:uppercase; }
.fail-msg { color:var(--bad); font-size:12px; margin-top:6px; }
.dbg { color:var(--muted); font-size:11px; margin-top:4px; }
</style>
</head>
<body>
<header class="top">
  <h1>Buyer soak — ${passed} pass / ${failed} fail</h1>
  <p class="meta">${esc(SPINE)} · ${esc(new Date().toISOString())}</p>
  <nav>${summary.map((s) => `<a href="#${esc(s.id)}">${s.ok ? '✅' : '❌'} ${esc(s.id)}</a>`).join('')}</nav>
</header>
<main>
${summary
  .map((s) => {
    const turns = s.turns
      .map((t) => {
        const goal = t.debug?.goal as { kind?: string; topic?: string } | undefined;
        const tools = (t.debug?.tools as string[] | undefined)?.join(', ') ?? '';
        const atts = t.media_attachments ?? [];
        const attHtml = atts.length
          ? `<div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">${atts
              .map(
                (a) =>
                  `<a href="${esc(a.url ?? '#')}" target="_blank" rel="noopener" style="display:grid;grid-template-columns:44px 1fr auto;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#121820;color:var(--text);text-decoration:none"><span style="display:grid;place-items:center;height:44px;width:44px;border-radius:8px;background:#143528;color:var(--ok);font-size:10px;font-weight:700">${esc(
                    (a.delivery === 'image' ? 'IMG' : 'DOC') as string,
                  )}</span><span><strong>${esc(a.label ?? a.asset_kind ?? 'Media')}</strong><br/><span class="dbg">${esc(
                    [a.project_name, a.filename].filter(Boolean).join(' · '),
                  )}</span></span><span style="color:var(--ok);font-size:11px;font-weight:700">${a.delivery === 'image' ? 'View' : 'Open'}</span></a>`,
              )
              .join('')}</div>`
          : '';
        return `<div class="turn ${t.pass ? '' : 't-bad'}">
  <div><span class="lbl">Buyer</span> ${esc(t.buyer)}</div>
  <div style="margin-top:6px"><span class="lbl">Bot</span> ${esc(t.reply || '(empty)')}</div>
  ${attHtml}
  <div class="dbg">${esc(
          [goal?.kind, goal?.topic].filter(Boolean).join(' / ') + (tools ? ` · tools: ${tools}` : ''),
        )}</div>
  ${t.failures.length ? `<div class="fail-msg">${esc(t.failures.join('; '))}</div>` : ''}
</div>`;
      })
      .join('\n');
    return `<section class="scen ${s.ok ? 'pass' : 'fail'}" id="${esc(s.id)}">
  <header><span class="status">${s.ok ? 'PASS' : 'FAIL'}</span> <strong>${esc(s.id)}</strong> <span class="meta">${esc(s.title)}</span></header>
  ${turns}
</section>`;
  })
  .join('\n')}
</main>
</body>
</html>`;
  const htmlPath = join(runDir, 'report.html');
  writeFileSync(htmlPath, html);
  // Convenience alias for the latest quality gate run.
  writeFileSync(join(ROOT, 'scenarios', 'runs', 'quality-gate-latest.html'), html);

  console.log('\n── Summary ──');
  for (const s of summary) {
    console.log(`${s.ok ? '✅' : '❌'} ${s.id}`);
  }
  console.log(`\nRecorded: ${runDir}`);
  console.log(`HTML: ${htmlPath}`);
  process.exit(summary.every((s) => s.ok) ? 0 : 1);
}

main();
