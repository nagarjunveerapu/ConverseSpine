#!/usr/bin/env npx tsx
/**
 * Phase 1c adversarial state report — confuse the discourse store and read the wreckage.
 *
 *   npm run test:phase-1c:report
 *
 * Writes scenarios/runs/phase-1c-adv-<stamp>/{summary.json,report.html}
 *
 * This is the human-readable twin of `tests/phase-1c-state-adversarial.test.ts`.
 * Vitest is the gate; this file is for turn-by-turn inspection after a red/green.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  currentShortlist,
  discourseEntities,
  focusedRef,
} from '../src/engine/entity-store.js';
import {
  commitTo,
  initState,
  recordDiscussed,
  recordOffered,
} from '../src/engine/state.js';
import { runEngineTurn } from '../src/engine/turn.js';
import type { ConversationState, Match } from '../src/engine/types.js';
import { fakeDeps } from '../tests/fakes.js';
import {
  gradeCompareBoth,
  gradeOtherOne,
  gradeShowSomethingElse,
} from '../tests/phase-1c-conversation-quality.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const AYANA: Match = {
  projectId: 'ayana',
  name: 'Ayana',
  microMarket: 'Sakleshpur',
  startingPriceInr: 2_495_000,
  startingPriceDisplay: '₹24.95 L',
  matchReasons: [],
};
const KRISHNAJA: Match = {
  projectId: 'krishnaja',
  name: 'Krishnaja Greens',
  microMarket: 'Virajpet',
  startingPriceInr: 3_900_000,
  startingPriceDisplay: '₹39 L',
  matchReasons: [],
};

function poisonMirror(s: ConversationState): ConversationState {
  return {
    ...s,
    discover: {
      ...s.discover,
      lastOffered: [
        { projectId: 'eldorado', name: 'Brigade Eldorado' },
        { projectId: 'sanctuary', name: 'Brigade Sanctuary' },
      ],
    },
  };
}

function snap(s: ConversationState) {
  return {
    phase: s.phase,
    focus: focusedRef(s) ?? null,
    stack: s.focusStack ?? [],
    shortlistIds: s.shortlistIds ?? [],
    board: currentShortlist(s).map((o) => o.projectId),
    mirror: s.discover.lastOffered.map((o) => o.projectId),
    discourse: discourseEntities(s).map((e) => e.projectId),
  };
}

interface Row {
  id: string;
  ok: boolean;
  failures: string[];
  turns: Array<{ buyer: string; reply: string; state: ReturnType<typeof snap>; notes: string[] }>;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function journeyPoisonThrash(): Promise<Row> {
  const id = 'ADV-J6-poison-thrash';
  const deps = fakeDeps();
  const convId = 'report-j6';
  const failures: string[] = [];
  const turns: Row['turns'] = [];

  const say = async (buyer: string) => {
    const before = (await deps.store.load(convId)) ?? initState(convId, 'lokations');
    const r = await runEngineTurn(
      { convId, builderId: 'lokations', text: buyer, buyerPhone: '+919900009901', channel: 'advisor_web' },
      deps,
    );
    const notes: string[] = [];
    const st = snap(r.state);
    if (st.shortlistIds.length && JSON.stringify(st.board) !== JSON.stringify(st.shortlistIds)) {
      failures.push(`${buyer}: board≠shortlistIds`);
      notes.push('FAIL board≠shortlistIds');
    }
    if (st.phase === 'focused') {
      if (!st.focus) {
        failures.push(`${buyer}: focused phase without focusedRef`);
        notes.push('FAIL no focusedRef');
      } else if (st.stack[0] !== st.focus.projectId) {
        failures.push(`${buyer}: stack[0]≠focus`);
        notes.push('FAIL stack/focus diverge');
      }
      if (st.focus?.projectId === 'eldorado' || st.focus?.projectId === 'sanctuary') {
        failures.push(`${buyer}: poison became focus`);
        notes.push('FAIL poison→focus');
      }
    }
    if (/\b(?:the other one|go back)\b/i.test(buyer)) {
      const q = gradeOtherOne({ buyer, reply: r.reply, before, after: r.state });
      if (q) {
        failures.push(`${buyer}: ${q.reason}`);
        notes.push(`FAIL quality: ${q.reason}`);
      }
    }
    if (/\bcompare\b/i.test(buyer)) {
      const q = gradeCompareBoth({ buyer, reply: r.reply, state: before });
      if (q) {
        failures.push(`${buyer}: ${q.reason}`);
        notes.push(`FAIL quality: ${q.reason}`);
      }
    }
    if (/\bsomething else\b/i.test(buyer)) {
      const q = gradeShowSomethingElse({ buyer, reply: r.reply, before, after: r.state });
      if (q) {
        failures.push(`${buyer}: ${q.reason}`);
        notes.push(`FAIL quality: ${q.reason}`);
      }
    }
    if (JSON.stringify(st.mirror) !== JSON.stringify(st.board) && st.shortlistIds.length) {
      notes.push('mirror desynced (expected after poison write)');
    }
    // Poison for the next turn.
    await deps.store.save(poisonMirror(r.state));
    turns.push({ buyer, reply: r.reply, state: st, notes });
  };

  for (const line of [
    'hi',
    'plantation in sakleshpur',
    'tell me about ayana',
    'pricing?',
    'what about the other one',
    'compare both',
    'go back to the first one',
    'rera for this',
    'show me something else',
  ]) {
    await say(line);
  }

  return { id, ok: failures.length === 0, failures, turns };
}

async function journeySiblingGoBack(): Promise<Row> {
  const id = 'ADV-J2-sibling-go-back';
  const deps = fakeDeps();
  const convId = 'report-j2';
  const failures: string[] = [];
  const turns: Row['turns'] = [];
  const say = async (buyer: string) => {
    const r = await runEngineTurn(
      {
        convId,
        builderId: 'naya-advisor',
        text: buyer,
        buyerPhone: '+919900009902',
        channel: 'advisor_web',
      },
      deps,
    );
    const st = snap(r.state);
    const notes: string[] = [];
    if (buyer.includes('Utopia') && st.phase === 'focused' && !/utopia/i.test(st.focus?.projectId ?? '')) {
      failures.push('NAME-06 did not switch to Utopia');
      notes.push('FAIL no utopia focus');
    }
    if (buyer.includes('go back') && st.phase === 'focused' && /utopia/i.test(st.focus?.projectId ?? '')) {
      failures.push('go-back stayed on Utopia');
      notes.push('FAIL still utopia');
    }
    turns.push({ buyer, reply: r.reply, state: st, notes });
  };
  await say('tell me about Brigade Cornerstone');
  await say('what about Brigade Cornerstone Utopia');
  await say('go back to the first one');
  return { id, ok: failures.length === 0, failures, turns };
}

async function journeyCompareBothVsPoison(): Promise<Row> {
  const id = 'ADV-J1-compare-vs-poison';
  const deps = fakeDeps();
  const convId = 'report-j1';
  let s = recordOffered(initState(convId, 'lokations'), [AYANA, KRISHNAJA]);
  s = commitTo(s, 'ayana', 'Ayana');
  s = recordDiscussed(s, [{ projectId: 'krishnaja', name: 'Krishnaja Greens' }]);
  await deps.store.save(poisonMirror(s));

  const r = await runEngineTurn(
    {
      convId,
      builderId: 'lokations',
      text: 'compare both',
      buyerPhone: '+919900009903',
      channel: 'advisor_web',
    },
    deps,
  );
  const st = snap(r.state);
  const failures: string[] = [];
  const blob = `${r.reply} ${JSON.stringify(r.debug)}`.toLowerCase();
  if (!/ayana|krishnaja/.test(blob)) failures.push('compare reply lost discourse pair');
  if (/eldorado|sanctuary/.test(blob) && !/ayana|krishnaja/.test(blob)) {
    failures.push('compare followed poisoned mirror');
  }
  return {
    id,
    ok: failures.length === 0,
    failures,
    turns: [{ buyer: 'compare both', reply: r.reply, state: st, notes: failures }],
  };
}

async function main(): Promise<void> {
  const rows = await Promise.all([
    journeyPoisonThrash(),
    journeySiblingGoBack(),
    journeyCompareBothVsPoison(),
  ]);
  const pass = rows.filter((r) => r.ok).length;
  const fail = rows.length - pass;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(ROOT, 'scenarios', 'runs', `phase-1c-adv-${stamp}`);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'summary.json'), JSON.stringify({ pass, fail, rows }, null, 2));

  const body = rows
    .map((r) => {
      const turns = r.turns
        .map(
          (t) => `<div class="turn">
  <div class="meta">buyer: ${esc(t.buyer)}${t.notes.length ? ` · ${esc(t.notes.join('; '))}` : ''}</div>
  <pre class="reply">${esc(t.reply)}</pre>
  <pre class="state">${esc(JSON.stringify(t.state, null, 2))}</pre>
</div>`,
        )
        .join('\n');
      return `<section class="${r.ok ? 'pass' : 'fail'}"><h2>${r.ok ? 'PASS' : 'FAIL'} ${esc(r.id)}</h2>
${r.failures.length ? `<ul>${r.failures.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
${turns}</section>`;
    })
    .join('\n');

  writeFileSync(
    join(runDir, 'report.html'),
    `<!doctype html><html><head><meta charset="utf-8"/><title>Phase 1c adversarial</title>
<style>
body{font:14px/1.45 ui-sans-serif,system-ui;margin:24px;background:#f4f1ea;color:#1a1a1a}
h1{font-size:22px} h2{font-size:16px;margin:0 0 8px}
section{background:#fff;border:1px solid #ddd;border-radius:8px;padding:14px 16px;margin:12px 0}
section.fail{border-color:#b33} section.pass{border-color:#2a7}
.turn{margin:10px 0;padding:8px;background:#faf8f3;border-radius:6px}
.meta{font-size:12px;color:#555;margin-bottom:4px}
pre{white-space:pre-wrap;margin:4px 0;font-size:12px}
pre.state{color:#444;background:#f0eee8;padding:8px;border-radius:4px}
</style></head><body>
<h1>Phase 1c adversarial — ${pass}/${rows.length} pass</h1>
<p>Poisoned <code>lastOffered</code> every turn; store must stay authority. Open <code>summary.json</code> for machine detail.</p>
${body}
</body></html>`,
  );

  console.log(`Phase 1c adversarial: ${pass} pass / ${fail} fail`);
  console.log(runDir);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
