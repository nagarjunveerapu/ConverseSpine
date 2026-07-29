/**
 * Phase 0d dig stress suite — truth-grade hold vs pivot under Advisor payloads.
 *
 *   node scripts/probe-0d-stress.mjs
 *
 * Classes:
 *   HOLD   — focused Eldorado; reply must answer (or honest miss), not shortlist
 *   PIVOT  — must leave pinned Eldorado pricing / invent inventory
 *   SWITCH — named other project / board move (focus may change)
 *   EDGE   — noise / smalltalk / unknown
 */
const BASE = (process.env.CONVERSE_SPINE_URL ??
  'https://converse-spine-dev.nagarjun-arjun.workers.dev').replace(/\/+$/, '');
const BUILDER = process.env.BUILDER_ID ?? 'naya-advisor';
const FOCUS_LINE = 'Tell me about Brigade Eldorado';
const FOCUS_ID = 'brigade-eldorado-naya-advisor';

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

const SHORTLIST_RE =
  /here'?s what fits|catalog searched|3 matches|matches for your brief/i;
const UNKNOWN_RE = /not sure what you'd like help with/i;
const ELDORADO_PIN_PRICE = /from ₹57\.5\s*l(?!.*cornerstone)/i;

async function turn(sessionId, text, extras = {}) {
  const body = {
    builder_id: BUILDER,
    session_id: sessionId,
    text,
    ...extras,
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
  return json?.debug?.phase ?? json?.phase ?? '?';
}

function focusOf(json) {
  return (
    json?.focused_project?.name ??
    json?.focusedProject?.name ??
    json?.debug?.focus_name ??
    ''
  );
}

function goalKind(json) {
  return json?.debug?.goal?.kind ?? json?.goal?.kind ?? '?';
}

function sid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function focusSession(prefix, { advisorSticky = false } = {}) {
  const id = sid(prefix);
  await turn(id, 'hi', { preferences: BRIEF });
  await turn(id, FOCUS_LINE);
  return { id, advisorSticky };
}

async function ask(session, text, { advisorPayload = false, boardTab } = {}) {
  if (advisorPayload || session.advisorSticky) {
    return turn(session.id, text, {
      preferences: ADVISOR_PREFS,
      project_id: FOCUS_ID,
      project_name: 'Brigade Eldorado',
      ...(boardTab ? { board_tab: boardTab } : { board_tab: 'legal' }),
    });
  }
  return turn(session.id, text);
}

function row(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

async function holdCase(c) {
  const session = await focusSession(`hold`, { advisorSticky: !!c.advisor });
  const { json } = await ask(session, c.ask, {
    advisorPayload: !!c.advisor,
    boardTab: c.boardTab,
  });
  const reply = replyOf(json);
  const phase = phaseOf(json);
  const focus = focusOf(json);
  const goal = goalKind(json);
  console.log(`\n[HOLD] ${c.id}  ask=${JSON.stringify(c.ask)}`);
  console.log(`  phase=${phase} focus=${focus || '(none)'} goal=${goal}`);
  console.log(`  reply: ${reply.slice(0, 220).replace(/\n/g, ' ')}`);

  let ok = true;
  if (c.requireFocus !== false) {
    ok =
      row(
        phase === 'focused' && /eldorado/i.test(focus || 'Brigade Eldorado'),
        'focus held',
        `phase=${phase} focus=${focus || '(none)'}`,
      ) && ok;
    // focused_project sometimes omitted from mapper; phase+no shortlist is backup
    if (!focus && phase === 'focused') {
      ok = row(!SHORTLIST_RE.test(reply), 'no shortlist while focused', '') && ok;
    }
  }
  ok = row(c.must.test(reply), 'truth shape', c.must.toString()) && ok;
  if (c.mustNot) ok = row(!c.mustNot.test(reply), 'avoids wrong', c.mustNot.toString()) && ok;
  ok = row(!UNKNOWN_RE.test(reply), 'not unknown clarify', '') && ok;
  ok = row(!SHORTLIST_RE.test(reply), 'not shortlist dump', '') && ok;
  return ok;
}

async function pivotCase(c) {
  const session = await focusSession(`piv`, { advisorSticky: !!c.advisor });
  const { json } = await ask(session, c.ask, { advisorPayload: !!c.advisor });
  const reply = replyOf(json);
  const phase = phaseOf(json);
  const goal = goalKind(json);
  console.log(`\n[PIVOT] ${c.id}  ask=${JSON.stringify(c.ask)}`);
  console.log(`  phase=${phase} goal=${goal}`);
  console.log(`  reply: ${reply.slice(0, 260).replace(/\n/g, ' ')}`);

  let ok = true;
  ok = row(c.must.test(reply), 'pivot truth', c.must.toString()) && ok;
  if (c.mustNot) ok = row(!c.mustNot.test(reply), 'avoids pin', c.mustNot.toString()) && ok;
  ok = row(!UNKNOWN_RE.test(reply), 'not unknown clarify', '') && ok;
  return ok;
}

async function edgeCase(c) {
  const session = await focusSession(`edge`);
  const { json } = await ask(session, c.ask, { advisorPayload: !!c.advisor });
  const reply = replyOf(json);
  const phase = phaseOf(json);
  console.log(`\n[EDGE] ${c.id}  ask=${JSON.stringify(c.ask)}`);
  console.log(`  phase=${phase}`);
  console.log(`  reply: ${reply.slice(0, 200).replace(/\n/g, ' ')}`);
  let ok = true;
  ok = row(c.must.test(reply), 'edge shape', c.must.toString()) && ok;
  if (c.mustNot) ok = row(!c.mustNot.test(reply), 'avoids', c.mustNot.toString()) && ok;
  return ok;
}

const HOLD = [
  {
    id: 'H01 possession short',
    ask: 'when is possession',
    must: /possession|handover|deliver|ready|202\d|phase/i,
  },
  {
    id: 'H02 possession date',
    ask: 'what is the possession date',
    must: /possession|handover|deliver|ready|202\d|phase/i,
  },
  {
    id: 'H03 possession when ready',
    ask: 'when will it be ready to move',
    must: /possession|handover|deliver|ready|202\d|phase|move/i,
  },
  {
    id: 'H04 appreciation past tense',
    ask: 'has this area appreciated',
    must: /appreciat|growth|value|cagr|trend|don'?t have|on file|won'?t put a number|can'?t verify/i,
  },
  {
    id: 'H05 appreciation + SPA payload',
    ask: 'has this area appreciated',
    advisor: true,
    must: /appreciat|growth|value|cagr|trend|don'?t have|on file|won'?t put a number|can'?t verify/i,
  },
  {
    id: 'H06 will it appreciate',
    ask: 'will this corridor appreciate',
    advisor: true,
    must: /appreciat|growth|value|cagr|trend|don'?t have|on file|won'?t put a number|can'?t verify|resale/i,
  },
  {
    id: 'H07 rental yield',
    ask: 'what is the rental yield',
    advisor: true,
    must: /yield|rental|roi|don'?t have|on file|won'?t put|can'?t verify|no .*data/i,
  },
  {
    id: 'H08 ROI ask',
    ask: 'what ROI can I expect here',
    must: /yield|rental|roi|return|don'?t have|on file|won'?t put|can'?t verify|appreciat/i,
  },
  {
    id: 'H09 RERA',
    ask: 'what is the RERA number',
    advisor: true,
    boardTab: 'legal',
    must: /rera|registration|don'?t have|on file|legal|PRM|ka\s*rera/i,
  },
  {
    id: 'H10 title clear',
    ask: 'is the title clear',
    advisor: true,
    boardTab: 'legal',
    must: /title|khata|legal|clear|don'?t have|on file|litigation|encumbrance/i,
  },
  {
    id: 'H11 starting prices',
    ask: 'what are the starting prices',
    advisor: true,
    must: /₹|lakh|l\b|price|from|starting|57|31/i,
  },
  {
    id: 'H12 how much for 2bhk',
    ask: 'how much for a 2 BHK',
    must: /₹|lakh|2\s*bhk|price|from|57|31/i,
  },
  {
    id: 'H13 carpet area',
    ask: 'what is the carpet area',
    must: /carpet|sq\.?\s*ft|sqft|don'?t have|on file|built/i,
  },
  {
    id: 'H14 amenities',
    ask: 'what amenities does it have',
    must: /amenit|club|pool|gym|park|don'?t have|on file|facility|facilities/i,
  },
  {
    id: 'H15 configs',
    ask: 'what configurations are available',
    must: /bhk|config|sq\.?\s*ft|sqft|unit|available|1\s*bhk|2\s*bhk/i,
  },
  {
    id: 'H16 schools near (POI)',
    ask: 'schools near Brigade Eldorado',
    advisor: true,
    must: /school|min|km|nearby|education|don'?t have|on file/i,
  },
  {
    id: 'H17 commute Whitefield',
    ask: 'Commute from Whitefield / ITPL to Brigade Eldorado',
    advisor: true,
    must: /commute|whitefield|itpl|min|drive|traffic|don'?t have|can'?t verify|minute/i,
  },
  {
    id: 'H18 brochure',
    ask: 'share the brochure',
    must: /brochure|pdf|link|share|don'?t have|on file|media|floor\s*plan/i,
  },
  {
    id: 'H19 price + possession multi',
    ask: 'price and possession timeline',
    advisor: true,
    must: /₹|lakh|price|possession|handover|ready|202\d|phase/i,
  },
  {
    id: 'H20 maintenance',
    ask: 'what is the maintenance cost',
    must: /maintenance|₹|don'?t have|on file|month|sq\.?\s*ft|cam/i,
  },
];

const PIVOT = [
  {
    id: 'P01 budget 50L',
    ask: 'actually my budget is only 50L',
    advisor: true,
    must: /₹|lakh|l\b|match|project|fit|budget|under|eldorado|cornerstone|orchards/i,
    mustNot: ELDORADO_PIN_PRICE,
  },
  {
    id: 'P02 budget 40L',
    ask: 'my budget is only 40 lakhs',
    must: /₹|lakh|l\b|match|project|fit|budget|under|don'?t|no |outside|stretch/i,
  },
  {
    id: 'P03 Jayanagar',
    ask: '2 BHK in Jayanagar',
    advisor: true,
    must: /jayanagar|don'?t have|no .*in|outside|not .*area|elsewhere|kanakapura|sarjapur|jakkur/i,
  },
  {
    id: 'P04 Whitefield others',
    ask: 'show me other projects in Whitefield',
    must: /whitefield|sanctuary|utopia|cornerstone|match|project|here'?s what|nothing in/i,
  },
  {
    id: 'P05 Sarjapur pivot',
    ask: 'actually show me something in Sarjapur Road',
    advisor: true,
    must: /sarjapur|don'?t have|no .*in|match|project|here'?s what|outside|elsewhere/i,
  },
  {
    id: 'P06 change to 3 BHK',
    ask: 'actually change to 3 BHK',
    must: /3\s*bhk|config|match|project|don'?t|no |available|fit|here'?s what|₹/i,
  },
  {
    id: 'P07 show more projects',
    ask: 'show me more projects',
    must: /project|match|orchards|cornerstone|sanctuary|here'?s what|board|shortlist|more/i,
  },
  {
    id: 'P08 open to Whitefield living',
    ask: 'I want to live in Whitefield instead',
    advisor: true,
    must: /whitefield|don'?t have|match|project|here'?s what|sanctuary|nothing|outside|budget/i,
  },
];

const EDGE = [
  {
    id: 'E01 bare yes after focus',
    ask: 'yes',
    // advance / visit ask / more detail — not unknown, not random shortlist dump alone
    must: /./,
    mustNot: UNKNOWN_RE,
  },
  {
    id: 'E02 thanks',
    ask: 'thanks',
    must: /./,
    mustNot: SHORTLIST_RE,
  },
  {
    id: 'E03 garbage',
    ask: 'asdf qwer zxcv',
    // unknown clarify is acceptable here
    must: /./,
  },
  {
    id: 'E04 orchards switch',
    ask: 'Tell me about Brigade Orchards',
    advisor: true,
    must: /orchards/i,
    mustNot: UNKNOWN_RE,
  },
];

async function main() {
  console.log(`0d stress → ${BASE} builder=${BUILDER}`);
  console.log(`started ${new Date().toISOString()}`);

  const results = [];
  const run = async (cls, cases, fn) => {
    for (const c of cases) {
      try {
        const ok = await fn(c);
        results.push({ cls, id: c.id, ok });
      } catch (e) {
        console.log(`FAIL  exception — ${e?.message || e}`);
        results.push({ cls, id: c.id, ok: false, err: String(e?.message || e) });
      }
    }
  };

  await run('HOLD', HOLD, holdCase);
  await run('PIVOT', PIVOT, pivotCase);
  await run('EDGE', EDGE, edgeCase);

  const passes = results.filter((r) => r.ok).length;
  const total = results.length;
  const byCls = {};
  for (const r of results) {
    byCls[r.cls] ??= { pass: 0, total: 0 };
    byCls[r.cls].total += 1;
    if (r.ok) byCls[r.cls].pass += 1;
  }

  console.log('\n======== SUMMARY ========');
  for (const [k, v] of Object.entries(byCls)) {
    console.log(`${k}: ${v.pass}/${v.total}`);
  }
  const fails = results.filter((r) => !r.ok);
  if (fails.length) {
    console.log('FAILED:');
    for (const f of fails) console.log(`  - [${f.cls}] ${f.id}${f.err ? ` (${f.err})` : ''}`);
  }
  console.log(`\n=== ${passes}/${total} hard-pass ===`);
  console.log(`ended ${new Date().toISOString()}`);
  process.exit(passes === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
