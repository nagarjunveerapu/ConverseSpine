/**
 * Phase 0d-3 — live truth re-score of veto-class texts on dig.
 *
 *   node --import tsx scripts/probe-0d-veto-rescore.mjs
 *
 * Reads docs/reports/phase-0d-veto-class.jsonl (unique ∩ isFocusedSearchPivot).
 * Offline-labels each text as pivot vs answer via constraint delta heuristics,
 * then focuses Eldorado and truth-grades the dig reply.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  detectTopics,
  detectPropertyTypes,
  extractLocation,
  normalizeConfig,
  parseBudgetToInr,
} from '../src/engine/facts.ts';
import { answerRequirements } from '../src/engine/answer-contract.ts';
import { isImplausibleLocationCapture } from '../src/engine/turn-intent/pivot-arbiter.ts';

const BASE = (process.env.CONVERSE_SPINE_URL ??
  'https://converse-spine-dev.nagarjun-arjun.workers.dev').replace(/\/+$/, '');
const BUILDER = process.env.BUILDER_ID ?? 'naya-advisor';
const VETO_PATH = process.env.VETO_PATH ?? 'docs/reports/phase-0d-veto-class.jsonl';
const LIMIT = Number(process.env.VETO_LIMIT ?? 0) || 0; // 0 = all
const FOCUS = 'Tell me about Brigade Eldorado';

const BRIEF = {
  purpose: 'self_use',
  budget: '₹50–70L',
  bhk: '2 BHK',
  location: 'Aerospace Park / Devanahalli Corridor',
  property_type: 'Apartment',
};

const SHORTLIST_RE =
  /here'?s what fits|catalog searched|3 matches|matches for your brief/i;
const UNKNOWN_RE = /not sure what you'd like help with/i;
const ELDORADO_PIN = /from ₹57\.5\s*l(?!.*cornerstone)/i;

function offlineLabel(text) {
  const t = text.trim();
  // Deterministic facet / FactKey ask → answer-on-focus, even if regex pivot fired historically
  if (answerRequirements(t).length > 0 || detectTopics(t).length > 0) {
    return { kind: 'answer', reasons: ['facet_or_factkey'] };
  }

  const rawLoc = extractLocation(t);
  const loc =
    rawLoc && !isImplausibleLocationCapture(rawLoc, t) ? rawLoc : undefined;
  const budget = parseBudgetToInr(t);
  const ptype = detectPropertyTypes(t);
  const bhk = normalizeConfig(t) ?? (/\b(\d(?:\.\d)?\s*bhk)\b/i.exec(t)?.[1] ?? null);
  const namedOther =
    /\b(?:orchards|cornerstone|sanctuary|meadows|utopia|buena\s*vista|ayana|atmosphere|oasis)\b/i.test(
      t,
    ) && !/\beldorado\b/i.test(t);
  const exploreMore = /\b(?:show\s+me\s+more|other\s+projects|more\s+options)\b/i.test(t);

  const prior = {
    location: BRIEF.location,
    budgetMaxInr: 7_000_000,
    bhk: '2 BHK',
    propertyType: 'Apartment',
  };

  let pivot = false;
  const reasons = [];
  if (
    loc &&
    loc.toLowerCase() !== prior.location.toLowerCase() &&
    !/aerospace|devanahalli/i.test(loc)
  ) {
    pivot = true;
    reasons.push(`loc:${loc}`);
  }
  if (budget && budget.max !== prior.budgetMaxInr) {
    pivot = true;
    reasons.push(`budget:${budget.max}`);
  }
  if (bhk) {
    const norm = String(bhk).replace(/\s+/g, ' ').replace(/\bbhk\b/i, 'BHK');
    if (norm.toLowerCase() !== '2 bhk') {
      pivot = true;
      reasons.push(`bhk:${norm}`);
    }
  }
  if (ptype && ptype !== prior.propertyType) {
    pivot = true;
    reasons.push(`ptype:${ptype}`);
  }
  if (namedOther || exploreMore) {
    pivot = true;
    reasons.push(namedOther ? 'named_other' : 'explore_more');
  }
  if (/^brigade\s+\w+/i.test(t) && !/\beldorado\b/i.test(t)) {
    pivot = true;
    reasons.push('project_switch');
  }
  // Short junk / single-word chips that regex pivoted historically but have no constraint
  if (!pivot && reasons.length === 0 && t.split(/\s+/).length <= 2) {
    return { kind: 'answer', reasons: ['short_utterance'] };
  }
  return { kind: pivot ? 'pivot' : 'answer', reasons };
}

async function turn(sessionId, text, preferences) {
  const r = await fetch(`${BASE}/api/advisor/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      builder_id: BUILDER,
      session_id: sessionId,
      text,
      ...(preferences ? { preferences } : {}),
    }),
  });
  return r.json();
}

function replyOf(j) {
  return String(j?.reply ?? '');
}
function phaseOf(j) {
  return j?.phase ?? j?.debug?.phase ?? '?';
}
function goalOf(j) {
  return j?.debug?.goal?.kind ?? '?';
}

function gradeAnswer(reply, phase) {
  const fails = [];
  if (UNKNOWN_RE.test(reply)) fails.push('unknown_clarify');
  // Answer class must stay on focused project — shortlist dump is the cliff
  if (SHORTLIST_RE.test(reply) || phase === 'discover') {
    fails.push('released_to_shortlist');
  }
  if (reply.trim().length < 12) fails.push('empty');
  return fails;
}

function gradePivot(reply, phase, text) {
  const fails = [];
  if (UNKNOWN_RE.test(reply)) fails.push('unknown_clarify');
  // Classic miss: stay focused and quote Eldorado pin price while ignoring new budget/area
  if (
    phase === 'focused' &&
    ELDORADO_PIN.test(reply) &&
    /budget|lakh|jayanagar|whitefield|mumbai|sarjapur|koramangala/i.test(text)
  ) {
    fails.push('eldorado_pin_ignore_constraint');
  }
  // Must acknowledge the new constraint somehow OR search/no_fit/recommend
  const loc = extractLocation(text);
  const budget = parseBudgetToInr(text);
  if (
    loc &&
    !new RegExp(loc.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(reply) &&
    !/don'?t have|no .*in|nothing in|outside|elsewhere|match|project|here'?s what|₹/i.test(reply)
  ) {
    fails.push('loc_not_reflected');
  }
  if (budget && !/₹|lakh|budget|fit|match|under|stretch|don'?t|no |here'?s what/i.test(reply)) {
    fails.push('budget_not_reflected');
  }
  if (reply.trim().length < 12) fails.push('empty');
  return fails;
}

async function runOne(row, idx, total) {
  const label = offlineLabel(row.buyer_text);
  const sid = `0d-veto-${Date.now()}-${idx}`;
  await turn(sid, 'hi', BRIEF);
  await turn(sid, FOCUS);
  const json = await turn(sid, row.buyer_text);
  const reply = replyOf(json);
  const phase = phaseOf(json);
  const goal = goalOf(json);
  const fails =
    label.kind === 'pivot'
      ? gradePivot(reply, phase, row.buyer_text)
      : gradeAnswer(reply, phase);
  const ok = fails.length === 0;
  console.log(
    `\n[${idx + 1}/${total}] ${ok ? 'PASS' : 'FAIL'}  ${label.kind}  intent=${row.sil_intent}  ${label.reasons.join(',') || '-'}`,
  );
  console.log(`  ask: ${row.buyer_text.slice(0, 100)}`);
  console.log(`  phase=${phase} goal=${goal}`);
  console.log(`  reply: ${reply.slice(0, 180).replace(/\n/g, ' ')}`);
  if (fails.length) console.log(`  fails: ${fails.join(', ')}`);
  return {
    ok,
    kind: label.kind,
    reasons: label.reasons,
    ask: row.buyer_text,
    sil_intent: row.sil_intent,
    sil_score: row.sil_score,
    phase,
    goal,
    reply: reply.slice(0, 400),
    fails,
  };
}

async function main() {
  const lines = readFileSync(VETO_PATH, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const rows = LIMIT > 0 ? lines.slice(0, LIMIT) : lines;
  console.log(`0d veto re-score → ${BASE}`);
  console.log(`texts: ${rows.length} from ${VETO_PATH}`);
  console.log(`started ${new Date().toISOString()}`);

  const results = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      results.push(await runOne(rows[i], i, rows.length));
    } catch (e) {
      console.log(`\n[${i + 1}/${rows.length}] FAIL  exception — ${e?.message || e}`);
      results.push({ ok: false, kind: '?', ask: rows[i].buyer_text, fails: ['exception'], err: String(e?.message || e) });
    }
  }

  const pass = results.filter((r) => r.ok).length;
  const byKind = {};
  for (const r of results) {
    byKind[r.kind] ??= { pass: 0, total: 0 };
    byKind[r.kind].total += 1;
    if (r.ok) byKind[r.kind].pass += 1;
  }
  console.log('\n======== SUMMARY ========');
  for (const [k, v] of Object.entries(byKind)) console.log(`${k}: ${v.pass}/${v.total}`);
  console.log(`TOTAL: ${pass}/${results.length}`);
  const fails = results.filter((r) => !r.ok);
  if (fails.length) {
    console.log('FAILED samples:');
    for (const f of fails.slice(0, 25)) {
      console.log(`  - [${f.kind}] ${f.ask.slice(0, 70)} → ${f.fails?.join(',')}`);
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    base: BASE,
    source: VETO_PATH,
    n: results.length,
    pass,
    by_kind: byKind,
    results,
  };
  writeFileSync('docs/reports/phase-0d-veto-rescore.json', JSON.stringify(report, null, 2));
  console.log('wrote docs/reports/phase-0d-veto-rescore.json');
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
