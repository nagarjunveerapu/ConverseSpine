#!/usr/bin/env node
/**
 * Behavioural gate for TOPIC_UNION on dig.
 * Truth-grade: both (or top-2) facets in the reply; park line when 3 topics.
 *
 *   CONVERSE_SPINE_URL=... node scripts/multi-intent-flag-probe.mjs
 */
const SPINE = (process.env.CONVERSE_SPINE_URL
  ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev').replace(/\/+$/, '');
const BUILDER = process.env.BUILDER_ID ?? 'naya-advisor';

const say = async (phone, text, convId) => {
  const body = {
    builder_id: BUILDER,
    buyer_phone: phone,
    text,
    ...(convId ? { conversation_id: convId } : {}),
  };
  const r = await fetch(`${SPINE}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  return {
    ok: r.ok,
    reply: String(j.reply_text ?? '').replace(/\s+/g, ' ').trim(),
    convId: j.conversation_id ?? convId,
    goal: j.debug?.goal ?? {},
    topics: j.debug?.goal?.topics ?? j.debug?.extract_provenance?.fields?.askTopics,
    ask_topics: j.debug?.action_plan?.topics ?? j.debug?.resolved_intent?.ask_topics,
  };
};

const focusEldorado = async (phone) => {
  let conv;
  let r = await say(phone, 'hi');
  conv = r.convId;
  r = await say(phone, '2 BHK in Whitefield under 1.5 Cr', conv);
  conv = r.convId;
  r = await say(phone, 'tell me about Brigade Eldorado', conv);
  return { convId: r.convId, focusReply: r.reply };
};

const PROBES = [
  {
    id: 'price-rera',
    text: 'what is the price and is it RERA approved?',
    good: [
      { name: 'price', re: /₹|rs\.?|lakh|cr\b|pricing|starting|bsp|per\s*sq/i },
      { name: 'rera', re: /rera|prm\/ka|registration/i },
    ],
    bad: [/not sure what you'?d like|welcome to naya.*area/i],
  },
  {
    id: 'price-possession',
    text: 'starting price and when is possession?',
    good: [
      { name: 'price', re: /₹|rs\.?|lakh|cr\b|pricing|starting|bsp/i },
      { name: 'possession', re: /possession|ready|handover|deliver|completion|202\d/i },
    ],
    bad: [/not sure what you'?d like/i],
  },
  {
    id: 'brochure-price',
    text: 'send the brochure and what is the starting price?',
    good: [
      { name: 'brochure_or_media', re: /brochure|floor\s*plan|pdf|http|cdn|media|share/i },
      { name: 'price', re: /₹|rs\.?|lakh|cr\b|pricing|starting|bsp/i },
    ],
    bad: [/not sure what you'?d like/i],
  },
  {
    id: 'amenities-maintenance',
    text: 'what amenities does it have and what are the maintenance charges?',
    good: [
      { name: 'amenities_or_maint', re: /amenit|gym|pool|club|maintenance|charges?|₹|rs/i },
    ],
    // Soft: both facets ideal; at least one concrete project answer, not a fresh shortlist dump
    bad: [/here'?s what fits|couldn'?t match that size/i],
    note: 'maintenance may still route as amenities/payment — score coverage, not perfect topic split',
  },
  {
    id: 'price-possession-rera-park',
    text: 'price, possession date, and is it RERA approved?',
    good: [
      { name: 'facet_a', re: /₹|rs\.?|lakh|cr\b|pricing|starting|bsp|possession|ready|handover|rera|prm\/ka/i },
      { name: 'facet_b', re: /₹|rs\.?|lakh|cr\b|pricing|possession|ready|handover|rera|prm\/ka/i },
    ],
    park: /I can cover .+ next if you want/i,
    bad: [/not sure what you'?d like/i],
    note: 'top-2 answered; park line expected when 3 topics survive',
  },
  {
    id: 'single-price-no-thin',
    text: 'what is the starting price?',
    good: [
      { name: 'price', re: /₹|rs\.?|lakh|cr\b|pricing|starting|bsp|per\s*sq/i },
    ],
    bad: [
      /I can cover .+ next if you want/i, // park must NOT fire on single-topic
      /not sure what you'?d like/i,
    ],
    minLen: 40,
  },
];

async function runProbe(probe) {
  const phone = `mi-flag-${probe.id}-${Date.now().toString(36)}`;
  const { convId } = await focusEldorado(phone);
  const r = await say(phone, probe.text, convId);
  const misses = [];
  for (const g of probe.good) {
    if (!g.re.test(r.reply)) misses.push(`missing:${g.name}`);
  }
  for (const b of probe.bad ?? []) {
    if (b.test(r.reply)) misses.push(`hit-bad:${b}`);
  }
  if (probe.park && !probe.park.test(r.reply)) {
    misses.push('missing:park-line');
  }
  if (probe.minLen && r.reply.length < probe.minLen) {
    misses.push(`thin:${r.reply.length}`);
  }
  const hard = misses.filter((m) => !m.startsWith('warn:'));
  return {
    id: probe.id,
    pass: hard.length === 0,
    warns: misses.filter((m) => m.startsWith('warn:')),
    misses: hard,
    reply: r.reply.slice(0, 420),
    goal: r.goal,
    note: probe.note,
  };
}

const health = await fetch(`${SPINE}/health`).then((r) => r.json()).catch(() => null);
console.log(`SPINE=${SPINE}`);
console.log(`health=`, health);
console.log('');

const results = [];
for (const p of PROBES) {
  process.stdout.write(`… ${p.id}\n`);
  try {
    results.push(await runProbe(p));
  } catch (e) {
    results.push({ id: p.id, pass: false, misses: [`error:${e.message}`], reply: '', goal: {} });
  }
}

let pass = 0;
for (const r of results) {
  const mark = r.pass ? 'PASS' : 'FAIL';
  if (r.pass) pass++;
  console.log(`\n══ ${mark} ${r.id} ══`);
  if (r.note) console.log(`note: ${r.note}`);
  if (r.misses?.length) console.log(`misses: ${r.misses.join('; ')}`);
  if (r.warns?.length) console.log(`warns: ${r.warns.join('; ')}`);
  console.log(`goal: ${JSON.stringify(r.goal)}`);
  console.log(`reply: ${r.reply}`);
}

console.log(`\n── ${pass}/${results.length} hard-pass ──`);
process.exit(pass === results.length ? 0 : 1);
