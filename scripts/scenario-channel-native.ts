/**
 * Channel-NATIVE dual scenarios (dev observation only).
 *
 * Advisor ≠ chat. Do NOT mirror the same lines across doors.
 *
 *   ADVISOR — structured brief prefs, project_id focus, hub/visit chips.
 *   CHAT    — WhatsApp free-text buyer; different order, voice, and goals.
 *
 *   npx tsx scripts/scenario-channel-native.ts
 */
const BASE = (process.env.CONVERSE_SPINE_URL ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev').replace(
  /\/$/,
  '',
);
const BUILDER = process.env.SCENARIO_BUILDER_ID ?? 'brigade-group';
const TS = Date.now();

type Row = {
  door: 'advisor' | 'chat';
  n: number;
  label: string;
  text: string;
  reply: string;
  phase?: string;
  ui?: string;
  goal?: string;
  prefs?: unknown;
  projects?: string[];
  focused?: string;
  visit?: string;
  engaged?: string[];
  note?: string;
};

const rows: Row[] = [];

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: 'bad_json', status: res.status }));
  return { http: res.status, json };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function print(r: Row) {
  console.log(`\n[${r.door.toUpperCase()} ${r.n}] ${r.label}`);
  console.log(`  buyer> ${r.text}`);
  console.log(`  bot  > ${r.reply.slice(0, 260)}`);
  console.log(
    `  meta  phase=${r.phase ?? '—'} ui=${r.ui ?? '—'} goal=${r.goal ?? '—'} focus=${r.focused ?? '—'}`,
  );
  if (r.prefs) console.log(`  prefs ${JSON.stringify(r.prefs)}`);
  if (r.projects?.length) console.log(`  projects ${r.projects.join(' | ')}`);
  if (r.visit) console.log(`  visit  ${r.visit}`);
  if (r.engaged?.length) console.log(`  engaged ${r.engaged.join(',')}`);
  if (r.note) console.log(`  NOTE  ${r.note}`);
}

/**
 * ADVISOR door — mimics the SPA contract, not WhatsApp speech.
 * Brief arrives as preferences{}; focus uses project_id; hub/visit use chip lines.
 */
async function runAdvisorNative() {
  const sid = `native-adv-${TS}`;
  console.log(`\n######## ADVISOR-NATIVE (chip/SPA contract) session=${sid} ########`);

  const steps: Array<{
    label: string;
    text: string;
    preferences?: Record<string, string>;
    project_id?: string;
    board_tab?: string;
  }> = [
    // Mid-brief: UI would only toggle local state — we deliberately send a
    // partial prefs merge the way scheduleBriefDispatch does NOT (only full brief).
    // This probes "2 BHK selected but server doesn't know yet".
    {
      label: 'A01 partial prefs — bhk only (before Continue/full brief)',
      text: '2 BHK',
      preferences: { bhk: '2 BHK', property_type: 'Apartment' },
    },
    // Full brief dispatch (formatBriefForBot + prefsToAdvisorPreferences shape).
    {
      label: 'A02 full brief dispatch after Continue on last multi step',
      text: 'Self-use · Apartment · 2 BHK · Whitefield · ₹70L–1 Cr · Daily traffic',
      preferences: {
        purpose: 'self_use',
        property_type: 'Apartment',
        bhk: '2 BHK',
        location: 'Whitefield',
        budget: '₹70L–1 Cr',
        worries: 'Daily traffic',
      },
    },
    // Priority chip answer (advisor soft signal).
    { label: 'A03 priority chip', text: 'Shorter commute' },
    // Board focus: SPA sends project_id, not "the first one".
    { label: 'A04 open board project via project_id', text: 'Show overview', project_id: '__FIRST__' },
    { label: 'A05 focused price chip', text: 'Starting prices', project_id: '__FOCUS__' },
    // Hub chip — exact Advisor label.
    { label: 'A06 hub chip Back to my matches', text: 'Back to my matches' },
    // Open a *different* match via project_id (browse without visit intent).
    { label: 'A07 open second match via project_id', text: 'Show overview', project_id: '__SECOND__' },
    // Return to first via project_id.
    { label: 'A08 return to first via project_id', text: 'Show overview', project_id: '__FIRST__' },
    // Visit chip shape from planVisitDay when UI wrongly passes ALL engaged —
    // we ALSO send the correct single-project shape to contrast.
    {
      label: 'A09 visit chip — SINGLE named (correct buyer intent)',
      text: 'Plan a visit to __FIRST_NAME__',
      project_id: '__FIRST__',
    },
    { label: 'A10 visit day spoken on advisor board', text: 'Saturday morning' },
    { label: 'A11 confirm chip-ish', text: 'Yes' },
    // The buggy UI line: planVisitDay joins all engaged names.
    {
      label: 'A12 BUG-SHAPE — Plan visits to ALL engaged (UI planVisitDay)',
      text: 'Plan visits to __ALL_ENGAGED_NAMES__',
    },
  ];

  let n = 0;
  let firstId = '';
  let firstName = '';
  let secondId = '';
  let secondName = '';
  let focusId = '';
  let engagedNames: string[] = [];

  for (const step of steps) {
    n += 1;
    await sleep(650);

    let text = step.text
      .replace('__FIRST_NAME__', firstName || 'the focused project')
      .replace(
        '__ALL_ENGAGED_NAMES__',
        engagedNames.length ? engagedNames.join(', ') : 'Brigade Meadows, Brigade Sanctuary',
      );
    let project_id = step.project_id;
    if (project_id === '__FIRST__') project_id = firstId || undefined;
    if (project_id === '__SECOND__') project_id = secondId || undefined;
    if (project_id === '__FOCUS__') project_id = focusId || firstId || undefined;

    const { http, json } = await post('/api/advisor/turn', {
      session_id: sid,
      builder_id: BUILDER,
      text,
      ...(step.preferences ? { preferences: step.preferences } : {}),
      ...(project_id ? { project_id } : {}),
      ...(step.board_tab ? { board_tab: step.board_tab } : {}),
    });

    const projects = (json.projects ?? []) as Array<{ id?: string; name?: string; tradeoff_note?: string }>;
    if (projects.length >= 1 && !firstId) {
      firstId = projects[0].id ?? '';
      firstName = projects[0].name ?? '';
    }
    if (projects.length >= 2 && !secondId) {
      secondId = projects[1].id ?? '';
      secondName = projects[1].name ?? '';
    }
    if (json.focused_project?.project_id) {
      focusId = json.focused_project.project_id;
      if (!firstId) {
        firstId = focusId;
        firstName = json.focused_project.name ?? firstName;
      }
    }
    const engaged = (json.checklist_snapshot?.engaged_project_ids ?? []) as string[];
    if (engaged.length) {
      // Keep names for bug-shape turn from projects we've seen.
      const nameById = new Map<string, string>();
      if (firstId) nameById.set(firstId, firstName);
      if (secondId) nameById.set(secondId, secondName);
      for (const p of projects) if (p.id && p.name) nameById.set(p.id, p.name);
      engagedNames = engaged.map((id) => nameById.get(id) ?? id);
    }

    const vq = json.visit_queue;
    const vi = json.visit_itinerary;
    const visitBits = [
      vq
        ? `queue=${[vq.active?.project_id, ...(vq.queued ?? []).map((q: any) => q.project_id)].filter(Boolean).join(',')}`
        : null,
      vi?.stops?.length ? `itinerary=${vi.stops.map((s: any) => s.project_id).join(',')}` : null,
      json.visit_booked ? `booked=${json.visit_booked.project_id}` : null,
    ]
      .filter(Boolean)
      .join('; ');

    let note: string | undefined;
    if (step.label.startsWith('A01') && !json.prefs_snapshot?.bhk) {
      note = 'BHK not in prefs_snapshot yet (matches mid-brief local-only feel)';
    }
    if (step.label.startsWith('A02') && json.prefs_snapshot?.bhk) {
      note = `BHK landed after full brief: ${json.prefs_snapshot.bhk}`;
    }
    if (step.label.startsWith('A12')) {
      const ids = [
        ...(vq?.active ? [vq.active.project_id] : []),
        ...((vq?.queued ?? []).map((q: any) => q.project_id) as string[]),
      ];
      note =
        ids.length > 1
          ? `FAIL multi-project visit from engaged dump (${ids.join(',')})`
          : `queue stayed single/empty (${ids.join(',') || 'none'}) — UI bug may still send multi names`;
    }

    const row: Row = {
      door: 'advisor',
      n,
      label: step.label,
      text,
      reply: String(json.reply ?? json.error ?? ''),
      phase: json.phase,
      ui: json.ui_mode,
      goal: json.debug?.goal?.kind ?? json.goal_kind,
      prefs: json.prefs_snapshot,
      projects: projects.map((p) => `${p.name}${p.tradeoff_note ? `[${p.tradeoff_note}]` : ''}`),
      focused: json.focused_project?.name,
      visit: visitBits || undefined,
      engaged,
      note,
    };
    if (http !== 200) row.note = `HTTP ${http}`;
    rows.push(row);
    print(row);
  }
}

/**
 * CHAT door — WhatsApp-shaped free text. Different buyer, different sequence,
 * no project_id, no preferences{}, no "Back to my matches" / chip vocabulary.
 *
 * Buyer persona: busy NRI spouse texting briefly; cares about RERA + one site visit
 * near airport corridor, not Whitefield commute ranking.
 */
async function runChatNative() {
  const phone = `9198${String(TS).slice(-8)}`;
  console.log(`\n######## CHAT-NATIVE (WhatsApp free-text) phone=${phone} ########`);

  const steps: Array<{ label: string; text: string }> = [
    { label: 'C01 cold open', text: 'hi' },
    {
      label: 'C02 inventory ask (no full brief dump)',
      text: 'any projects near airport / Devanahalli under 60L?',
    },
    { label: 'C03 config refine', text: 'prefer 2bhk only' },
    { label: 'C04 reject first vibe', text: 'not that one, something else' },
    { label: 'C05 name pick if offered', text: 'ok tell me about Cornerstone' },
    { label: 'C06 legal ask (WA typical)', text: 'rera and khata?' },
    { label: 'C07 soft no to visit yet', text: 'not ready to visit, just checking' },
    { label: 'C08 spouse switch project', text: 'what about Eldorado instead' },
    { label: 'C09 price there', text: 'ballpark for 2bhk' },
    {
      label: 'C10 visit ONE only — natural WA',
      text: 'can we do site visit only for Eldorado this weekend',
    },
    { label: 'C11 time', text: 'Sunday afternoon' },
    { label: 'C12 confirm', text: 'yes book it' },
    {
      label: 'C13 anti-multi check',
      text: 'pls dont add Cornerstone or others to the visit',
    },
  ];

  let n = 0;
  let conversation_id: string | undefined;

  for (const step of steps) {
    n += 1;
    await sleep(650);
    const { http, json } = await post('/chat', {
      builder_id: BUILDER,
      buyer_phone: phone,
      text: step.text,
      channel: 'whatsapp',
      ...(conversation_id ? { conversation_id } : {}),
    });
    conversation_id = json.conversation_id ?? json.conversationId ?? conversation_id;

    const reply = String(json.reply ?? json.message ?? json.error ?? '');
    let note: string | undefined;
    if (/cornerstone|meadows|sanctuary|orchards/i.test(reply) && /eldorado/i.test(step.text)) {
      // soft signal only
    }
    if (step.label.startsWith('C10') || step.label.startsWith('C12') || step.label.startsWith('C13')) {
      const multi =
        (reply.match(/Brigade [A-Z][a-z]+/g) ?? []).filter((x, i, a) => a.indexOf(x) === i);
      if (multi.length > 1) note = `possible multi-project mention: ${multi.join(', ')}`;
      else if (/eldorado/i.test(reply)) note = 'stayed on Eldorado (good)';
      else note = 'check focus — Eldorado not clearly in reply';
    }
    if (http !== 200) note = `HTTP ${http}`;

    const row: Row = {
      door: 'chat',
      n,
      label: step.label,
      text: step.text,
      reply,
      phase: json.phase,
      goal: json.goal_kind ?? json.goal,
      projects: (json.projects ?? json.matches ?? []).map((p: any) => p.name ?? p.project_id),
      focused: json.focused_project?.name ?? json.focus?.name,
      note,
    };
    rows.push(row);
    print(row);
  }
}

function verdict() {
  console.log('\n######## VERDICT (channel-native — not parallel scripts) ########');
  console.log('\nAdvisor probes (SPA contract):');
  for (const r of rows.filter((x) => x.door === 'advisor' && x.note)) {
    console.log(`  • ${r.label}: ${r.note}`);
  }
  console.log('\nChat probes (WhatsApp voice):');
  for (const r of rows.filter((x) => x.door === 'chat' && x.note)) {
    console.log(`  • ${r.label}: ${r.note}`);
  }
  console.log(`\nTarget ${BASE} | rows ${rows.length}`);
  console.log('These scenarios are intentionally DIFFERENT buyers and DIFFERENT contracts.');
}

async function main() {
  console.log(`Channel-native scenarios @ ${BASE} builder=${BUILDER}`);
  await runAdvisorNative();
  await runChatNative();
  verdict();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
