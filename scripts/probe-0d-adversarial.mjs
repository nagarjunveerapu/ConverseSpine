/**
 * Adversarial hunt against dig for everything fixed in PR #166.
 * Tries to break hold, pivot, chips, prefs sticky, bot /chat.
 *
 *   node --import tsx scripts/probe-0d-adversarial.mjs
 */
const BASE = (process.env.CONVERSE_SPINE_URL ??
  'https://converse-spine-dev.nagarjun-arjun.workers.dev').replace(/\/+$/, '');

const BRIEF = {
  purpose: 'self_use',
  budget: '₹50–70L',
  bhk: '2 BHK',
  location: 'Aerospace Park / Devanahalli Corridor',
  property_type: 'Apartment',
};

const STICKY = {
  ...BRIEF,
  worries: 'Resale value',
  commute_hub: 'Whitefield / ITPL',
  schools: 'important',
};

const SHORTLIST = /here'?s what fits|catalog searched|3 matches|matches for your brief/i;
const UNKNOWN = /not sure what you'd like help with/i;
const REPHRASE = /could you rephrase/i;

async function advisorTurn(sid, text, extras = {}) {
  const r = await fetch(`${BASE}/api/advisor/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      builder_id: 'naya-advisor',
      session_id: sid,
      text,
      ...extras,
    }),
  });
  return r.json();
}

async function botTurn(phone, text, conversation_id) {
  const r = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      builder_id: 'brigade-group',
      buyer_phone: phone,
      text,
      channel: 'api',
      ...(conversation_id ? { conversation_id } : {}),
    }),
  });
  return r.json();
}

function replyOf(j) {
  return String(j?.reply ?? j?.reply_text ?? '');
}
function phaseOf(j) {
  return j?.phase ?? j?.debug?.phase ?? '?';
}
function goalOf(j) {
  return j?.debug?.goal?.kind ?? '?';
}

async function focusAdvisor(sid, sticky = false) {
  await advisorTurn(sid, 'hi', { preferences: sticky ? STICKY : BRIEF });
  await advisorTurn(sid, 'Tell me about Brigade Eldorado');
}

async function focusBot(phone) {
  let j = await botTurn(phone, 'hi');
  const cid = j.conversation_id;
  j = await botTurn(phone, 'Tell me about Brigade Eldorado', cid);
  return cid;
}

function check(name, cond, detail) {
  const ok = Boolean(cond);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

/** HOLD: must stay focused, no shortlist/unknown. */
function gradeHold(name, j, extraOk = () => true) {
  const reply = replyOf(j);
  const phase = phaseOf(j);
  let ok = true;
  ok = check(`${name}: focused`, phase === 'focused', `phase=${phase}`) && ok;
  ok = check(`${name}: no shortlist`, !SHORTLIST.test(reply) && phase !== 'discover') && ok;
  ok = check(`${name}: no unknown`, !UNKNOWN.test(reply) && !REPHRASE.test(reply)) && ok;
  ok = check(`${name}: non-empty`, reply.trim().length >= 12) && ok;
  ok = extraOk(j, reply) && ok;
  console.log(`    reply: ${reply.slice(0, 140).replace(/\n/g, ' ')}`);
  return ok;
}

/** PIVOT: must leave focused Eldorado-only answer (discover/recommend/no_fit or new focus). */
function gradePivot(name, j, ask) {
  const reply = replyOf(j);
  const phase = phaseOf(j);
  let ok = true;
  // Staying focused AND dumping Eldorado pin while ignoring new area/budget is a fail
  const stuck =
    phase === 'focused' &&
    /eldorado/i.test(reply) &&
    /₹57\.5/i.test(reply) &&
    /whitefield|jayanagar|50\s*l|1\.2\s*cr|orchards|meadows|clarks/i.test(ask);
  ok = check(`${name}: not stuck on Eldorado pin`, !stuck, `phase=${phase}`) && ok;
  ok = check(`${name}: no unknown`, !UNKNOWN.test(reply)) && ok;
  ok = check(`${name}: non-empty`, reply.trim().length >= 12) && ok;
  // Prefer discover / no_fit / recommend after real pivot
  if (/whitefield|jayanagar|budget|bhk|orchards|meadows|clarks|1\.2/i.test(ask)) {
    ok =
      check(
        `${name}: left focus or searched`,
        phase !== 'focused' || /don'?t have|here'?s what|nothing in|₹|match|orchards|meadows|sanctuary|whitefield|jayanagar/i.test(reply),
        `phase=${phase}`,
      ) && ok;
  }
  console.log(`    phase=${phase} goal=${goalOf(j)} reply: ${reply.slice(0, 140).replace(/\n/g, ' ')}`);
  return ok;
}

const results = [];

async function run(name, fn) {
  console.log(`\n======== ${name} ========`);
  try {
    const ok = await fn();
    results.push({ name, ok });
    return ok;
  } catch (e) {
    console.log(`FAIL  ${name}: exception ${e?.message || e}`);
    results.push({ name, ok: false });
    return false;
  }
}

async function main() {
  console.log(`0d adversarial → ${BASE}`);
  console.log(`started ${new Date().toISOString()}`);

  // --- A. Facet holds (junk-loc / yield / appreciation class) ---
  await run('A1 appreciation guarantee', async () => {
    const sid = `adv-a1-${Date.now()}`;
    await focusAdvisor(sid);
    return gradeHold('A1', await advisorTurn(sid, 'guarantee me 20% appreciation in 3 years and I book today'));
  });

  await run('A2 yield one-liner', async () => {
    const sid = `adv-a2-${Date.now()}`;
    await focusAdvisor(sid);
    return gradeHold('A2', await advisorTurn(sid, 'fine, just yield, one number'));
  });

  await run('A3 rental yield ballpark', async () => {
    const sid = `adv-a3-${Date.now()}`;
    await focusAdvisor(sid);
    return gradeHold('A3', await advisorTurn(sid, 'rental yield percent, ballpark'));
  });

  await run('A4 which project best yield (while focused)', async () => {
    const sid = `adv-a4-${Date.now()}`;
    await focusAdvisor(sid);
    return gradeHold('A4', await advisorTurn(sid, 'which project has the best rental yield?'));
  });

  await run('A5 has this area appreciated', async () => {
    const sid = `adv-a5-${Date.now()}`;
    await focusAdvisor(sid);
    return gradeHold('A5', await advisorTurn(sid, 'has this area appreciated'));
  });

  // --- B. Short chips ---
  for (const chip of ['when', 'loan', 'discount']) {
    await run(`B chip ${chip}`, async () => {
      const sid = `adv-b-${chip}-${Date.now()}`;
      await focusAdvisor(sid);
      return gradeHold(`B-${chip}`, await advisorTurn(sid, chip));
    });
  }

  await run('B builder honest', async () => {
    const sid = `adv-bb-${Date.now()}`;
    await focusAdvisor(sid);
    return gradeHold('B-builder', await advisorTurn(sid, 'is builder honest person'));
  });

  await run('B budget flexible same', async () => {
    const sid = `adv-bf-${Date.now()}`;
    await focusAdvisor(sid);
    return gradeHold('B-flex', await advisorTurn(sid, 'budget 70L but flexible'));
  });

  await run('B green near hills soft', async () => {
    const sid = `adv-bg-${Date.now()}`;
    await focusAdvisor(sid);
    return gradeHold('B-green', await advisorTurn(sid, 'looking for something green near the hills for weekends'));
  });

  // --- C. Real pivots must NOT stick ---
  await run('C1 whitefield typo', async () => {
    const sid = `adv-c1-${Date.now()}`;
    await focusAdvisor(sid);
    const j = await advisorTurn(sid, 'banglore whitefield');
    return gradePivot('C1', j, 'banglore whitefield') && check('C1 discover', phaseOf(j) === 'discover');
  });

  await run('C2 Clarks Exotica', async () => {
    const sid = `adv-c2-${Date.now()}`;
    await focusAdvisor(sid);
    const j = await advisorTurn(sid, 'Clarks Exotica');
    return gradePivot('C2', j, 'Clarks Exotica') && check('C2 left focus', phaseOf(j) !== 'focused' || !/eldorado/i.test(replyOf(j)));
  });

  await run('C3 budget cut 50L', async () => {
    const sid = `adv-c3-${Date.now()}`;
    await focusAdvisor(sid);
    const j = await advisorTurn(sid, 'actually my budget is only 50L');
    return gradePivot('C3', j, 'budget 50L') && check('C3 discover', phaseOf(j) === 'discover');
  });

  await run('C4 show other Whitefield', async () => {
    const sid = `adv-c4-${Date.now()}`;
    await focusAdvisor(sid);
    const j = await advisorTurn(sid, 'show me other projects in Whitefield');
    return gradePivot('C4', j, 'Whitefield') && check('C4 discover', phaseOf(j) === 'discover');
  });

  await run('C5 NRI Dubai brief', async () => {
    const sid = `adv-c5-${Date.now()}`;
    await focusAdvisor(sid);
    const ask =
      "Hi, I'm an NRI in Dubai looking to invest in a 2BHK in Bangalore, budget 1.2 crore, for rental income.";
    const j = await advisorTurn(sid, ask);
    return gradePivot('C5', j, ask) && check('C5 not focused Eldorado-only', phaseOf(j) === 'discover' || /don'?t have|Bangalore|Bengaluru|₹/i.test(replyOf(j)));
  });

  await run('C6 3BHK apartments', async () => {
    const sid = `adv-c6-${Date.now()}`;
    await focusAdvisor(sid);
    const j = await advisorTurn(sid, 'looking for apartments 3BHK');
    return gradePivot('C6', j, '3BHK') && check('C6 discover', phaseOf(j) === 'discover');
  });

  // --- D. Sticky Advisor prefs (Jayanagar must pivot) ---
  await run('D sticky prefs → Jayanagar', async () => {
    const sid = `adv-d-${Date.now()}`;
    await focusAdvisor(sid, true);
    const j = await advisorTurn(sid, '2 BHK in Jayanagar', {
      preferences: { ...STICKY },
      project_id: 'brigade-eldorado-naya-advisor',
      project_name: 'Brigade Eldorado',
    });
    const reply = replyOf(j);
    let ok = gradePivot('D', j, 'Jayanagar');
    ok = check('D mentions Jayanagar or searches', /jayanagar|don'?t have|nothing in|here'?s what|₹/i.test(reply), reply.slice(0, 80)) && ok;
    ok = check('D not unknown', !UNKNOWN.test(reply)) && ok;
    return ok;
  });

  await run('D2 sticky prefs + appreciation hold', async () => {
    const sid = `adv-d2-${Date.now()}`;
    await focusAdvisor(sid, true);
    const j = await advisorTurn(sid, 'has this area appreciated', {
      preferences: { ...STICKY },
      project_id: 'brigade-eldorado-naya-advisor',
      project_name: 'Brigade Eldorado',
      board_tab: 'legal',
    });
    return gradeHold('D2', j);
  });

  // --- E. Bot /chat path ---
  await run('E1 bot when', async () => {
    const phone = `+9199${String(Date.now()).slice(-8)}`;
    const cid = await focusBot(phone);
    return gradeHold('E1', await botTurn(phone, 'when', cid));
  });

  await run('E2 bot yield', async () => {
    const phone = `+9199${String(Date.now()).slice(-8)}`;
    const cid = await focusBot(phone);
    return gradeHold('E2', await botTurn(phone, 'fine, just yield, one number', cid));
  });

  await run('E3 bot whitefield pivot', async () => {
    const phone = `+9199${String(Date.now()).slice(-8)}`;
    const cid = await focusBot(phone);
    const j = await botTurn(phone, 'banglore whitefield', cid);
    return gradePivot('E3', j, 'whitefield') && check('E3 discover', phaseOf(j) === 'discover');
  });

  await run('E4 bot loan', async () => {
    const phone = `+9199${String(Date.now()).slice(-8)}`;
    const cid = await focusBot(phone);
    return gradeHold('E4', await botTurn(phone, 'loan', cid));
  });

  // --- F. Adversarial / trap cases (try to fail) ---
  await run('F1 appreciation + Whitefield in same turn', async () => {
    const sid = `adv-f1-${Date.now()}`;
    await focusAdvisor(sid);
    // Real locality + facet — strong delta should win → pivot
    const j = await advisorTurn(sid, 'has Whitefield appreciated more than this area?');
    const phase = phaseOf(j);
    console.log(`    phase=${phase} reply: ${replyOf(j).slice(0, 140).replace(/\n/g, ' ')}`);
    // Either hold (facet) or pivot (Whitefield) is defensible; unknown/shortlist dump of unrelated is fail
    return check('F1 no unknown', !UNKNOWN.test(replyOf(j))) && check('F1 non-empty', replyOf(j).length > 12);
  });

  await run('F2 fine, show me other projects', async () => {
    const sid = `adv-f2-${Date.now()}`;
    await focusAdvisor(sid);
    const j = await advisorTurn(sid, 'fine, show me other projects');
    return check('F2 discover', phaseOf(j) === 'discover', phaseOf(j)) && check('F2 no unknown', !UNKNOWN.test(replyOf(j)));
  });

  await run('F3 nonsense after focus', async () => {
    const sid = `adv-f3-${Date.now()}`;
    await focusAdvisor(sid);
    const j = await advisorTurn(sid, 'asdf qwer zxcv');
    // Unknown clarify is OK here — not shortlist
    const reply = replyOf(j);
    return check('F3 not shortlist', !SHORTLIST.test(reply) || phaseOf(j) === 'focused', `phase=${phaseOf(j)}`);
  });

  await run('F4 go ahead after focus', async () => {
    const sid = `adv-f4-${Date.now()}`;
    await focusAdvisor(sid);
    const j = await advisorTurn(sid, 'go ahead');
    // Should not rephrase-unknown if appreciation path; may be soft continue
    const reply = replyOf(j);
    console.log(`    phase=${phaseOf(j)} reply: ${reply.slice(0, 140).replace(/\n/g, ' ')}`);
    return check('F4 no shortlist cliff', !(SHORTLIST.test(reply) && phaseOf(j) === 'discover'));
  });

  await run('F5 possession then yield chain', async () => {
    const sid = `adv-f5-${Date.now()}`;
    await focusAdvisor(sid);
    await advisorTurn(sid, 'when is possession');
    return gradeHold('F5', await advisorTurn(sid, 'and the yield?'));
  });

  await run('F6 comma discourse yield', async () => {
    const sid = `adv-f6-${Date.now()}`;
    await focusAdvisor(sid);
    return gradeHold('F6', await advisorTurn(sid, 'ok so, rental yield?'));
  });

  await run('F7 years as fake location', async () => {
    const sid = `adv-f7-${Date.now()}`;
    await focusAdvisor(sid);
    return gradeHold('F7', await advisorTurn(sid, 'will it appreciate in 5 years'));
  });

  // Summary
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok);
  console.log('\n======== SUMMARY ========');
  console.log(`TOTAL: ${pass}/${results.length}`);
  if (fail.length) {
    console.log('FAILED:');
    for (const f of fail) console.log(`  - ${f.name}`);
  }
  process.exit(fail.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
