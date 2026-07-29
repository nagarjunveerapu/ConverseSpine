#!/usr/bin/env node
/**
 * Parallel dig stress over synthetic intent corpus. Collate-only — no fixes.
 *
 *   node scripts/stress-intent-corpus-probe.mjs \
 *     --corpus corpus/synthetic/intent-stress-50k.jsonl \
 *     --concurrency 40 --limit 50000
 *
 * Scoring (heuristic, for train triage):
 *   - http/timeout/error → fail_http
 *   - unknown clarify when expect.avoid_unknown → fail_unknown
 *   - shortlist dump when expect.hold_focus → fail_focus
 *   - expect_topics non-empty & primary topic mismatch (goal.topic) → fail_topic
 *   - multi expect_topics: reply must hit ≥2 topic cue regexes or fail_multi_atom
 *
 * Writes:
 *   docs/reports/intent-stress-<ts>/results.jsonl
 *   docs/reports/intent-stress-<ts>/report.md
 *   docs/reports/intent-stress-<ts>/fails-for-train.jsonl
 */
import { createReadStream, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
function flag(name, def) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  return args[i + 1] ?? def;
}

const BASE = (process.env.CONVERSE_SPINE_URL ??
  'https://converse-spine-dev.nagarjun-arjun.workers.dev').replace(/\/+$/, '');
const BUILDER = process.env.BUILDER_ID ?? 'naya-advisor';
const CORPUS = resolve(process.cwd(), flag('corpus', 'corpus/synthetic/intent-stress-50k.jsonl'));
const CONCURRENCY = Number(flag('concurrency', '40'));
const LIMIT = Number(flag('limit', '50000'));
const OFFSET = Number(flag('offset', '0'));
const FOCUS_ID = 'brigade-eldorado-naya-advisor';
const FOCUS_NAME = 'Brigade Eldorado';

const BRIEF = {
  purpose: 'self_use',
  budget: '₹50–70L',
  bhk: '2 BHK',
  location: 'Aerospace Park / Devanahalli Corridor',
  property_type: 'Apartment',
};
const ADVISOR_PREFS = {
  ...BRIEF,
  worries: 'Resale value',
  commute_hub: 'Whitefield / ITPL',
  schools: 'important',
};

const UNKNOWN_RE = /not sure what you'?d like help with|rephrase|didn'?t (quite )?catch/i;
const SHORTLIST_RE =
  /here'?s what fits|catalog searched|\d+\s+matches|matches for your brief/i;

/** Topic → reply cue (loose). Multi-atom needs ≥2 hits when expect multi. */
const TOPIC_CUE = {
  price: /₹|lakh|\bl\b|price|cost|psf|per\s*sq|payment|down\s*payment|discount|offer/i,
  legal:
    /rera|khata|title|legal|loan|ltv|bank|hdfc|icici|sbi|axis|oc\b|approval|litigation/i,
  availability:
    /possess|handover|ready|available|inventory|config|bhk|unit|202\d|phase|delivery/i,
  media: /brochure|pdf|floor\s*plan|photo|gallery|media|link|sheet/i,
  amenities: /amenit|club|pool|gym|park|facilit/i,
  location: /location|km|min|commute|school|hospital|whitefield|itpl|connect|near/i,
  overview: /project|builder|overview|highlight|us|track|reputation|appreciat|yield|roi/i,
  emi: /emi|installment|monthly|loan\s*%|interest/i,
  compare: /compar|versus|\bvs\b|trade.?off|difference|better/i,
};

const INTENT_TO_TOPIC = {
  get_price: 'price',
  get_payment_plan: 'price',
  negotiate_price: 'price',
  get_legal_info: 'legal',
  get_availability: 'availability',
  ask_delivery_timeline: 'availability',
  get_brochure: 'media',
  get_media: 'media',
  get_amenities: 'amenities',
  get_location_info: 'location',
  get_project_info: 'overview',
  ask_about_builder: 'overview',
  ask_investment_return: 'overview',
  compute_emi: 'emi',
  compare_projects: 'compare',
};

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT_DIR = resolve(process.cwd(), `docs/reports/intent-stress-${ts}`);
mkdirSync(OUT_DIR, { recursive: true });
const RESULTS = `${OUT_DIR}/results.jsonl`;
const FAILS = `${OUT_DIR}/fails-for-train.jsonl`;
const REPORT = `${OUT_DIR}/report.md`;

writeFileSync(RESULTS, '');
writeFileSync(FAILS, '');

async function loadCorpus() {
  const rows = [];
  const rl = createInterface({ input: createReadStream(CORPUS), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }
  return rows.slice(OFFSET, OFFSET + LIMIT);
}

async function turn(sessionId, text, extras = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/api/advisor/turn`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://naya-advisor-dev.pages.dev',
      },
      body: JSON.stringify({
        builder_id: BUILDER,
        session_id: sessionId,
        text,
        ...extras,
      }),
      signal: ctrl.signal,
    });
    const json = await r.json().catch(() => ({}));
    return { http: r.status, json, ms: Date.now() - t0, err: null };
  } catch (e) {
    return { http: 0, json: {}, ms: Date.now() - t0, err: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function replyOf(json) {
  return String(json?.reply ?? json?.message ?? '');
}

function score(caseRow, http, json, ms, err) {
  const reply = replyOf(json);
  const phase = json?.debug?.phase ?? json?.phase ?? '';
  const goal = json?.debug?.goal ?? {};
  const goalTopic = goal?.topic ?? null;
  const goalKind = goal?.kind ?? null;
  const requires = Array.isArray(goal?.requires) ? goal.requires : [];
  const expect = caseRow.expect || {};
  const expectTopics = expect.expect_topics || caseRow.topics || [];
  const primaryTopic =
    expectTopics[0] || INTENT_TO_TOPIC[caseRow.intent_kind] || null;

  const reasons = [];
  if (err) reasons.push('fail_http');
  else if (http !== 200) reasons.push('fail_http');

  if (expect.avoid_unknown !== false && UNKNOWN_RE.test(reply)) {
    reasons.push('fail_unknown');
  }
  if (expect.hold_focus && SHORTLIST_RE.test(reply)) {
    reasons.push('fail_focus');
  }

  // Topic bind: only grade answer-ish singles/multis with expect topics
  if (primaryTopic && expectTopics.length && !reasons.includes('fail_http')) {
    const topicOk =
      goalTopic === primaryTopic ||
      (TOPIC_CUE[primaryTopic] && TOPIC_CUE[primaryTopic].test(reply)) ||
      // loan legal often lands requires loan_eligibility
      (primaryTopic === 'legal' &&
        /loan|ltv|bank/i.test(caseRow.phrasing) &&
        (requires.includes('loan_eligibility') || /loan|ltv|bank/i.test(reply)));
    if (!topicOk && !['book_visit', 'request_callback', 'small_talk', 'opt_out', 'escalate_to_human', 'find_projects', 'definition_bhk', 'definition_documents'].includes(caseRow.intent_kind)) {
      reasons.push('fail_topic');
    }
  }

  if (expect.multi && expectTopics.length >= 2) {
    const hits = expectTopics.filter((t) => TOPIC_CUE[t]?.test(reply)).length;
    if (hits < Math.min(2, expectTopics.length)) reasons.push('fail_multi_atom');
  }

  // Soft latency flag (not hard fail for train set, but counted)
  const slow = ms > 25_000;

  const ok = reasons.length === 0;
  return {
    ok,
    reasons,
    slow,
    http,
    ms,
    phase,
    goalKind,
    goalTopic,
    requires,
    reply: reply.slice(0, 280).replace(/\n/g, ' '),
    err,
  };
}

async function warmSession(workerId) {
  const sessionId = `stress-${ts}-w${workerId}-${Math.random().toString(36).slice(2, 8)}`;
  await turn(sessionId, 'hi', { preferences: BRIEF });
  await turn(sessionId, `Tell me about ${FOCUS_NAME}`, {
    preferences: ADVISOR_PREFS,
  });
  return sessionId;
}

async function askFocused(sessionId, text) {
  return turn(sessionId, text, {
    preferences: ADVISOR_PREFS,
    project_id: FOCUS_ID,
    project_name: FOCUS_NAME,
    board_tab: 'overview',
  });
}

async function main() {
  console.log(`stress corpus → ${BASE}`);
  console.log(`corpus=${CORPUS} concurrency=${CONCURRENCY} limit=${LIMIT} offset=${OFFSET}`);
  console.log(`out=${OUT_DIR}`);
  const cases = await loadCorpus();
  console.log(`loaded ${cases.length} cases @ ${new Date().toISOString()}`);

  const stats = {
    total: 0,
    pass: 0,
    fail: 0,
    slow: 0,
    by_reason: {},
    by_intent: {},
    by_complexity: {},
    by_language: {},
    latencies: [],
  };

  let idx = 0;
  const started = Date.now();

  async function worker(workerId) {
    let sessionId = await warmSession(workerId);
    let sinceWarm = 0;
    while (true) {
      const i = idx++;
      if (i >= cases.length) break;
      const c = cases[i];
      if (sinceWarm >= 80) {
        sessionId = await warmSession(workerId);
        sinceWarm = 0;
      }
      const { http, json, ms, err } = await askFocused(sessionId, c.phrasing);
      sinceWarm++;
      const s = score(c, http, json, ms, err);
      const rec = {
        id: c.id,
        phrasing: c.phrasing,
        intent_kind: c.intent_kind,
        intent_kinds: c.intent_kinds,
        topics: c.topics,
        language: c.language,
        complexity: c.complexity,
        ...s,
      };
      appendFileSync(RESULTS, JSON.stringify(rec) + '\n');
      if (!s.ok) {
        appendFileSync(
          FAILS,
          JSON.stringify({
            id: c.id,
            phrasing: c.phrasing,
            intent_kind: c.intent_kind,
            intent_kinds: c.intent_kinds,
            topics: c.topics,
            language: c.language,
            complexity: c.complexity,
            reasons: s.reasons,
            goalTopic: s.goalTopic,
            goalKind: s.goalKind,
            reply: s.reply,
            http: s.http,
            ms: s.ms,
            err: s.err,
            train_hint: 'promote_to_intent_registry_after_label_review',
          }) + '\n',
        );
      }

      stats.total++;
      if (s.ok) stats.pass++;
      else stats.fail++;
      if (s.slow) stats.slow++;
      stats.latencies.push(ms);
      for (const r of s.reasons) stats.by_reason[r] = (stats.by_reason[r] || 0) + 1;
      const ik = c.intent_kind;
      stats.by_intent[ik] ??= { pass: 0, fail: 0 };
      if (s.ok) stats.by_intent[ik].pass++;
      else stats.by_intent[ik].fail++;
      stats.by_complexity[c.complexity] ??= { pass: 0, fail: 0 };
      if (s.ok) stats.by_complexity[c.complexity].pass++;
      else stats.by_complexity[c.complexity].fail++;
      stats.by_language[c.language] ??= { pass: 0, fail: 0 };
      if (s.ok) stats.by_language[c.language].pass++;
      else stats.by_language[c.language].fail++;

      if (stats.total % 100 === 0) {
        const elapsed = ((Date.now() - started) / 1000).toFixed(0);
        const rps = (stats.total / ((Date.now() - started) / 1000)).toFixed(1);
        console.log(
          `… ${stats.total}/${cases.length} pass=${stats.pass} fail=${stats.fail} slow=${stats.slow} ${rps}/s ${elapsed}s`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, w) => worker(w)));

  const lats = stats.latencies.slice().sort((a, b) => a - b);
  const pct = (p) => lats[Math.min(lats.length - 1, Math.floor((p / 100) * lats.length))] ?? 0;
  const intentFailRank = Object.entries(stats.by_intent)
    .map(([k, v]) => ({
      intent: k,
      fail: v.fail,
      pass: v.pass,
      total: v.pass + v.fail,
      fail_rate: v.pass + v.fail ? v.fail / (v.pass + v.fail) : 0,
    }))
    .sort((a, b) => b.fail_rate - a.fail_rate || b.fail - a.fail);

  const summary = {
    started_at: new Date(started).toISOString(),
    ended_at: new Date().toISOString(),
    base: BASE,
    corpus: CORPUS,
    concurrency: CONCURRENCY,
    total: stats.total,
    pass: stats.pass,
    fail: stats.fail,
    pass_rate: stats.total ? stats.pass / stats.total : 0,
    slow_over_25s: stats.slow,
    latency_ms: {
      p50: pct(50),
      p90: pct(90),
      p99: pct(99),
      max: lats[lats.length - 1] || 0,
    },
    by_reason: stats.by_reason,
    by_complexity: stats.by_complexity,
    by_language: stats.by_language,
    worst_intents: intentFailRank.slice(0, 25),
    out_dir: OUT_DIR,
  };
  writeFileSync(`${OUT_DIR}/summary.json`, JSON.stringify(summary, null, 2));

  const md = [
    `# Intent stress report`,
    ``,
    `- **When:** ${summary.started_at} → ${summary.ended_at}`,
    `- **Target:** \`${BASE}\``,
    `- **Corpus:** \`${CORPUS}\` (${stats.total} probed, concurrency ${CONCURRENCY})`,
    `- **Pass:** ${stats.pass}/${stats.total} (${(summary.pass_rate * 100).toFixed(1)}%)`,
    `- **Fail (train queue):** ${stats.fail} → \`${FAILS}\``,
    `- **Slow (>25s):** ${stats.slow}`,
    `- **Latency ms:** p50=${summary.latency_ms.p50} p90=${summary.latency_ms.p90} p99=${summary.latency_ms.p99} max=${summary.latency_ms.max}`,
    ``,
    `## Fail reasons`,
    ``,
    ...Object.entries(stats.by_reason)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `- \`${k}\`: ${n}`),
    ``,
    `## By complexity`,
    ``,
    ...Object.entries(stats.by_complexity).map(
      ([k, v]) =>
        `- **${k}**: ${v.pass}/${v.pass + v.fail} pass (${(((v.pass / (v.pass + v.fail)) || 0) * 100).toFixed(1)}%)`,
    ),
    ``,
    `## By language`,
    ``,
    ...Object.entries(stats.by_language).map(
      ([k, v]) =>
        `- **${k}**: ${v.pass}/${v.pass + v.fail} pass (${(((v.pass / (v.pass + v.fail)) || 0) * 100).toFixed(1)}%)`,
    ),
    ``,
    `## Worst primary intents (embedder train priority)`,
    ``,
    `| intent | fail | total | fail_rate |`,
    `|---|---:|---:|---:|`,
    ...intentFailRank
      .slice(0, 30)
      .map(
        (r) =>
          `| ${r.intent} | ${r.fail} | ${r.total} | ${(r.fail_rate * 100).toFixed(1)}% |`,
      ),
    ``,
    `## Next`,
    ``,
    `1. Review \`${FAILS}\` — promote clean labels into \`corpus/intent-registry.jsonl\` (or pending/).`,
    `2. Rebuild INTENT_VECTORS (SIL pipeline).`,
    `3. Re-run this probe on fail IDs only: \`--corpus fails-for-train.jsonl\`.`,
    ``,
  ].join('\n');
  writeFileSync(REPORT, md);

  console.log('\n======== SUMMARY ========');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nreport → ${REPORT}`);
  console.log(`fails  → ${FAILS}`);
  process.exit(stats.fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
