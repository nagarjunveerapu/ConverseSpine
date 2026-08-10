#!/usr/bin/env node
/**
 * Cluster failed buyer-scenario turns from a runs/<stamp>/ directory.
 * Emits teach-candidate JSONL stubs (intent_kind from routing_bind.top_kind).
 *
 *   node scripts/cluster-scenario-fails.mjs scenarios/runs/<stamp>
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const runDir = process.argv[2];
if (!runDir || !existsSync(runDir)) {
  console.error('Usage: node scripts/cluster-scenario-fails.mjs scenarios/runs/<stamp>');
  process.exit(1);
}

const files = readdirSync(runDir).filter((f) => f.endsWith('.json') && f !== 'summary.json');
const fails = [];

for (const f of files) {
  const rec = JSON.parse(readFileSync(join(runDir, f), 'utf8'));
  if (rec.ok) continue;
  for (const t of rec.turns ?? []) {
    if (t.pass !== false) continue;
    const bind = t.debug?.extract_provenance?.routing_bind ?? {};
    fails.push({
      scenario: rec.id,
      turn: t.index,
      text: t.buyer,
      goal: t.debug?.goal?.kind,
      topic: t.debug?.goal?.topic,
      phase: t.debug?.phase,
      top_kind: bind.top_kind ?? null,
      top_score: bind.top_score ?? null,
      miss_reason: bind.miss_reason ?? null,
      failures: t.failures ?? [],
      reply_excerpt: String(t.reply ?? '').slice(0, 120),
    });
  }
}

const byKind = new Map();
for (const f of fails) {
  const k = f.top_kind || '(none)';
  if (!byKind.has(k)) byKind.set(k, []);
  byKind.get(k).push(f);
}

console.log(`\nFail turns: ${fails.length} across ${new Set(fails.map((f) => f.scenario)).size} scenarios\n`);
for (const [k, rows] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`══ ${k} (${rows.length})`);
  for (const r of rows.slice(0, 8)) {
    console.log(`  ${r.scenario} t${r.turn}  goal=${r.goal}/${r.topic ?? '-'}  phase=${r.phase}`);
    console.log(`    «${r.text}»`);
    console.log(`    → ${r.reply_excerpt.replace(/\n/g, ' ')}`);
  }
  if (rows.length > 8) console.log(`  … +${rows.length - 8} more`);
  console.log('');
}

const outDir = join(runDir, 'fail-cluster');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'fails.json'), JSON.stringify(fails, null, 2));

// Teach stubs: open-phrasing fails where bind was wrong/abstain — human picks target kind.
const teach = fails
  .filter((f) => f.text && f.text.length < 120)
  .map((f, i) => ({
    id: `cluster_${basename(runDir).slice(0, 10)}_${i}`,
    text: f.text,
    metadata: {
      intent_kind: f.top_kind && !['get_brochure', 'get_project_info', 'find_projects'].includes(f.top_kind)
        ? f.top_kind
        : 'NEED_LABEL',
      is_negative: false,
      language: /[\u0900-\u097F]/.test(f.text) || /\b(?:karna|dono|kitna|bhejo|dikhao|se)\b/i.test(f.text)
        ? 'hi-en'
        : 'en',
      source: `scenario_fail_${f.scenario}`,
      suggested_fix:
        f.goal === 'answer' && /visit|same day|split|origin|coming from/i.test(f.failures.join(' '))
          ? 'visit_*'
          : f.topic === 'overview' && /compare|side-by-side/i.test(f.failures.join(' '))
            ? 'compare_projects'
            : 'NEED_LABEL',
      observed_bind: f.top_kind,
      observed_goal: f.goal,
    },
  }));
writeFileSync(join(outDir, 'teach-stubs.jsonl'), teach.map((x) => JSON.stringify(x)).join('\n') + '\n');
console.log(`Wrote ${outDir}/fails.json + teach-stubs.jsonl (${teach.length} stubs)`);
