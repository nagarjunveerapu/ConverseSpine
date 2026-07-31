#!/usr/bin/env npx tsx
/**
 * Unbound-name (PR-2-lite) scenario gate you can read turn-by-turn.
 *
 * Local (fake engine — always available, proves fix vs prior pool-guess):
 *   npm run test:unbound-name:report
 *
 * Dig live (requires deploy of this branch):
 *   npm run test:unbound-name:live
 *   CONVERSE_SPINE_URL=https://converse-spine-dev… npm run test:unbound-name:live
 *
 * Writes scenarios/runs/unbound-name-<stamp>/{summary.json,report.html}
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCompareProjectIds } from '../src/engine/compare_resolve.js';
import { stampNamedAndUnbound } from '../src/engine/named_bind.js';
import { initState } from '../src/engine/state.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from '../tests/fakes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LIVE = process.argv.includes('--live') || process.env.UNBOUND_LIVE === '1';
const BASE = (process.env.CONVERSE_SPINE_URL ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev').replace(
  /\/+$/,
  '',
);
const BUILDER = process.env.BUILDER_ID ?? 'naya-advisor';

const SHORTLIST = [
  { projectId: 'ayana', name: 'Ayana' },
  { projectId: 'desire-spaces', name: 'Desire Spaces' },
  { projectId: 'vanam', name: 'Vanam' },
];

const CATALOG = [
  { projectId: 'ayana', name: 'Ayana' },
  { projectId: 'krishnaja', name: 'Krishnaja Greens' },
  { projectId: 'eldorado', name: 'Brigade Eldorado' },
  { projectId: 'sanctuary', name: 'Brigade Sanctuary' },
];

interface CaseRow {
  id: string;
  ok: boolean;
  failures: string[];
  turns: Array<{ role: string; text?: string; reply?: string; goal?: unknown; note?: string }>;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function writeReport(runDir: string, pass: number, fail: number, rows: CaseRow[]): void {
  writeFileSync(join(runDir, 'summary.json'), JSON.stringify({ pass, fail, mode: LIVE ? 'live' : 'local', rows }, null, 2));
  const body = rows
    .map((r) => {
      const turns = r.turns
        .map(
          (t) =>
            `<div class="turn"><div class="meta">${esc(t.role)}${t.text ? ` · buyer: ${esc(t.text)}` : ''}${
              t.note ? ` · ${esc(t.note)}` : ''
            }</div><pre>${esc(t.reply ?? '')}</pre></div>`,
        )
        .join('\n');
      return `<section class="${r.ok ? 'pass' : 'fail'}"><h2>${r.ok ? 'PASS' : 'FAIL'} ${esc(r.id)}</h2>${
        r.failures.length ? `<ul>${r.failures.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''
      }${turns}</section>`;
    })
    .join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Unbound-name ${LIVE ? 'live' : 'local'}</title>
<style>
body{font:14px/1.45 ui-sans-serif,system-ui;margin:24px;background:#f6f4ef;color:#1a1a1a}
h1{font-size:22px} h2{font-size:16px;margin:0 0 8px}
section{background:#fff;border:1px solid #ddd;border-radius:8px;padding:14px 16px;margin:12px 0}
section.fail{border-color:#c44} section.pass{border-color:#2a7}
.turn{margin:10px 0;padding:8px;background:#faf9f6;border-radius:6px}
.meta{font-size:12px;color:#555;margin-bottom:4px} pre{white-space:pre-wrap;margin:0}
</style></head><body>
<h1>Unbound-name (PR-2-lite) — ${LIVE ? 'dig live' : 'local fake'}</h1>
<p>${pass} pass / ${fail} fail${LIVE ? ` @ ${esc(BASE)}` : ' (runEngineTurn + fakes)'}</p>
${body}
</body></html>`;
  writeFileSync(join(runDir, 'report.html'), html);
}

/** Prior-state defect: askTopic=compare + empty named + no catalog → shortlist pool-guess. */
function defectProbePriorState(): CaseRow {
  const state = {
    ...initState('defect', 'naya-advisor'),
    discover: {
      ...initState('defect', 'naya-advisor').discover,
      lastOffered: SHORTLIST.map((o) => ({ ...o })),
    },
  };
  const priorIds = resolveCompareProjectIds(
    'comparing Eldorado and Sanctuary',
    { constraints: {}, askTopic: 'compare' },
    state,
    [], // prior: catalog never in matching pool
  );
  const fixed = stampNamedAndUnbound(
    'comparing Eldorado and Sanctuary',
    { constraints: {}, askTopic: 'compare' },
    { session: SHORTLIST, catalog: CATALOG },
  );
  const fixedIds = resolveCompareProjectIds(
    'comparing Eldorado and Sanctuary',
    fixed,
    state,
    CATALOG,
  );
  const failures: string[] = [];
  // Document prior broken shape (what dig still does until this ships).
  if (JSON.stringify(priorIds) !== JSON.stringify(['ayana', 'desire-spaces', 'vanam'])) {
    failures.push(`prior-state probe expected shortlist pool-guess, got ${JSON.stringify(priorIds)}`);
  }
  if (JSON.stringify([...fixedIds].sort()) !== JSON.stringify(['eldorado', 'sanctuary'])) {
    failures.push(`fixed probe expected eldorado+sanctuary, got ${JSON.stringify(fixedIds)}`);
  }
  return {
    id: 'UN-00-defect-probe',
    ok: failures.length === 0,
    failures,
    turns: [
      {
        role: 'prior-state (no catalog, no unbound)',
        text: 'comparing Eldorado and Sanctuary',
        reply: `compareProjectIds = ${JSON.stringify(priorIds)}  ← pool-guessed shortlist`,
        note: 'this is the broken previous behaviour',
      },
      {
        role: 'after PR-2-lite',
        text: 'comparing Eldorado and Sanctuary',
        reply: `compareProjectIds = ${JSON.stringify(fixedIds)}  unbound=${JSON.stringify(fixed.unboundProjectNames ?? [])}`,
        note: 'catalog match + unbound typing',
      },
    ],
  };
}

async function localCases(): Promise<CaseRow[]> {
  const rows: CaseRow[] = [defectProbePriorState()];

  async function seedAndAsk(
    id: string,
    offered: Array<{ projectId: string; name: string }>,
    ask: string,
    assert: (reply: string, goal: { kind?: string; topic?: string } | undefined) => string[],
  ): Promise<CaseRow> {
    const deps = fakeDeps();
    const phone = `+9199${id.replace(/\W/g, '').slice(-8).padStart(8, '0')}`;
    const turn = (text: string) =>
      runEngineTurn(
        { convId: id, builderId: 'naya-advisor', text, buyerPhone: phone, channel: 'advisor_web' },
        deps,
      );
    const turns: CaseRow['turns'] = [];
    const failures: string[] = [];
    try {
      const hi = await turn('hi');
      turns.push({ role: 'seed', text: 'hi', reply: hi.reply });
      const s = await deps.store.load(id);
      s!.discover.lastOffered = offered.map((o) => ({ ...o }));
      await deps.store.save(s!);
      turns.push({
        role: 'seed-shortlist',
        reply: offered.map((o) => o.name).join(', '),
        note: 'conversation pool (mutated for J7 shape)',
      });
      const r = await turn(ask);
      const goal = r.debug.goal as { kind?: string; topic?: string };
      turns.push({ role: 'ask', text: ask, reply: r.reply, goal });
      failures.push(...assert(r.reply, goal));
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
    return { id, ok: failures.length === 0, failures, turns };
  }

  rows.push(
    await seedAndAsk('UN-01', SHORTLIST, 'comparing Eldorado and Sanctuary', (reply, goal) => {
      const f: string[] = [];
      if (!/Eldorado/i.test(reply)) f.push('reply missing Eldorado');
      if (!/Sanctuary/i.test(reply)) f.push('reply missing Sanctuary');
      if (/Ayana/i.test(reply)) f.push('reply must not name Ayana (shortlist leak)');
      if (!(goal?.kind === 'answer' && goal.topic === 'compare')) f.push(`goal not compare (${goal?.kind}/${goal?.topic})`);
      return f;
    }),
  );

  rows.push(
    await seedAndAsk(
      'UN-02',
      [
        { projectId: 'ayana', name: 'Ayana' },
        { projectId: 'krishnaja', name: 'Krishnaja Greens' },
        { projectId: 'clarks', name: 'Clarks Exotica' },
      ],
      'compare ayana and krishnaja greens',
      (reply) => {
        const f: string[] = [];
        if (!/Ayana/i.test(reply)) f.push('missing Ayana');
        if (!/Krishnaja/i.test(reply)) f.push('missing Krishnaja');
        if (/Clarks/i.test(reply)) f.push('must not name Clarks');
        return f;
      },
    ),
  );

  {
    const deps = fakeDeps();
    const id = 'UN-03';
    const phone = '+919900000003';
    const turns: CaseRow['turns'] = [];
    const failures: string[] = [];
    try {
      await runEngineTurn(
        { convId: id, builderId: 'naya-advisor', text: 'hi', buyerPhone: phone, channel: 'advisor_web' },
        deps,
      );
      const s = await deps.store.load(id);
      s!.discover.lastOffered = [
        { projectId: 'ayana', name: 'Ayana' },
        { projectId: 'krishnaja', name: 'Krishnaja Greens' },
      ];
      s!.discover.discussedProjects = [
        { projectId: 'ayana', name: 'Ayana' },
        { projectId: 'krishnaja', name: 'Krishnaja Greens' },
      ];
      await deps.store.save(s!);
      turns.push({ role: 'seed-shortlist+discussed', reply: 'Ayana, Krishnaja Greens' });
      const r = await runEngineTurn(
        {
          convId: id,
          builderId: 'naya-advisor',
          text: 'compare both',
          buyerPhone: phone,
          channel: 'advisor_web',
        },
        deps,
      );
      turns.push({ role: 'ask', text: 'compare both', reply: r.reply, goal: r.debug.goal });
      if (!/Ayana/i.test(r.reply)) failures.push('missing Ayana');
      if (!/Krishnaja/i.test(r.reply)) failures.push('missing Krishnaja');
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
    rows.push({ id, ok: failures.length === 0, failures, turns });
  }

  rows.push(
    await seedAndAsk('UN-04', SHORTLIST, 'compare Prestige Lakeside and Eldorado', (reply, goal) => {
      const f: string[] = [];
      if (/Ayana/i.test(reply)) f.push('must not pool-guess Ayana');
      if (/Desire Spaces/i.test(reply)) f.push('must not pool-guess Desire Spaces');
      if (/\bVanam\b/i.test(reply)) f.push('must not pool-guess Vanam');
      if (goal?.kind === 'answer' && goal.topic === 'compare' && /Ayana|Desire|Vanam/i.test(reply)) {
        f.push('wrong compare board from shortlist');
      }
      return f;
    }),
  );

  return rows;
}

async function advisorTurn(
  sessionId: string,
  text: string,
): Promise<{ reply: string; goal?: { kind?: string; topic?: string } }> {
  const r = await fetch(`${BASE}/api/advisor/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ builder_id: BUILDER, session_id: sessionId, text }),
  });
  const j = (await r.json()) as {
    reply?: string;
    debug?: { goal?: { kind?: string; topic?: string } };
    error?: string;
  };
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return { reply: j.reply ?? '', goal: j.debug?.goal };
}

async function liveCases(): Promise<CaseRow[]> {
  const rows: CaseRow[] = [];

  // UN-01 dig: build a shortlist that is NOT Eldorado/Sanctuary, then named compare.
  {
    const id = 'UN-01';
    const sid = `${id}-${Date.now()}`;
    const turns: CaseRow['turns'] = [];
    const failures: string[] = [];
    try {
      const search = await advisorTurn(
        sid,
        'show me 3 BHK apartments in Whitefield under 1.2 Cr',
      );
      turns.push({ role: 'seed-search', text: 'show me 3 BHK apartments in Whitefield under 1.2 Cr', reply: search.reply });
      const ask = await advisorTurn(sid, 'comparing Eldorado and Sanctuary');
      turns.push({ role: 'ask', text: 'comparing Eldorado and Sanctuary', reply: ask.reply, goal: ask.goal });
      if (!/Eldorado/i.test(ask.reply)) failures.push('reply missing Eldorado');
      if (!/Sanctuary/i.test(ask.reply)) failures.push('reply missing Sanctuary');
      // Shortlist leak: if dig still pool-guesses, Utopia/Meadows dominate without named pair.
      if (
        ask.goal?.kind === 'answer' &&
        ask.goal.topic === 'compare' &&
        !/Eldorado/i.test(ask.reply) &&
        /Utopia|Meadows|Ayana|Desire/i.test(ask.reply)
      ) {
        failures.push('pool-guessed shortlist instead of Eldorado+Sanctuary');
      }
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
    rows.push({ id, ok: failures.length === 0, failures, turns });
  }

  {
    const id = 'UN-02';
    const sid = `${id}-${Date.now()}`;
    const turns: CaseRow['turns'] = [];
    const failures: string[] = [];
    try {
      const a = await advisorTurn(sid, 'tell me about Brigade Eldorado');
      turns.push({ role: 'seed', text: 'tell me about Brigade Eldorado', reply: a.reply });
      const b = await advisorTurn(sid, 'compare Eldorado and Sanctuary');
      turns.push({ role: 'ask', text: 'compare Eldorado and Sanctuary', reply: b.reply, goal: b.goal });
      if (!/Eldorado/i.test(b.reply)) failures.push('missing Eldorado');
      if (!/Sanctuary/i.test(b.reply)) failures.push('missing Sanctuary');
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
    rows.push({ id, ok: failures.length === 0, failures, turns });
  }

  {
    const id = 'UN-03';
    const sid = `${id}-${Date.now()}`;
    const turns: CaseRow['turns'] = [];
    const failures: string[] = [];
    try {
      const a = await advisorTurn(sid, 'tell me about Brigade Eldorado');
      turns.push({ role: 'seed', text: 'tell me about Brigade Eldorado', reply: a.reply });
      const b = await advisorTurn(sid, 'also tell me about Brigade Sanctuary');
      turns.push({ role: 'seed', text: 'also tell me about Brigade Sanctuary', reply: b.reply });
      const c = await advisorTurn(sid, 'compare both');
      turns.push({ role: 'ask', text: 'compare both', reply: c.reply, goal: c.goal });
      if (!/Eldorado/i.test(c.reply)) failures.push('anaphora missing Eldorado');
      if (!/Sanctuary/i.test(c.reply)) failures.push('anaphora missing Sanctuary');
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
    rows.push({ id, ok: failures.length === 0, failures, turns });
  }

  {
    const id = 'UN-04';
    const sid = `${id}-${Date.now()}`;
    const turns: CaseRow['turns'] = [];
    const failures: string[] = [];
    try {
      const search = await advisorTurn(
        sid,
        'show me 3 BHK apartments in Whitefield under 1.2 Cr',
      );
      turns.push({ role: 'seed-search', reply: search.reply });
      const ask = await advisorTurn(sid, 'compare Prestige Lakeside and Eldorado');
      turns.push({
        role: 'ask',
        text: 'compare Prestige Lakeside and Eldorado',
        reply: ask.reply,
        goal: ask.goal,
      });
      // Must not silently compare the Whitefield shortlist as if Prestige bound.
      if (
        ask.goal?.kind === 'answer' &&
        ask.goal.topic === 'compare' &&
        /Utopia|Meadows|Calista/i.test(ask.reply) &&
        !/Prestige|couldn't|not sure|which|clarify|don't have|couldn't find|not in/i.test(ask.reply)
      ) {
        // Soft: if it compares Eldorado to something from shortlist without acknowledging Prestige miss, fail.
        if (!/Eldorado/i.test(ask.reply) || /Utopia|Meadows/i.test(ask.reply)) {
          failures.push('likely pool-guessed shortlist on Prestige miss');
        }
      }
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
    rows.push({ id, ok: failures.length === 0, failures, turns });
  }

  return rows;
}

async function main(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(ROOT, 'scenarios', 'runs', `unbound-name-${stamp}`);
  mkdirSync(runDir, { recursive: true });

  console.log(`Unbound-name scenarios (${LIVE ? 'dig live' : 'local fake'})`);
  if (LIVE) console.log(`@ ${BASE}\n`);

  const rows = LIVE ? await liveCases() : await localCases();
  let pass = 0;
  let fail = 0;
  for (const r of rows) {
    if (r.ok) pass += 1;
    else fail += 1;
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.ok ? '' : ` — ${r.failures.join('; ')}`}`);
    for (const t of r.turns) {
      if (t.role === 'ask' || t.role.startsWith('prior') || t.role.startsWith('after')) {
        console.log(`  [${t.role}] ${t.text ?? ''}`);
        console.log(`  → ${(t.reply ?? '').slice(0, 220).replace(/\n/g, ' ')}`);
      }
    }
  }

  writeReport(runDir, pass, fail, rows);
  console.log(`\n${pass} pass / ${fail} fail`);
  console.log(`Report: ${join(runDir, 'report.html')}`);
  console.log(`JSON:   ${join(runDir, 'summary.json')}`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
