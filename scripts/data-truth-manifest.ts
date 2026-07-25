#!/usr/bin/env npx tsx
/**
 * Data-truth manifest — what the bot CAN legitimately answer, per project.
 *
 * Why this exists: without it, a failing scenario is unreadable. "I don't have
 * rental yield on file" is either correct behaviour (no row) or a lie (row
 * exists, engine could not reach it) — and those need opposite fixes. Guessing
 * which cost this project a wrong diagnosis: three routing bugs were labelled
 * "Desk content gaps" until the DB was actually queried.
 *
 * So expectations are DERIVED from Desk, never assumed:
 *
 *   data present  → the reply must carry the fact, and must NOT say "not on file"
 *   data absent   → the reply must decline honestly, name the project, invent nothing
 *
 * The third column is the lane. Recognition is embed-first: when a fact exists
 * but the engine missed it, the fix is a TAUGHT facet binding (intent_phrasings
 * carries the FAQ question_key on the vector), not a new alias regex.
 *
 *   npx tsx scripts/data-truth-manifest.ts naya-advisor
 *   npx tsx scripts/data-truth-manifest.ts brigade-group lokations
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.NAYA_DB ?? 'naya-db-dev';

function q<T = Record<string, unknown>>(sql: string): T[] {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const start = out.indexOf('[');
  const parsed = JSON.parse(out.slice(start)) as Array<{ results?: T[] }>;
  return parsed[0]?.results ?? [];
}

/** One row per project × fact kind. `has` is Desk truth, not an assumption. */
export interface FactRow {
  projectId: string;
  project: string;
  fact: string;
  has: boolean;
  /** How the engine is expected to reach it — the lane a miss belongs to. */
  via: 'faq' | 'column' | 'cost_sheet' | 'location_intel' | 'units' | 'market_intel';
  /** FAQ question_key as Desk stores it — what a taught facet must bind to. */
  key?: string;
}

function build(builderId: string) {
  const projects = q<{ project_id: string; name: string; rera_number: string | null; khata_type: string | null; ec_status: string | null; loan_eligibility: string | null; possession_date: string | null }>(
    `SELECT project_id, name, rera_number, khata_type, ec_status, loan_eligibility, possession_date
     FROM projects WHERE builder_id='${builderId}' ORDER BY name`,
  );
  const faqs = q<{ project_id: string; question_key: string; alen: number }>(
    `SELECT f.project_id, f.question_key, LENGTH(COALESCE(f.approved_answer,'')) AS alen
     FROM faqs f JOIN projects p ON p.project_id=f.project_id
     WHERE p.builder_id='${builderId}'`,
  );
  const costs = q<{ project_id: string; n: number }>(
    `SELECT c.project_id, COUNT(*) AS n FROM cost_sheet_items c
     JOIN projects p ON p.project_id=c.project_id
     WHERE p.builder_id='${builderId}' GROUP BY c.project_id`,
  );
  const li = q<{ project_id: string }>(
    `SELECT l.project_id FROM location_intelligence l JOIN projects p ON p.project_id=l.project_id
     WHERE p.builder_id='${builderId}'`,
  );
  const units = q<{ project_id: string; n: number }>(
    `SELECT u.project_id, COUNT(*) AS n FROM unit_configs u JOIN projects p ON p.project_id=u.project_id
     WHERE p.builder_id='${builderId}' GROUP BY u.project_id`,
  );

  /** Approved FAQ keys per project — an empty answer is not an answer. */
  const faqByProject = new Map<string, Set<string>>();
  for (const f of faqs) {
    if (!f.alen) continue;
    const s = faqByProject.get(f.project_id) ?? new Set<string>();
    s.add(f.question_key);
    faqByProject.set(f.project_id, s);
  }
  const costSet = new Set(costs.filter((c) => c.n > 0).map((c) => c.project_id));
  const liSet = new Set(li.map((l) => l.project_id));
  const unitSet = new Set(units.filter((u) => u.n > 0).map((u) => u.project_id));

  const rows: FactRow[] = [];
  for (const p of projects) {
    const keys = faqByProject.get(p.project_id) ?? new Set<string>();
    const push = (fact: string, has: boolean, via: FactRow['via'], key?: string) =>
      rows.push({ projectId: p.project_id, project: p.name, fact, has, via, ...(key ? { key } : {}) });

    for (const k of [...keys].sort()) push(`faq:${k}`, true, 'faq', k);
    push('rera', Boolean(p.rera_number?.trim()), 'column');
    push('khata', Boolean(p.khata_type?.trim()), 'column');
    push('ec_status', Boolean(p.ec_status?.trim()), 'column');
    push('loan_eligibility', Boolean(p.loan_eligibility?.trim()), 'column');
    push('possession', Boolean(p.possession_date?.trim()), 'column');
    push('cost_sheet', costSet.has(p.project_id), 'cost_sheet');
    push('location_intel', liSet.has(p.project_id), 'location_intel');
    push('unit_configs', unitSet.has(p.project_id), 'units');
  }
  return { builderId, generatedFor: DB, projects: projects.length, rows };
}

const builders = process.argv.slice(2);
if (!builders.length) {
  console.error('usage: data-truth-manifest.ts <builder_id> [builder_id...]');
  process.exit(1);
}
mkdirSync(join(ROOT, 'scenarios', 'data-truth'), { recursive: true });
for (const b of builders) {
  const m = build(b);
  writeFileSync(join(ROOT, 'scenarios', 'data-truth', `${b}.json`), JSON.stringify(m, null, 2) + '\n');
  const have = m.rows.filter((r) => r.has).length;
  const faqKeys = [...new Set(m.rows.filter((r) => r.via === 'faq').map((r) => r.key!))].sort();
  console.log(`${b}: ${m.projects} projects · ${have}/${m.rows.length} facts present`);
  console.log(`  approved FAQ keys in Desk (${faqKeys.length}): ${faqKeys.join(', ')}`);
}
