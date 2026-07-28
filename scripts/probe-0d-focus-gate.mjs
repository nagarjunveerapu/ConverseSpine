/**
 * Phase 0d dig chat gate — Advisor door, same dig URL.
 *
 *   CONVERSE_SPINE_URL=https://converse-spine-dev.nagarjun-arjun.workers.dev \
 *     node scripts/probe-0d-focus-gate.mjs
 */
const BASE = (process.env.CONVERSE_SPINE_URL ??
  'https://converse-spine-dev.nagarjun-arjun.workers.dev').replace(/\/+$/, '');
const BUILDER = process.env.BUILDER_ID ?? 'naya-advisor';

async function turn(sessionId, text, preferences) {
  const body = {
    builder_id: BUILDER,
    session_id: sessionId,
    text,
    ...(preferences ? { preferences } : {}),
  };
  const r = await fetch(`${BASE}/api/advisor/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  return { http: r.status, json };
}

function replyOf(json) {
  return String(json?.reply ?? json?.message ?? json?.text ?? '');
}

function phaseOf(json) {
  return json?.debug?.phase ?? json?.phase ?? json?.state?.phase ?? '?';
}

function focusOf(json) {
  return (
    json?.focused_project?.name ??
    json?.focusedProject?.name ??
    json?.debug?.focus_name ??
    json?.state?.focus?.projectName ??
    ''
  );
}

function pass(cond, label, detail) {
  const ok = Boolean(cond);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

async function runAnswerCase(label, focusLine, ask, mustMatch, mustNot) {
  const sid = `0d-ans-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await turn(sid, 'hi', {
    purpose: 'self_use',
    budget: '₹50–70L',
    bhk: '2 BHK',
    location: 'Aerospace Park / Devanahalli Corridor',
    property_type: 'Apartment',
  });
  // Force focus via named ask
  await turn(sid, focusLine);
  const { json } = await turn(sid, ask);
  const reply = replyOf(json);
  const focus = focusOf(json);
  const phase = phaseOf(json);
  console.log(`\n--- ${label} ---`);
  console.log(`phase=${phase} focus=${focus || '(none)'}`);
  console.log(`ask: ${ask}`);
  console.log(`reply: ${reply.slice(0, 280).replace(/\n/g, ' ')}`);
  let ok = true;
  ok = pass(/eldorado/i.test(focus) || /eldorado/i.test(reply), 'keeps Eldorado subject', focus || 'via reply') && ok;
  ok = pass(mustMatch.test(reply), 'reply carries expected fact shape', mustMatch.toString()) && ok;
  if (mustNot) ok = pass(!mustNot.test(reply), 'reply avoids wrong shape', mustNot.toString()) && ok;
  return ok;
}

async function runPivotCase(label, ask, mustMatch, mustNot) {
  const sid = `0d-piv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await turn(sid, 'hi', {
    purpose: 'self_use',
    budget: '₹50–70L',
    bhk: '2 BHK',
    location: 'Aerospace Park / Devanahalli Corridor',
    property_type: 'Apartment',
  });
  await turn(sid, 'Tell me about Brigade Eldorado');
  const { json } = await turn(sid, ask);
  const reply = replyOf(json);
  console.log(`\n--- ${label} ---`);
  console.log(`ask: ${ask}`);
  console.log(`reply: ${reply.slice(0, 320).replace(/\n/g, ' ')}`);
  let ok = true;
  ok = pass(mustMatch.test(reply), 'pivot reply shape', mustMatch.toString()) && ok;
  if (mustNot) ok = pass(!mustNot.test(reply), 'avoids pinned wrong answer', mustNot.toString()) && ok;
  return ok;
}

async function main() {
  console.log(`0d dig probe → ${BASE} builder=${BUILDER}`);
  let passes = 0;
  let total = 0;

  const cases = [
    () =>
      runAnswerCase(
        'A when is possession',
        'Tell me about Brigade Eldorado',
        'when is possession',
        /possession|handover|deliver|ready|202\d|phase/i,
        /here'?s what fits|catalog searched|3 matches/i,
      ),
    () =>
      runAnswerCase(
        'B what is the possession date',
        'Tell me about Brigade Eldorado',
        'what is the possession date',
        /possession|handover|deliver|ready|202\d|phase/i,
        /here'?s what fits|catalog searched/i,
      ),
    () =>
      runAnswerCase(
        'C has this area appreciated',
        'Tell me about Brigade Eldorado',
        'has this area appreciated',
        /appreciat|growth|value|cagr|trend|don'?t have|on file|records team|can'?t verify/i,
        /here'?s what fits|catalog searched|3 matches/i,
      ),
    () =>
      runPivotCase(
        'D budget 50L pivot',
        'actually my budget is only 50L',
        /₹|lakh|l\b|cornerstone|orchards|fit|budget|under|match|project/i,
        /from ₹57\.5\s*l(?!.*cornerstone)/i,
      ),
    () =>
      runPivotCase(
        'E 2 BHK in Jayanagar',
        '2 BHK in Jayanagar',
        /jayanagar|don'?t have|no .*in|outside|not .*area|elsewhere|whitefield|devanahalli|don'?t list/i,
        null,
      ),
    () =>
      runPivotCase(
        'F other projects in Whitefield',
        'show me other projects in Whitefield',
        /whitefield|utopia|cornerstone|match|project|here'?s what/i,
        null,
      ),
  ];

  for (const c of cases) {
    total += 1;
    try {
      if (await c()) passes += 1;
    } catch (e) {
      console.log(`FAIL  exception — ${e?.message || e}`);
    }
  }

  console.log(`\n=== ${passes}/${total} hard-pass ===`);
  process.exit(passes === total ? 0 : 1);
}

main();
