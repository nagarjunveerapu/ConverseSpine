#!/usr/bin/env npx tsx
/**
 * Live smoke: Ivory pin → all-in; Hinglish objection; visit slot bind.
 *   npx tsx scripts/smoke-intent-recovery-ivory.ts
 *   # defaults to converse-spine-dev
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
/** Always dig unless explicitly overridden — never default to local wrangler. */
const SPINE = (
  process.env.CONVERSE_SPINE_URL ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev'
).replace(/\/+$/, '');

type Turn = { text: string; check?: (reply: string, debug: Record<string, unknown>) => string[] };

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
  const ms = Date.now() - t0;
  if (!r.ok || body.status === 'error') {
    throw new Error(String(body.error ?? `HTTP ${r.status}`));
  }
  return {
    reply: String(body.reply_text ?? body.reply ?? ''),
    thread_id: String(body.thread_id ?? ''),
    debug: (body.debug as Record<string, unknown>) ?? {},
    ms,
  };
}

const JOURNEYS: Array<{ id: string; builder_id: string; turns: Turn[] }> = [
  {
    id: 'SMOKE-IVORY-ALLIN',
    builder_id: 'brigade-group',
    turns: [
      { text: 'hi I already like Brigade Orchards — heard from a friend' },
      {
        text: '2 bhk ivory if you have',
        check: (reply) => {
          const fails: string[] = [];
          if (!/ivory/i.test(reply)) fails.push('reply missing Ivory');
          if (!/68|72|₹|lakh|L\b/i.test(reply)) fails.push('reply missing price tokens');
          return fails;
        },
      },
      {
        text: 'full price with all charges not just bsp',
        check: (reply, debug) => {
          const fails: string[] = [];
          const tools = (debug.tools as string[]) ?? [];
          const goal = debug.goal as { topic?: string } | undefined;
          if (goal?.topic && goal.topic !== 'price' && !(debug.goal as { topics?: string[] })?.topics?.includes('price')) {
            // allow multi
          }
          if (!/₹|price|pricing|charge|gst|stamp|registration|landed|total|lakh|maintenance/i.test(reply)) {
            fails.push('all-in reply thin');
          }
          // Must not be brochure-first spam without price
          if (/brochure/i.test(reply) && !/₹|price|charge|gst|stamp/i.test(reply)) {
            fails.push('brochure without price');
          }
          if (tools.includes('mediaShare') && !tools.includes('pricing') && !tools.includes('landedCost')) {
            fails.push(`tools=${tools.join(',')} expected pricing/landedCost`);
          }
          return fails;
        },
      },
    ],
  },
  {
    id: 'SMOKE-HINGLISH-OBJECTION',
    builder_id: 'brigade-group',
    turns: [
      { text: 'hi' },
      { text: '2 BHK apartment in North Bangalore under 1.5 Cr' },
      { text: 'Brigade Eldorado' },
      {
        // One instance of the evaluative-cost class (stance × cost) — not a special case.
        text: 'thoda mehengaa lag raha hai yaar',
        check: (reply, debug) => {
          const fails: string[] = [];
          const goal = debug.goal as { kind?: string; topic?: string } | undefined;
          const lower = reply.toLowerCase();
          if (/couldn't make sense/i.test(reply)) fails.push('clarify spam');
          if (goal?.kind === 'clarify_intent') fails.push('goal=clarify_intent');
          if (goal?.kind === 'answer' && goal?.topic === 'price') {
            fails.push('treated as price FAQ not cost-stance');
          }
          if (
            goal?.kind !== 'objection' &&
            goal?.kind !== 'handoff' &&
            goal?.kind !== 'recommend' &&
            goal?.kind !== 'ack_reject_recommend' &&
            goal?.kind !== 'no_fit' &&
            !/budget|expensive|option|cheaper|understand|hear|team|adjust|range|higher/i.test(lower)
          ) {
            fails.push(`weak cost-stance handling goal=${goal?.kind}`);
          }
          return fails;
        },
      },
    ],
  },
  {
    id: 'SMOKE-VISIT-SLOT',
    builder_id: 'brigade-group',
    turns: [
      { text: 'hi' },
      { text: '2 BHK apartment in Devanahalli under 80 lakh' },
      { text: 'Brigade Orchards' },
      { text: 'I want to visit' },
      {
        text: 'saturday morning possible? coming from whitefield',
        check: (reply, debug) => {
          const fails: string[] = [];
          const goal = debug.goal as { kind?: string } | undefined;
          const phase = String(debug.phase ?? '');
          if (/couldn't make sense/i.test(reply)) fails.push('clarify spam');
          if (goal?.kind === 'clarify_intent') fails.push('goal=clarify_intent');
          if (goal?.kind === 'recommend') fails.push('dumped board instead of visit');
          if (
            !/visit|saturday|whitefield|confirm|slot|morning|10|11|yes/i.test(reply) &&
            !String(goal?.kind ?? '').startsWith('visit')
          ) {
            fails.push(`not visit-shaped goal=${goal?.kind} phase=${phase}`);
          }
          return fails;
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
  console.log(`Smoke → ${SPINE} deepseek=${(health as { deepseek?: boolean }).deepseek}\n`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join(ROOT, 'docs/reports/quality-factory-2026-08-12', `smoke-${stamp}`);
  mkdirSync(outDir, { recursive: true });

  let failed = 0;
  const all: unknown[] = [];

  for (const j of JOURNEYS) {
    console.log(`══ ${j.id} ══`);
    const phone = `+9197${Date.now().toString().slice(-10)}`;
    let conv: string | undefined;
    const turns: unknown[] = [];
    let ok = true;
    for (let i = 0; i < j.turns.length; i++) {
      const t = j.turns[i]!;
      try {
        const resp = await chat(j.builder_id, phone, t.text, conv);
        conv = resp.thread_id || conv;
        const fails = t.check?.(resp.reply, resp.debug) ?? [];
        const pass = fails.length === 0;
        if (!pass) ok = false;
        const goal = resp.debug.goal;
        const timings = (resp.debug as { timings?: { total_ms?: number; extract_ms?: number; compose_ms?: number } }).timings;
        const llmUsed = (resp.debug as { llm_used?: boolean }).llm_used;
        const composeTpl = (resp.debug as { compose_template?: boolean }).compose_template;
        console.log(
          `  ${pass ? '✓' : '✗'} t${i + 1} ${resp.ms}ms goal=${JSON.stringify(goal)}` +
            ` llm=${llmUsed ? 'y' : 'n'} tpl=${composeTpl ? 'y' : 'n'}` +
            (timings?.total_ms != null ? ` total_ms=${timings.total_ms}` : ''),
        );
        console.log(`     buyer: ${t.text}`);
        console.log(`     bot:   ${resp.reply.slice(0, 220).replace(/\n/g, ' / ')}`);
        if (!pass) for (const f of fails) console.log(`         !! ${f}`);
        turns.push({
          index: i + 1,
          buyer: t.text,
          reply: resp.reply,
          ms: resp.ms,
          pass,
          failures: fails,
          goal: resp.debug.goal,
          phase: resp.debug.phase,
          tools: resp.debug.tools,
          timings,
          llm_used: llmUsed,
          compose_template: composeTpl,
          extract_provenance: (resp.debug as { extract_provenance?: unknown }).extract_provenance,
        });
        await new Promise((r) => setTimeout(r, 2500));
      } catch (e) {
        ok = false;
        console.log(`  ✗ t${i + 1} ERROR ${e}`);
        turns.push({
          index: i + 1,
          buyer: t.text,
          reply: '',
          pass: false,
          failures: [e instanceof Error ? e.message : String(e)],
        });
        break;
      }
    }
    if (!ok) failed++;
    const rec = { id: j.id, ok, turns };
    all.push(rec);
    writeFileSync(join(outDir, `${j.id}.json`), JSON.stringify(rec, null, 2));
    await new Promise((r) => setTimeout(r, 5000));
  }

  writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ spine: SPINE, all }, null, 2));
  console.log(`\n${failed ? 'FAIL' : 'PASS'} ${JOURNEYS.length - failed}/${JOURNEYS.length}`);
  console.log(`Recorded ${outDir}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
