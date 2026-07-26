#!/usr/bin/env node
/**
 * Teach gate — behavioural before/after for the starved-intent wave.
 *
 * The holdout eval scores routing in the abstract. This scores what the BUYER
 * gets, which is the only thing that decides whether a teach was worth doing.
 * Run once before the index rebuild, once after, and diff.
 *
 *   node scripts/teach-gate-probe.mjs before
 *   node scripts/teach-gate-probe.mjs after
 *   node scripts/teach-gate-probe.mjs diff
 *
 * Each probe carries the intent it should bind and a `bad` predicate describing
 * the FAILURE seen in testing — so a pass means the specific failure is gone,
 * not merely that some reply came back.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SPINE = process.env.CONVERSE_SPINE_URL
  ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev';
const OUT = 'scenarios/teach-gate';

/**
 * `good` = what a CORRECT answer must contain. `bad` = the recorded failure.
 * A probe passes only when good matches AND bad does not — a negative-only
 * check scored a bare greet as "ok" on the first run, which is the same
 * grade-the-topic-not-the-answer mistake this whole exercise exists to stop.
 */
const GREET = /^hi[!,]|welcome to naya|what are you after — area/i;
const FLOOR = /not sure what you'?d like help with/i;
const DUMP  = /here'?s what fits|couldn'?t match that size|from ₹/i;

const PROBES = [
  { id: 'metric-cagr',  kind: 'policy_investment_metric', text: 'what CAGR can I expect here',
    good: /can'?t (?:calculate|promise|do)|not able to (?:calculate|project)|don'?t (?:do|provide) (?:analytics|projections|forecasts)/i,
    bad: new RegExp([GREET.source, FLOOR.source].join('|'), 'i') },
  { id: 'metric-irr',   kind: 'policy_investment_metric', text: 'calculate the IRR on this investment',
    good: /can'?t (?:calculate|promise|do)|not able to (?:calculate|project)/i, bad: new RegExp([GREET.source, FLOOR.source].join('|'), 'i') },
  { id: 'def-bhk',      kind: 'definition_bhk',            text: 'what is the difference between 2 and 3 BHK',
    good: /bedroom|hall|kitchen/i, bad: new RegExp([DUMP.source, FLOOR.source].join('|'), 'i') },
  { id: 'def-journey',  kind: 'definition_buying_journey', text: 'what should a first time buyer look for',
    good: /rera|title|khata|approval|budget|check/i, bad: new RegExp([FLOOR.source, GREET.source].join('|'), 'i') },
  { id: 'about-ai',     kind: 'about_ai',                  text: 'are you a bot or a real person',
    good: /ai|assistant|advisor|not a human/i, bad: new RegExp([FLOOR.source, DUMP.source].join('|'), 'i') },
  { id: 'about-data',   kind: 'about_data',                text: 'what data do you collect about me',
    good: /details you share|your (?:data|details) (?:is|are)|use the details|privacy/i,
    bad: /do you want me to stop calling|stop all contact and delete/i },
  { id: 'prohibited',   kind: 'policy_prohibited',         text: 'only vegetarians, no meat eaters in the block',
    good: /can'?t (?:filter|screen|help with)|fair housing|not something I can|against/i,
    bad: new RegExp([GREET.source, DUMP.source, FLOOR.source].join('|'), 'i') },
  { id: 'goodbye',      kind: 'smalltalk',                 text: "I'll come back later, thanks",
    good: /.+/, bad: /do you want me to stop calling|stop all contact and delete/i },
  { id: 'def-rtm',      kind: 'definition_ready_to_move',  text: 'what does ready to move actually mean',
    good: /construction is complete|possession|handover|occupancy/i, bad: new RegExp([FLOOR.source, GREET.source].join('|'), 'i') },
  { id: 'def-docs',     kind: 'definition_documents',      text: 'which documents should I check before buying',
    good: /khata|title|sale deed|encumbrance|ec|rera|approval/i,
    bad: new RegExp([FLOOR.source, GREET.source].join('|'), 'i') },
  // Hard negatives — a teach that lifts the target while breaking these is a
  // regression wearing a win's clothes.
  { id: 'neg-search',   kind: 'find_projects',             text: '3 BHK in Whitefield under 1.5 Cr',
    good: /.+/, bad: /what is a bhk|bhk stands for|bedroom, hall/i },
  { id: 'neg-price',    kind: 'get_price',                 text: "what's the price of a 2BHK",
    good: /.+/, bad: /what is a bhk|bhk stands for|short explainer/i },
];

const say = async (phone, text) => {
  const r = await fetch(`${SPINE}/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ builder_id: 'naya-advisor', buyer_phone: phone, text }),
  });
  const b = await r.json();
  return {
    reply: (b.reply_text ?? '').replace(/\s+/g, ' ').trim(),
    goal: b.debug?.goal?.kind ?? '?',
    bind: b.debug?.extract_provenance?.routing_bind ?? {},
  };
};

async function run(phase) {
  const rows = [];
  let seed = 41000;
  for (const p of PROBES) {
    const r = await say(`+9198${(seed++).toString().padStart(8, '0')}`, p.text);
    const failed = p.bad.test(r.reply) || !p.good.test(r.reply);
    rows.push({ ...p, bad: String(p.bad), good: String(p.good), ...r, failed });
    console.log(`${failed ? 'FAIL' : 'ok  '}  ${p.id.padEnd(14)} ${r.bind.top_kind ?? '-'} ` +
      `${r.bind.top_score ? r.bind.top_score.toFixed(3) : ''}  ${r.reply.slice(0, 90)}`);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${phase}.json`, JSON.stringify(rows, null, 2) + '\n');
  const failed = rows.filter((r) => r.failed).length;
  console.log(`\n${phase}: ${rows.length - failed}/${rows.length} probes clean`);
}

function diff() {
  const b = JSON.parse(readFileSync(`${OUT}/before.json`, 'utf8'));
  const a = JSON.parse(readFileSync(`${OUT}/after.json`, 'utf8'));
  const byId = new Map(a.map((r) => [r.id, r]));
  let fixed = 0, broke = 0;
  for (const x of b) {
    const y = byId.get(x.id);
    if (!y) continue;
    if (x.failed && !y.failed) { fixed++; console.log(`FIXED   ${x.id}: ${y.reply.slice(0, 90)}`); }
    if (!x.failed && y.failed) { broke++; console.log(`BROKE   ${x.id}: ${y.reply.slice(0, 90)}`); }
  }
  console.log(`\nfixed ${fixed} · broke ${broke} · unchanged ${b.length - fixed - broke}`);
  if (broke) process.exitCode = 1;
}

const phase = process.argv[2] ?? 'before';
if (phase === 'diff') diff(); else await run(phase);
