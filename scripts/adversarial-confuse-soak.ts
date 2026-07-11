#!/usr/bin/env npx tsx
/**
 * Adversarial 15–20 turn confuse soaks focused on A–H fix seams.
 * Records JSON + HTML under scenarios/runs/adversarial-<stamp>/
 *
 *   CONVERSE_SPINE_URL=https://converse-spine-dev... npx tsx scripts/adversarial-confuse-soak.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SPINE = (process.env.CONVERSE_SPINE_URL ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev').replace(
  /\/+$/,
  '',
);

type Turn = {
  text: string;
  expectIncludes?: string[];
  expectExcludes?: string[];
  /** W2: after this turn, shortlist must not retain these project id substrings. */
  expectOfferedIdsExclude?: string[];
  /** W3: visit originText must not equal / contain these (case-insensitive). */
  expectOriginExcludes?: string[];
  /** Debug goal.kind must match (prefix ok). */
  expectGoalKind?: string;
};
type Journey = { id: string; focus: string; builder_id: string; turns: Turn[] };

const JOURNEYS: Journey[] = [
  {
    id: 'ADV-SWITCH-MEDIA',
    focus: 'C+G switch compose + Hinglish media stickiness',
    builder_id: 'brigade-group',
    turns: [
      { text: 'hi' },
      { text: 'Apartment in North Bangalore under 1.5 Cr' },
      { text: 'Brigade Eldorado', expectIncludes: ['eldorado'] },
      { text: 'actually show me Buena Vista instead', expectIncludes: ['buena'], expectExcludes: ['eldorado'] },
      { text: 'Send brochure' },
      { text: 'Meadows', expectIncludes: ['meadow'] },
      { text: 'pricing?' },
      { text: 'wait no go back to Buena Vista', expectIncludes: ['buena'] },
      { text: 'brochure bhejo' },
      { text: 'what about Orchards instead', expectIncludes: ['orchard'] },
      { text: 'legal?' },
      { text: 'Eldorado again', expectIncludes: ['eldorado'] },
      { text: 'Starting prices' },
      { text: 'nahi chahiye' },
      { text: 'compare Buena Vista and Meadows' },
      { text: 'ok Buena Vista', expectIncludes: ['buena'] },
      { text: 'floor plan?' },
      { text: 'visit this weekend?' },
    ],
  },
  {
    id: 'ADV-PIVOT-BUDGET',
    focus: 'W2 pivots invalidate stale shortlist + budget refine',
    builder_id: 'brigade-group',
    turns: [
      { text: 'hi we are a family of 4 looking for 3BHK in North Bangalore under 1.2 Cr preferably ready to move near airport' },
      { text: 'show options' },
      { text: 'actually my budget is only 50L' },
      { text: 'Brigade Eldorado', expectIncludes: ['eldorado'] },
      {
        text: 'wait I meant Whitefield not Devanahalli',
        expectExcludes: ['near devanahalli'],
      },
      { text: 'change to 2BHK under 70L' },
      { text: 'any in Whitefield?', expectIncludes: ['whitefield'] },
      { text: 'Cornerstone Utopia' },
      { text: 'pricing' },
      { text: 'actually make it 3BHK under 1.5 Cr again' },
      { text: 'show me matches' },
      { text: 'why is the sky blue lol' },
      { text: 'anyway Eldorado price', expectIncludes: ['eldorado'] },
      { text: 'BSP and carpet?' },
      { text: 'possession date?' },
      { text: 'ok thanks' },
      { text: 'something else in North Bangalore' },
      { text: 'my budget is 80L now' },
    ],
  },
  {
    id: 'ADV-LOK-EXPERT-MEDIA',
    focus: 'W1 sticky + W3 visit instead ≠ origin + Lokations',
    builder_id: 'lokations',
    turns: [
      { text: 'hi' },
      { text: 'plantation in sakleshpur' },
      { text: 'Ayana', expectIncludes: ['ayana'] },
      { text: 'Floor plan?', expectIncludes: ['ayana'] },
      { text: 'brochure bhejo', expectIncludes: ['ayana'], expectExcludes: ['century', 'breeze'] },
      { text: 'price kitna hai', expectIncludes: ['ayana'] },
      { text: 'also Krishnaja Greens' },
      { text: 'dono compare karo' },
      { text: 'visit both of them' },
      {
        text: 'Krishnaja instead',
        expectExcludes: ['coming from *krishnaja', 'from *krishnaja'],
      },
      { text: 'coming from Whitefield' },
      { text: 'Saturday morning' },
      { text: 'Ayana', expectIncludes: ['ayana'] },
      { text: "what's the BSP and carpet area and possession date", expectIncludes: ['ayana'] },
      { text: 'Thanks please share the brochure', expectIncludes: ['ayana'] },
      { text: 'Clarks Exotica instead' },
      { text: 'brochure bhejo' },
      { text: 'back to Ayana', expectIncludes: ['ayana'] },
    ],
  },
];

async function chat(builderId: string, phone: string, text: string, convId?: string) {
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
  const body = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(body.error ?? `HTTP ${r.status}`));
  const debug = (body.debug as Record<string, unknown>) ?? {};
  return {
    reply: String(body.reply_text ?? body.reply ?? ''),
    conversation_id: String(body.conversation_id ?? ''),
    debug,
  };
}

function check(reply: string, t: Turn, debug: Record<string, unknown>): string[] {
  const fails: string[] = [];
  const lower = reply.toLowerCase();
  for (const n of t.expectIncludes ?? []) {
    if (!lower.includes(n.toLowerCase())) fails.push(`missing "${n}"`);
  }
  for (const n of t.expectExcludes ?? []) {
    if (lower.includes(n.toLowerCase())) fails.push(`unexpected "${n}"`);
  }
  if (t.expectOfferedIdsExclude?.length) {
    const ids = ((debug.last_offered_ids as string[]) ?? []).map((x) => x.toLowerCase());
    for (const needle of t.expectOfferedIdsExclude) {
      if (ids.some((id) => id.includes(needle.toLowerCase()))) {
        fails.push(`stale shortlist still has "${needle}"`);
      }
    }
  }
  if (t.expectGoalKind) {
    const goal = debug.goal as { kind?: string } | undefined;
    if (!goal?.kind?.startsWith(t.expectGoalKind)) {
      fails.push(`goal ${goal?.kind ?? '?'} ≠ ${t.expectGoalKind}`);
    }
  }
  return fails;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function main() {
  const health = await fetch(`${SPINE}/health`).then((r) => r.json()).catch(() => null);
  if (!health || (health as { status?: string }).status !== 'ok') {
    console.error('Spine not up', SPINE);
    process.exit(1);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(ROOT, 'scenarios', 'runs', `adversarial-${stamp}`);
  mkdirSync(runDir, { recursive: true });
  console.log(`Adversarial confuse → ${SPINE}\n${runDir}\n`);

  const all: unknown[] = [];
  let failJourneys = 0;
  for (const j of JOURNEYS) {
    console.log(`\n══ ${j.id} — ${j.focus} ══`);
    const phone = `+9197${Date.now().toString().slice(-8)}${j.id.length % 10}`;
    let conv: string | undefined;
    const turns: unknown[] = [];
    let ok = true;
    for (let i = 0; i < j.turns.length; i++) {
      const t = j.turns[i]!;
      try {
        const resp = await chat(j.builder_id, phone, t.text, conv);
        conv = resp.conversation_id || conv;
        const failures = check(resp.reply, t, resp.debug);
        const pass = failures.length === 0;
        if (!pass) ok = false;
        const prov = resp.debug.extract_provenance as { fields?: Record<string, string> } | undefined;
        console.log(`  ${pass ? '✓' : '✗'} t${i + 1} ${t.text.slice(0, 55)}`);
        if (!pass) for (const f of failures) console.log(`         !! ${f}`);
        turns.push({
          index: i + 1,
          buyer: t.text,
          reply: resp.reply,
          pass,
          failures,
          goal: resp.debug.goal,
          phase: resp.debug.phase,
          last_offered_ids: resp.debug.last_offered_ids,
          extract_provenance: prov,
        });
        await new Promise((r) => setTimeout(r, 350));
      } catch (e) {
        ok = false;
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
    if (!ok) failJourneys++;
    const rec = { id: j.id, focus: j.focus, builder_id: j.builder_id, ok, turns };
    all.push(rec);
    writeFileSync(join(runDir, `${j.id}.json`), JSON.stringify(rec, null, 2));
  }

  writeFileSync(join(runDir, 'summary.json'), JSON.stringify({ spine: SPINE, all }, null, 2));

  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Adversarial confuse</title>
<style>
body{font:14px/1.45 system-ui;background:#0f1419;color:#e7ecf1;margin:0;padding:24px}
.scen{background:#1a222c;border:1px solid #2a3542;border-radius:10px;margin:16px 0;padding:12px}
.fail{border-color:#6b3030}.ok{color:#3dd68c}.bad{color:#ff6b6b}
.turn{border-top:1px solid #2a3542;padding:10px 0}.buyer{color:#9ecbff}.bot{white-space:pre-wrap}
</style></head><body>
<h1>Adversarial confuse soaks</h1>
<p>${esc(SPINE)} · ${esc(runDir)}</p>
${(all as Array<{ id: string; focus: string; ok: boolean; turns: Array<{ index: number; buyer: string; reply: string; pass: boolean; failures: string[]; goal?: unknown }> }>)
  .map(
    (j) => `<div class="scen ${j.ok ? '' : 'fail'}"><h2><span class="${j.ok ? 'ok' : 'bad'}">${j.ok ? 'PASS' : 'FAIL'}</span> ${esc(j.id)} — ${esc(j.focus)}</h2>
${j.turns
  .map(
    (t) => `<div class="turn"><div class="buyer">t${t.index} Buyer: ${esc(t.buyer)}</div>
<div class="bot">Bot: ${esc(t.reply)}</div>
${t.failures?.length ? `<div class="bad">${esc(t.failures.join('; '))}</div>` : ''}
<code>${esc(JSON.stringify(t.goal ?? {}))}</code></div>`,
  )
  .join('')}</div>`,
  )
  .join('')}
</body></html>`;
  writeFileSync(join(runDir, 'report.html'), html);
  writeFileSync(join(ROOT, 'scenarios', 'runs', 'adversarial-latest.html'), html);
  console.log(`\n${failJourneys ? 'FAIL' : 'PASS'} journeys fail=${failJourneys}/${JOURNEYS.length}`);
  console.log(`HTML → ${runDir}/report.html`);
  process.exit(failJourneys ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
