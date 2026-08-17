#!/usr/bin/env npx tsx
/**
 * U9 instrument, step 1 — where does the GATE, not the embedder, lose a name?
 *
 * `shouldQueryProjectVectors` decides whether PROJECT_VECTORS is consulted at
 * all. When it refuses, no amount of embedding quality helps: the lane never
 * runs. This walks real buyer utterances from the dev ledger, runs the REAL
 * gate and the REAL lexical lane (both pure, no network), and prints the turns
 * where the two disagree — a name the lexical lane can see, on a turn the gate
 * would not have looked.
 *
 * Those rows are the candidate list for a live check against dev; this script
 * predicts, it does not conclude. Nothing here proves the bot is wrong — only
 * dev can say that, and scripts/u9-live-check.ts asks it.
 *
 *   npx tsx scripts/u9-gate-vs-lexical.ts <catalog.json> <utterances.json> <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { shouldQueryProjectVectors } from '../src/engine/adapters/semantic-nlu.js';
import { extractFactsSync } from '../src/engine/facts.js';
import { initState } from '../src/engine/state.js';
import { buildTrigramIndex, rankSpans, fuseByReciprocalRank, bandFor, BANDS } from '../src/engine/hybrid-identity.js';

const [catalogPath, utterancePath, outPath] = process.argv.slice(2);
const BUILDER = process.env.BUILDER_ID ?? 'naya-advisor';

interface CatalogRow { project_id: string; builder_id: string; name: string }
interface Utterance { content: string; n: number }

const catalog = (JSON.parse(readFileSync(catalogPath, 'utf8')) as CatalogRow[])
  .filter((r) => r.builder_id === BUILDER)
  .map((r) => ({ id: r.project_id, name: r.name }));
const utterances = JSON.parse(readFileSync(utterancePath, 'utf8')) as Utterance[];

const index = buildTrigramIndex(catalog);
console.log(`catalog: ${index.size} projects · utterances: ${utterances.length}\n`);

interface Row {
  text: string;
  occurrences: number;
  gateAllows: boolean;
  lexTop: string | null;
  lexName: string | null;
  lexSimilarity: number;
  band: number;
  action: string;
  margin: number;
  marginBasis: string;
}

const rows: Row[] = [];
for (const u of utterances) {
  const text = u.content;
  // The real gate, with the real regex extract feeding it. `discover` with an
  // empty board is the coldest, most common case a buyer arrives in.
  const state = initState(BUILDER, 'c-probe');
  let gateAllows = false;
  try {
    const ex = extractFactsSync(text, state);
    gateAllows = shouldQueryProjectVectors(text, ex, {
      phase: 'discover',
      microMarkets: [],
      offeredProjectNames: [],
    });
  } catch {
    gateAllows = false;
  }

  const lex = rankSpans(index, text);
  const fused = fuseByReciprocalRank([], lex);
  const v = bandFor(fused, BANDS);

  rows.push({
    text,
    occurrences: u.n,
    gateAllows,
    lexTop: lex[0]?.id ?? null,
    lexName: lex[0]?.name ?? null,
    lexSimilarity: lex[0]?.similarity ?? 0,
    band: v.band,
    action: v.action,
    margin: v.margin,
    marginBasis: v.marginBasis,
  });
}

const allowed = rows.filter((r) => r.gateAllows);
const refused = rows.filter((r) => !r.gateAllows);
const weight = (rs: Row[]) => rs.reduce((a, r) => a + r.occurrences, 0);

console.log(`gate ALLOWS : ${allowed.length.toString().padStart(4)} distinct · ${weight(allowed)} occurrences`);
console.log(`gate REFUSES: ${refused.length.toString().padStart(4)} distinct · ${weight(refused)} occurrences\n`);

// A strong lexical hit on a refused turn is the whole finding: the name is
// visible in the text by pure string overlap, and the lane that could confirm
// it was never consulted. 0.55 is a reporting cut for this listing only — it
// is not a threshold in the shipped code, and the raw number is kept per row.
const SUSPECT = 0.55;
const suspects = refused
  .filter((r) => r.lexSimilarity >= SUSPECT)
  .sort((a, b) => b.occurrences - a.occurrences);

console.log(`REFUSED but lexically strong (>= ${SUSPECT}): ${suspects.length} distinct · ${weight(suspects)} occurrences`);
console.log('  These are the candidates to check against dev.\n');
for (const s of suspects.slice(0, 40)) {
  console.log(
    `  ${String(s.occurrences).padStart(4)}×  ${JSON.stringify(s.text).slice(0, 52).padEnd(54)} → ${s.lexName} (${s.lexSimilarity.toFixed(3)})`,
  );
}

writeFileSync(outPath, JSON.stringify({ builder: BUILDER, catalogSize: index.size, rows }, null, 0));
console.log(`\nwrote ${outPath}`);
