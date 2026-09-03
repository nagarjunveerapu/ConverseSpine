#!/usr/bin/env node
/**
 * Dig smoke: Spine /chat → Desk catalog_watch fulfill (P2).
 *
 * 1. OS enrolls Watching for RERA phrase on Meadows (Desk)
 * 2. Buyer focuses Meadows via Spine /chat
 * 3. Buyer asks the watched phrase
 * 4. Poll Desk Today for fulfilled + FYI notify
 *
 * Tail uses waitUntil on Workers — poll after /chat returns.
 *
 *   node scripts/journey-catalog-watch-live.mjs
 */
const SPINE = (process.env.CONVERSE_SPINE_URL
  ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev').replace(/\/+$/, '');
const DESK = (process.env.DESK
  ?? 'https://nayadesk-dev.nagarjun-arjun.workers.dev').replace(/\/+$/, '');
const PASSWORD = process.env.PASSWORD ?? 'change-me-on-first-login';
const BUILDER = process.env.BUILDER ?? 'brigade-group';
const PROJECT = process.env.PROJECT ?? 'brigade-meadows';
const PHRASE = 'is it RERA approved?';

const WHO = {
  ops: 'botops@nayadesk.local',
  os: 'onb@brigade.dev',
};
const tokens = {};
const results = [];
let section = '';
const RUN = `cwlive_${Date.now().toString(36)}`;
const phone = `91${String(Date.now()).slice(-10)}`;

function head(s) {
  section = s;
  console.log(`\n▸ ${s}`);
}
function check(what, ok, detail = '') {
  results.push({ section, what, ok, detail });
  console.log(`    ${ok ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`);
}

async function login(k) {
  const r = await fetch(`${DESK}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: WHO[k], password: PASSWORD }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`login ${WHO[k]} → ${r.status}`);
  tokens[k] = j.token;
  check(`login ${k}`, Boolean(tokens[k]), j.user?.role ?? '');
}

async function desk(k, method, path, body) {
  const r = await fetch(`${DESK}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-session-token': tokens[k] ?? '',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 200) }; }
  return { status: r.status, ok: r.ok, json };
}

async function chat(text, threadId) {
  const r = await fetch(`${SPINE}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      builder_id: BUILDER,
      buyer_phone: phone,
      text,
      ...(threadId ? { thread_id: threadId } : {}),
    }),
  });
  const j = await r.json().catch(() => ({}));
  return {
    status: r.status,
    ok: r.ok,
    reply: (j.reply_text ?? j.reply ?? '').replace(/\s+/g, ' ').trim(),
    cid: j.thread_id,
    bind: j.debug?.extract_provenance?.routing_bind
      ?? j.debug?.routing?.bind
      ?? {},
    focus: j.debug?.focus ?? j.debug?.state?.focus ?? null,
    raw: j,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  console.log(`\nCatalog watch Spine→Desk live · spine=${SPINE}`);
  console.log(`desk=${DESK} builder=${BUILDER} project=${PROJECT} run=${RUN}`);
  console.log('═'.repeat(66));

  head('Auth Desk roles');
  await login('ops');
  await login('os');

  head('Enroll Watching for RERA phrase');
  const enroll = await desk('os', 'POST', '/api/v1/onboarding/today/watches/enroll', {
    builder_id: BUILDER,
    project_id: PROJECT,
    slot_id: 'rera',
    facet_key: 'rera',
    phrase_family: PHRASE,
    reviewed_intent: 'get_legal',
    source: 'fill',
  });
  check('enroll watch', enroll.ok && Boolean(enroll.json?.watch_id),
    `HTTP ${enroll.status} ${enroll.json?.watch_id ?? JSON.stringify(enroll.json).slice(0, 140)}`);
  const watchId = enroll.json?.watch_id;
  if (!watchId) {
    console.error('\nCannot continue without watch_id\n');
    process.exit(2);
  }

  head('Spine buyer focuses Meadows then asks RERA');
  let cid;
  const t1 = await chat('Brigade Meadows');
  cid = t1.cid;
  check('focus turn HTTP OK', t1.ok, `HTTP ${t1.status} cid=${cid ?? ''}`);
  check('focus reply mentions Meadows', /meadows/i.test(t1.reply), t1.reply.slice(0, 160));

  const t2 = await chat(PHRASE, cid);
  cid = t2.cid || cid;
  check('RERA ask HTTP OK', t2.ok, `HTTP ${t2.status}`);
  check('RERA reply cites registration (not honest-miss)',
    /PRM\/KA|RERA\s*:/i.test(t2.reply) && !/don'?t have that detail on file/i.test(t2.reply),
    t2.reply.slice(0, 200));
  check('routing bind present',
    Boolean(t2.bind?.top_kind || t2.bind?.facet),
    JSON.stringify(t2.bind));

  head('Poll Desk for fulfill (waitUntil tail)');
  let matchedStatus = null;
  for (let i = 0; i < 20; i++) {
    await sleep(750);
    const today = await desk('os', 'GET', `/api/v1/onboarding/today?builder_id=${encodeURIComponent(BUILDER)}`);
    const cleared = (today.json?.stream?.just_cleared ?? []).some((x) => x.watch_id === watchId);
    const problem = (today.json?.stream?.problem_list ?? []).some((x) => x.watch_id === watchId);
    const watching = (today.json?.stream?.watching_list ?? []).some((x) => x.watch_id === watchId);
    if (cleared) { matchedStatus = 'fulfilled'; break; }
    if (problem) { matchedStatus = 'problem'; break; }
    if (!watching && i > 4) {
      // Dropped from watching without landing in cleared/problem (cap/age) — soft fail detail.
      matchedStatus = 'missing';
      break;
    }
  }
  check('Spine live-ask fulfilled Watching',
    matchedStatus === 'fulfilled',
    matchedStatus
      ? `watch=${watchId} status=${matchedStatus}`
      : `still watching after poll · reply=${t2.reply.slice(0, 120)}`);

  head('Notify after Spine-driven fulfill');
  let notif = null;
  for (let i = 0; i < 10 && !notif; i++) {
    const n = await desk('os', 'GET', '/api/v1/notifications?tab=fyi&limit=40');
    notif = (n.json?.notifications ?? []).find((row) =>
      row.kind === 'catalog_watch_fulfilled' && row.entity_id === watchId);
    if (!notif) await sleep(400);
  }
  check('OS FYI catalog_watch_fulfilled', Boolean(notif), notif?.id ?? 'missing');

  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${'═'.repeat(66)}`);
  console.log(`Done · ${pass} passed · ${fail} failed`);
  if (fail) {
    console.log('\nFailures:');
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  [${r.section}] ${r.what}${r.detail ? ` — ${r.detail}` : ''}`);
    }
  }
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
