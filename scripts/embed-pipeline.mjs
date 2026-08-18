#!/usr/bin/env node
/**
 * embed-pipeline — the one door for operating the embedding system.
 *
 *   node scripts/embed-pipeline.mjs status    --env dev|prod
 *   node scripts/embed-pipeline.mjs fill      --env dev|prod [--dry-run]
 *   node scripts/embed-pipeline.mjs verify    --env dev|prod [--out report.html]
 *   node scripts/embed-pipeline.mjs calibrate --env dev|prod [--set extra.jsonl]
 *   node scripts/embed-pipeline.mjs try       --env dev|prod "any buyer text"
 *
 * Why this exists: vectors are not migrations. A D1 migration is a diff the
 * repo can prove; an embedding index lives OUTSIDE the repo, is eventually
 * consistent (counts lag writes), and its scores are lossy per index — a tau
 * proven on dev is unproven on prod until probed there. So every environment
 * gets the same four moves: fill via the workers' own rebuild routes, verify
 * with a graded golden battery, calibrate taus against live scores, and `try`
 * a single phrase the way the teach loop does.
 *
 * Config truth: index names and SIL vars are parsed from wrangler.toml — the
 * script carries no copy that can drift. Secrets come from the environment
 * (BOT_SHARED_SECRET_DEV / BOT_SHARED_SECRET_PROD, CLOUDFLARE_API_TOKEN) and
 * are never printed.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || 'a24378cdba77c1d03c3115651bb9cd11';

// Desk owns the locations index; its name lives in NayaDesk's wrangler.toml
// ([env.*] LOCATION_VECTORS). Kept here as the one cross-repo constant — a
// wrong value fails loudly in `status` as index-not-found, never silently.
const LOCATION_INDEX = { dev: 'naya-locations-m3-dev', prod: 'naya-locations-m3' };

const WORKERS = {
  dev: {
    spine: 'https://converse-spine-dev.nagarjun-arjun.workers.dev',
    desk: 'https://nayadesk-dev.nagarjun-arjun.workers.dev',
    secretVar: 'BOT_SHARED_SECRET_DEV',
  },
  prod: {
    spine: 'https://converse-spine.nagarjun-arjun.workers.dev',
    desk: 'https://nayadesk-prod.nagarjun-arjun.workers.dev',
    secretVar: 'BOT_SHARED_SECRET_PROD',
  },
};

// ── config from the repo, not from this script ─────────────────────────────

/** Minimal TOML walk: enough for [env.X.vars] keys and [[env.X.vectorize]]
 *  binding→index_name pairs. Anything fancier belongs in a real parser. */
function parseWranglerEnv(envName) {
  const toml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
  const vars = {};
  const indexes = {};
  let section = '';
  let binding = '';
  for (const raw of toml.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const sec = line.match(/^\[+([^\]]+)\]+$/);
    if (sec) { section = sec[1]; binding = ''; continue; }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"$/);
    if (!kv) continue;
    if (section === `env.${envName}.vars`) vars[kv[1]] = kv[2];
    if (section === `env.${envName}.vectorize`) {
      if (kv[1] === 'binding') binding = kv[2];
      if (kv[1] === 'index_name' && binding) indexes[binding] = kv[2];
    }
  }
  return { vars, indexes };
}

/** Shipped taus, read from the source the worker actually bundles. */
function shippedTaus() {
  const src = readFileSync(join(ROOT, 'src/nlu/intent-projection-matrix.ts'), 'utf8');
  const num = (name) => {
    const m = src.match(new RegExp(`${name}\\s*=\\s*([0-9.]+)`));
    return m ? Number(m[1]) : undefined;
  };
  return { tau: num('PROJECTION_TAU'), tauLow: num('PROJECTION_TAU_LOW') };
}

function envConfig(envName) {
  if (!WORKERS[envName]) die(`unknown --env "${envName}" (dev|prod)`);
  const { vars, indexes } = parseWranglerEnv(envName);
  return {
    name: envName,
    ...WORKERS[envName],
    model: vars.SIL_EMBED_MODEL,
    projection: vars.SIL_INTENT_PROJECTION,
    embedFirst: vars.SIL_EMBED_FIRST === 'true',
    indexes: {
      intent: vars.SIL_INTENT_INDEX ?? indexes.INTENT_VECTORS,
      names: indexes.PROJECT_VECTORS,
      education: indexes.EDUCATION_VECTORS,
      locations: LOCATION_INDEX[envName],
    },
    ...shippedTaus(),
  };
}

function secretFor(cfg) {
  const s = process.env[cfg.secretVar] || process.env.BOT_SHARED_SECRET;
  if (!s) die(`missing ${cfg.secretVar} (or BOT_SHARED_SECRET) in the environment`);
  return s;
}

// ── plumbing ───────────────────────────────────────────────────────────────

function die(msg) { console.error(`embed-pipeline: ${msg}`); process.exit(2); }

async function http(method, url, { headers = {}, body, timeoutMs = 120_000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: ctl.signal,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
    return { status: res.status, json };
  } finally { clearTimeout(t); }
}

/** Vectorize REST (read paths only). Falls back to wrangler for `info` when no
 *  API token is present, so `status` works on a laptop with only wrangler auth. */
async function vectorizeInfo(indexName) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (token) {
    const { status, json } = await http(
      'GET',
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/vectorize/v2/indexes/${indexName}/info`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (status === 200 && json.result) return json.result;
    return { error: `HTTP ${status}${json?.errors?.[0]?.message ? `: ${json.errors[0].message}` : ''}` };
  }
  try {
    const out = execFileSync('npx', ['wrangler', 'vectorize', 'info', indexName], {
      cwd: ROOT, encoding: 'utf8', timeout: 60_000,
    });
    const m = out.match(/│\s*(\d+)\s*│\s*(\d+)\s*│\s*[0-9a-f-]+\s*│\s*(\S+)\s*│/);
    return m ? { dimensions: Number(m[1]), vectorCount: Number(m[2]), processedUpToDatetime: m[3] } : { error: 'unparsed wrangler output' };
  } catch (e) { return { error: String(e.message || e).split('\n')[0] }; }
}

async function vectorizeQuery(indexName, vector, topK = 3) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) return { error: 'CLOUDFLARE_API_TOKEN required for index queries' };
  const { status, json } = await http(
    'POST',
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/vectorize/v2/indexes/${indexName}/query`,
    { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, body: { vector, topK, returnMetadata: 'all' } },
  );
  if (status === 200 && json.result) return json.result;
  return { error: `HTTP ${status}${json?.errors?.[0]?.message ? `: ${json.errors[0].message}` : ''}` };
}

function decodeVector(b64) {
  const buf = Buffer.from(b64, 'base64');
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
}

async function probe(cfg, secret, items) {
  const out = [];
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50);
    const { status, json } = await http('POST', `${cfg.spine}/api/sil/probe`, {
      headers: { 'x-bot-secret': secret },
      body: { items: batch.map(({ text, expected }) => ({ text, ...(expected ? { expected } : {}) })) },
    });
    if (status !== 200) die(`probe ${cfg.name} HTTP ${status} — is the deployed worker on a build with the secret-gated probe?`);
    out.push(...json.results);
  }
  return out;
}

async function embedTexts(cfg, secret, texts) {
  const { status, json } = await http('POST', `${cfg.spine}/api/sil/embed`, {
    headers: { 'x-bot-secret': secret },
    body: { texts },
  });
  if (status !== 200) die(`embed ${cfg.name} HTTP ${status}`);
  if (!json.dims) die(`embed ${cfg.name} returned no vectors (AI binding missing?)`);
  return json.vectors.map(decodeVector);
}

function loadGolden() {
  return JSON.parse(readFileSync(join(ROOT, 'scripts/embed-pipeline/golden.json'), 'utf8'));
}

// ── status ─────────────────────────────────────────────────────────────────

async function cmdStatus(cfg) {
  console.log(`env=${cfg.name}  model=${cfg.model}  projection=${cfg.projection ?? '—'}  embed_first=${cfg.embedFirst}`);
  console.log(`taus (shipped): bind=${cfg.tau}  gap_fill=${cfg.tauLow}`);
  for (const [lane, index] of Object.entries(cfg.indexes)) {
    if (!index) { console.log(`  ${lane.padEnd(10)} — no index bound`); continue; }
    const info = await vectorizeInfo(index);
    if (info.error) console.log(`  ${lane.padEnd(10)} ${index}  ERROR ${info.error}`);
    else console.log(`  ${lane.padEnd(10)} ${index}  dims=${info.dimensions}  vectors=${info.vectorCount}  processed=${info.processedUpToDatetime}`);
  }
}

// ── fill ───────────────────────────────────────────────────────────────────

async function cmdFill(cfg, { dryRun }) {
  const secret = secretFor(cfg);
  const q = dryRun ? '?dry_run=1' : '';
  console.log(`fill ${cfg.name}${dryRun ? ' (dry run)' : ''} — the workers embed and write; this only knocks.`);

  const intent = await http('POST', `${cfg.spine}/internal/intent-rebuild${q}`, {
    headers: { 'x-bot-secret': secret }, body: {}, timeoutMs: 300_000 });
  console.log(`  intent-rebuild     HTTP ${intent.status} ${JSON.stringify(intent.json.report ?? intent.json).slice(0, 200)}`);

  const edu = await http('POST', `${cfg.spine}/internal/education-rebuild`, {
    headers: { 'x-bot-secret': secret }, body: {}, timeoutMs: 300_000 });
  console.log(`  education-rebuild  HTTP ${edu.status} ${JSON.stringify(edu.json.report ?? edu.json).slice(0, 200)}`);

  if (!dryRun) {
    const names = await http('POST', `${cfg.desk}/api/projects/reconcile-project-vectors`, {
      headers: { 'x-bot-secret': secret }, body: {}, timeoutMs: 300_000 });
    console.log(`  desk-reconcile     HTTP ${names.status} ${JSON.stringify(names.json).slice(0, 200)}`);
  } else {
    console.log('  desk-reconcile     skipped (no dry-run seam on the Desk route)');
  }
  console.log('note: Vectorize is eventually consistent — run `status` after a minute, then `verify`.');
}

// ── verify ─────────────────────────────────────────────────────────────────

function gradeIntent(rows, results, tau) {
  const graded = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const r = results[i];
    const top = r.top_kind ?? '';
    const score = r.top_score ?? 0;
    const bound = score >= tau && !!top;
    let ok;
    if (row.must_not_bind) ok = !bound;
    else ok = top === row.expect_kind;
    graded.push({ ...row, got: top, score, bound, ok, miss: r.miss_reason ?? '' });
  }
  const positives = graded.filter((g) => !g.must_not_bind);
  const negatives = graded.filter((g) => g.must_not_bind);
  const boundPos = positives.filter((g) => g.bound);
  return {
    graded,
    top1: positives.length ? positives.filter((g) => g.ok).length / positives.length : 1,
    coverage: positives.length ? boundPos.length / positives.length : 0,
    precision: boundPos.length ? boundPos.filter((g) => g.got === g.expect_kind).length / boundPos.length : 1,
    wrongBinds: negatives.filter((g) => !g.ok).length,
    counts: { positives: positives.length, negatives: negatives.length, bound: boundPos.length },
  };
}

async function gradeVectorLane(cfg, secret, rows, index, threshold, idField) {
  if (!rows?.length) return { graded: [], ok: 0, total: 0, skipped: 'no rows for this env' };
  if (!process.env.CLOUDFLARE_API_TOKEN) return { graded: [], ok: 0, total: 0, skipped: 'CLOUDFLARE_API_TOKEN not set — index-query lanes need it' };
  const vecs = await embedTexts(cfg, secret, rows.map((r) => r.text));
  const graded = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const res = await vectorizeQuery(index, vecs[i], 3);
    if (res.error) { graded.push({ ...row, ok: false, note: res.error }); continue; }
    const top = res.matches?.[0];
    const got = top?.metadata?.[idField] ?? top?.id ?? '';
    const score = top?.score ?? 0;
    const bound = score >= threshold;
    const ok = row.must_not_bind ? !bound : bound && got === row.expect_id;
    graded.push({ ...row, got, score: Number(score.toFixed(4)), ok });
  }
  return { graded, ok: graded.filter((g) => g.ok).length, total: graded.length };
}

async function cmdVerify(cfg, { out }) {
  const secret = secretFor(cfg);
  const golden = loadGolden();
  const gates = golden.gates;
  const started = new Date().toISOString();

  // Lane 1 — intent, through the engine's own embedderRouting.
  const intentRows = golden.intent;
  const intentResults = await probe(cfg, secret, intentRows.map((r) => ({ text: r.text, expected: r.expect_kind })));
  const intent = gradeIntent(intentRows, intentResults, cfg.tau);

  // Lanes 2–4 — raw-space nearest-neighbour, same embedder the workers use.
  const perEnv = golden[cfg.name] ?? {};
  const names = await gradeVectorLane(cfg, secret, perEnv.names, cfg.indexes.names, golden.thresholds.names, 'project_id');
  const locations = await gradeVectorLane(cfg, secret, perEnv.locations, cfg.indexes.locations, golden.thresholds.locations, 'area_id');
  const education = await gradeVectorLane(cfg, secret, perEnv.education, cfg.indexes.education, golden.thresholds.education, 'entry_id');

  // Counts — ids present in each index right now.
  const counts = {};
  for (const [lane, index] of Object.entries(cfg.indexes)) {
    counts[lane] = index ? await vectorizeInfo(index) : { error: 'unbound' };
  }

  const breaches = [];
  if (intent.top1 < gates.intent_top1) breaches.push(`intent top-1 ${(intent.top1 * 100).toFixed(1)}% < gate ${gates.intent_top1 * 100}%`);
  if (intent.precision < gates.intent_precision_at_tau) breaches.push(`intent precision@tau ${(intent.precision * 100).toFixed(1)}% < gate ${gates.intent_precision_at_tau * 100}%`);
  if (intent.wrongBinds > gates.intent_wrong_binds) breaches.push(`${intent.wrongBinds} wrong bind(s) on must-not-bind rows (gate: ${gates.intent_wrong_binds})`);
  for (const [lane, res] of [['names', names], ['locations', locations], ['education', education]]) {
    if (!res.skipped && res.total && res.ok < res.total) breaches.push(`${lane}: ${res.ok}/${res.total} rows passed`);
  }

  const report = { env: cfg.name, started, model: cfg.model, projection: cfg.projection, tau: cfg.tau, tauLow: cfg.tauLow, intent, names, locations, education, counts, breaches };
  const jsonPath = join(ROOT, `docs/reports/embed-verify-${cfg.name}.json`);
  const htmlPath = out ?? join(ROOT, `docs/reports/embed-verify-${cfg.name}.html`);
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(htmlPath, renderReport(report));

  console.log(`verify ${cfg.name} — intent top-1 ${(intent.top1 * 100).toFixed(1)}% (${intent.graded.filter((g) => !g.must_not_bind && g.ok).length} of ${intent.counts.positives}), precision@tau ${(intent.precision * 100).toFixed(1)}%, coverage ${(intent.coverage * 100).toFixed(1)}%, wrong binds ${intent.wrongBinds}`);
  for (const [lane, res] of [['names', names], ['locations', locations], ['education', education]]) {
    console.log(`  ${lane.padEnd(10)} ${res.skipped ? `skipped — ${res.skipped}` : `${res.ok}/${res.total}`}`);
  }
  console.log(`  report: ${htmlPath}`);
  if (breaches.length) {
    console.error(`GATE BREACH:\n  - ${breaches.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('all gates green');
}

// ── calibrate ──────────────────────────────────────────────────────────────

async function cmdCalibrate(cfg, { set }) {
  const secret = secretFor(cfg);
  const golden = loadGolden();
  let rows = golden.intent.filter((r) => !r.must_not_bind);
  if (set) {
    const extra = readFileSync(resolve(set), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    rows = rows.concat(extra.map((r) => ({ text: r.text ?? r.phrasing, expect_kind: r.expected ?? r.intent_kind })));
  }
  console.log(`calibrate ${cfg.name} — probing ${rows.length} graded rows (add --set holdout.jsonl for a real curve; 30 rows is a smoke check, not a calibration)`);
  const results = await probe(cfg, secret, rows.map((r) => ({ text: r.text, expected: r.expect_kind })));
  const scored = results.filter((r) => r.top_score !== undefined);
  console.log(`\n  tau     coverage           precision`);
  for (let tau = 0.80; tau <= 0.951; tau += 0.005) {
    const bound = scored.filter((r) => r.top_score >= tau);
    const correct = bound.filter((r) => r.top_kind === r.expected);
    const cov = bound.length / rows.length;
    const prec = bound.length ? correct.length / bound.length : 1;
    const mark = Math.abs(tau - cfg.tau) < 0.0026 ? '  ← shipped bind tau' : Math.abs(tau - cfg.tauLow) < 0.0026 ? '  ← shipped gap-fill tau' : '';
    console.log(`  ${tau.toFixed(3)}   ${(cov * 100).toFixed(1).padStart(5)}% (${String(bound.length).padStart(4)} rows)   ${(prec * 100).toFixed(1).padStart(5)}%${mark}`);
  }
  console.log(`\nshipped: bind=${cfg.tau} gap_fill=${cfg.tauLow}. If precision at the shipped bind tau is far from the dev-calibrated 98.3%, the spaces disagree — recalibrate before trusting binds on this env.`);
}

// ── try ────────────────────────────────────────────────────────────────────

async function cmdTry(cfg, text) {
  if (!text) die('try needs a phrase: embed-pipeline try --env dev "2bhk near hennur"');
  const secret = secretFor(cfg);
  const [r] = await probe(cfg, secret, [{ text }]);
  const score = r.top_score ?? 0;
  const verdict = score >= cfg.tau ? 'BINDS (hard verdict)' : score >= cfg.tauLow ? 'gap-fill only (topic hint when regex found nothing)' : 'no bind — the bot falls back to its ladder';
  console.log(`"${text}" on ${cfg.name}`);
  console.log(`  top intent: ${r.top_kind ?? '—'}  score=${score.toFixed(4)}  margin=${r.margin?.toFixed(4) ?? '—'}`);
  console.log(`  verdict at shipped taus (${cfg.tau}/${cfg.tauLow}): ${verdict}`);
  if (r.miss_reason) console.log(`  miss_reason: ${r.miss_reason}`);
  for (const m of r.top_matches ?? []) console.log(`    ${m.kind.padEnd(24)} ${m.score.toFixed(4)}`);
}

// ── report ─────────────────────────────────────────────────────────────────

function renderReport(rep) {
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const laneRows = (name, res) => {
    if (res.skipped) return `<tr><td>${name}</td><td colspan="3" class="muted">skipped — ${res.skipped}</td></tr>`;
    return res.graded.map((g) => `<tr class="${g.ok ? 'ok' : 'bad'}"><td>${name}</td><td>${esc(g.text)}</td><td>${esc(String(g.got ?? ''))} @ ${g.score ?? ''}</td><td>${g.ok ? 'pass' : 'FAIL'}${g.note ? ` — ${esc(g.note)}` : ''}</td></tr>`).join('');
  };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const intentRows = rep.intent.graded.map((g) => `<tr class="${g.ok ? 'ok' : 'bad'}"><td>intent</td><td>${esc(g.text)}</td><td>${esc(g.got || '—')} @ ${g.score.toFixed(3)}${g.must_not_bind ? ' (must not bind)' : ` want ${esc(g.expect_kind)}`}</td><td>${g.ok ? 'pass' : 'FAIL'}</td></tr>`).join('');
  const countRows = Object.entries(rep.counts).map(([lane, c]) => `<tr><td>${lane}</td><td>${c.error ? `ERROR ${esc(c.error)}` : `${c.vectorCount} vectors · ${c.dimensions}d · processed ${esc(c.processedUpToDatetime ?? '')}`}</td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>embed verify — ${rep.env}</title>
<style>
body{font:14px/1.5 -apple-system,system-ui,sans-serif;margin:2rem auto;max-width:70rem;padding:0 1rem;color:#1a1c1e;background:#fafaf8}
h1{font-size:1.4rem} .kpis{display:flex;gap:1rem;flex-wrap:wrap;margin:1rem 0}
.kpi{border:1px solid #d8d6d0;border-radius:6px;padding:.6rem 1rem;background:#fff}
.kpi b{display:block;font-size:1.3rem;font-variant-numeric:tabular-nums}
table{border-collapse:collapse;width:100%;margin:1rem 0;background:#fff}
td,th{border:1px solid #e2e0da;padding:.35rem .6rem;text-align:left;font-size:.85rem}
tr.ok td:last-child{color:#1b7a3d} tr.bad td{background:#fdf0ef} tr.bad td:last-child{color:#b3261e;font-weight:600}
.muted{color:#777} .breach{background:#fdf0ef;border:1px solid #e8b4b0;border-radius:6px;padding:.8rem 1rem;color:#8c1d18}
.green{background:#eef7f0;border:1px solid #bcd9c4;border-radius:6px;padding:.8rem 1rem;color:#1b5e30}
</style>
<h1>Embedding verify — ${rep.env}</h1>
<p class="muted">${rep.started} · model ${rep.model} · projection ${rep.projection ?? '—'} · taus ${rep.tau}/${rep.tauLow}</p>
${rep.breaches.length ? `<div class="breach"><b>Gate breach</b><br>${rep.breaches.map(esc).join('<br>')}</div>` : '<div class="green"><b>All gates green.</b> Every lane answered the battery the way the shipped config promises.</div>'}
<div class="kpis">
<div class="kpi"><b>${pct(rep.intent.top1)}</b>intent top-1 (${rep.intent.graded.filter((g) => !g.must_not_bind && g.ok).length} of ${rep.intent.counts.positives} right)</div>
<div class="kpi"><b>${pct(rep.intent.precision)}</b>precision at bind tau (${rep.intent.counts.bound} rows bound)</div>
<div class="kpi"><b>${pct(rep.intent.coverage)}</b>coverage at bind tau</div>
<div class="kpi"><b>${rep.intent.wrongBinds}</b>wrong binds on traps</div>
</div>
<h2>Index counts</h2><table>${countRows}</table>
<h2>Every graded row</h2>
<table><tr><th>lane</th><th>we asked</th><th>the system answered</th><th>grade</th></tr>
${intentRows}${laneRows('names', rep.names)}${laneRows('locations', rep.locations)}${laneRows('education', rep.education)}</table>`;
}

// ── main ───────────────────────────────────────────────────────────────────

const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--env') flags.env = rest[++i];
  else if (rest[i] === '--out') flags.out = rest[++i];
  else if (rest[i] === '--set') flags.set = rest[++i];
  else if (rest[i] === '--dry-run') flags.dryRun = true;
  else positional.push(rest[i]);
}
if (!cmd || !['status', 'fill', 'verify', 'calibrate', 'try'].includes(cmd)) {
  die('usage: embed-pipeline.mjs <status|fill|verify|calibrate|try> --env dev|prod');
}
const cfg = envConfig(flags.env ?? 'dev');
if (cmd === 'status') await cmdStatus(cfg);
if (cmd === 'fill') await cmdFill(cfg, flags);
if (cmd === 'verify') await cmdVerify(cfg, flags);
if (cmd === 'calibrate') await cmdCalibrate(cfg, flags);
if (cmd === 'try') await cmdTry(cfg, positional.join(' '));
