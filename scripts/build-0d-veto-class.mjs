/**
 * Materialize Phase 0d veto class: answer-intent ≥0.78 ∩ isFocusedSearchPivot.
 *
 *   node --import tsx scripts/build-0d-veto-class.mjs \
 *     /tmp/0d-veto-answer-intents.json \
 *     docs/reports/phase-0d-veto-class.jsonl
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isFocusedSearchPivot } from '../src/engine/turn-intent/focused-intent.ts';

const inPath = process.argv[2] ?? '/tmp/0d-veto-answer-intents.json';
const outPath = process.argv[3] ?? 'docs/reports/phase-0d-veto-class.jsonl';

const rows = JSON.parse(readFileSync(inPath, 'utf8'));
const seen = new Set();
const veto = [];

for (const row of rows) {
  const text = String(row.buyer_text ?? '').trim();
  if (!text || seen.has(text.toLowerCase())) continue;
  if (!isFocusedSearchPivot(text)) continue;
  seen.add(text.toLowerCase());
  veto.push({
    buyer_text: text,
    sil_intent: row.sil_intent,
    sil_score: row.sil_score,
  });
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, veto.map((r) => JSON.stringify(r)).join('\n') + (veto.length ? '\n' : ''));
console.log(`answer-intent rows in: ${rows.length}`);
console.log(`veto class (unique ∩ pivot): ${veto.length}`);
console.log(`wrote ${outPath}`);
for (const r of veto.slice(0, 8)) {
  console.log(`  [${r.sil_intent} ${Number(r.sil_score).toFixed(3)}] ${r.buyer_text.slice(0, 80)}`);
}
