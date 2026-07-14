/**
 * Careful dual-path scenario: Advisor door vs /chat (WhatsApp-shaped).
 *
 * Probes the bugs reported after tradeoff deploy (dev only):
 *   A) 2 BHK selected in brief — does server constraints.bhk stick on first search?
 *   B) Focus ONE project, then "plan a visit" — does visit queue stay single-project?
 *   C) Exploring 3 matches then "plan visit day" with only one named — scope leakage?
 *
 * Usage:
 *   npx tsx scripts/scenario-advisor-vs-chat-careful.ts
 *   CONVERSE_SPINE_URL=http://127.0.0.1:8789 npx tsx scripts/scenario-advisor-vs-chat-careful.ts
 *
 * Observation only — does not change product code.
 */
const BASE = (process.env.CONVERSE_SPINE_URL ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev').replace(
  /\/$/,
  '',
);
const BUILDER = process.env.SCENARIO_BUILDER_ID ?? 'brigade-group';
const TS = Date.now();

type TurnLog = {
  path: 'advisor' | 'chat';
  n: number;
  label: string;
  text: string;
  http: number;
  reply: string;
  phase?: string;
  uiMode?: string;
  goal?: string;
  prefs?: Record<string, unknown> | null;
  projects?: Array<{ id?: string; name?: string; tradeoff_note?: string }>;
  visitQueue?: unknown;
  visitBooked?: unknown;
  visitItinerary?: unknown;
  checklist?: unknown;
  focused?: unknown;
  rawKeys?: string[];
  notes: string[];
};

const logs: TurnLog[] = [];

async function postJson(path: string, body: unknown): Promise<{ http: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ parse_error: true, status: res.status }));
  return { http: res.status, json };
}

function summarizeAdvisor(n: number, label: string, text: string, http: number, j: any): TurnLog {
  const notes: string[] = [];
  const prefs = j.prefs_snapshot ?? null;
  const projects = (j.projects ?? []).map((p: any) => ({
    id: p.id ?? p.project_id,
    name: p.name,
    tradeoff_note: p.tradeoff_note,
  }));
  if (prefs && !prefs.bhk) notes.push('WARN: prefs_snapshot missing bhk');
  if (label.includes('after-brief') && prefs?.bhk) notes.push(`OK: bhk=${prefs.bhk}`);
  if (label.includes('visit') && j.visit_queue) {
    const q = j.visit_queue;
    const ids = [
      ...(q.active ? [q.active.project_id] : []),
      ...((q.queued ?? []).map((x: any) => x.project_id) as string[]),
    ];
    notes.push(`visit_queue_ids=${ids.join(',') || '(empty)'}`);
  }
  if (j.visit_itinerary?.stops?.length) {
    notes.push(`itinerary_stops=${j.visit_itinerary.stops.map((s: any) => s.project_id || s.name).join(',')}`);
  }
  if (j.checklist_snapshot?.engaged_project_ids?.length) {
    notes.push(`engaged=${(j.checklist_snapshot.engaged_project_ids as string[]).join(',')}`);
  }
  return {
    path: 'advisor',
    n,
    label,
    text,
    http,
    reply: String(j.reply ?? j.error ?? '').slice(0, 280),
    phase: j.phase,
    uiMode: j.ui_mode,
    goal: j.debug?.goal?.kind ?? j.goal_kind,
    prefs,
    projects,
    visitQueue: j.visit_queue ?? null,
    visitBooked: j.visit_booked ?? null,
    visitItinerary: j.visit_itinerary ?? null,
    checklist: j.checklist_snapshot ?? null,
    focused: j.focused_project ? { id: j.focused_project.project_id, name: j.focused_project.name } : null,
    rawKeys: Object.keys(j),
    notes,
  };
}

function summarizeChat(n: number, label: string, text: string, http: number, j: any): TurnLog {
  const notes: string[] = [];
  const reply = String(j.reply ?? j.message ?? j.error ?? '').slice(0, 280);
  const projects = (j.projects ?? j.matches ?? []).map((p: any) => ({
    id: p.id ?? p.project_id,
    name: p.name,
  }));
  if (/visit|site visit|saturday|slot/i.test(reply)) notes.push('reply mentions visit');
  return {
    path: 'chat',
    n,
    label,
    text,
    http,
    reply,
    phase: j.phase,
    goal: j.goal_kind ?? j.goal,
    projects,
    visitQueue: j.visit_queue ?? null,
    visitBooked: j.visit_booked ?? null,
    notes,
  };
}

function printTurn(t: TurnLog) {
  console.log(`\n── ${t.path.toUpperCase()} T${t.n}: ${t.label} ──`);
  console.log(`> ${t.text}`);
  console.log(`HTTP ${t.http} | phase=${t.phase ?? '—'} | ui=${t.uiMode ?? '—'} | goal=${t.goal ?? '—'}`);
  console.log(`← ${t.reply}`);
  if (t.prefs) console.log(`prefs ${JSON.stringify(t.prefs)}`);
  if (t.projects?.length) {
    console.log(
      `projects (${t.projects.length}): ${t.projects.map((p) => `${p.name}${p.tradeoff_note ? ` [${p.tradeoff_note}]` : ''}`).join(' | ')}`,
    );
  }
  if (t.focused) console.log(`focused ${JSON.stringify(t.focused)}`);
  if (t.visitQueue) console.log(`visit_queue ${JSON.stringify(t.visitQueue)}`);
  if (t.visitBooked) console.log(`visit_booked ${JSON.stringify(t.visitBooked)}`);
  if (t.visitItinerary) console.log(`visit_itinerary ${JSON.stringify(t.visitItinerary).slice(0, 400)}`);
  if (t.checklist) console.log(`checklist ${JSON.stringify(t.checklist)}`);
  for (const n of t.notes) console.log(`★ ${n}`);
}

async function runAdvisorPath() {
  const sid = `careful-adv-${TS}`;
  console.log(`\n========== ADVISOR PATH session=${sid} builder=${BUILDER} ==========`);

  // Simulate UI brief: one merged preferences payload (what scheduleBriefDispatch sends).
  // Separately we also probe a mid-brief "2 BHK only" turn to see if server ignores it.
  const turns: Array<{ label: string; text: string; preferences?: Record<string, string>; project_id?: string }> = [
    {
      label: '01-mid-brief-bhk-only',
      text: '2 BHK',
      preferences: { bhk: '2 BHK' },
    },
    {
      label: '02-full-brief-dispatch',
      text: 'Self-use apartment, 2 BHK, Whitefield, budget ₹70L–1 Cr. Worried about daily traffic.',
      preferences: {
        purpose: 'self_use',
        budget: '₹70L–1 Cr',
        property_type: 'Apartment',
        bhk: '2 BHK',
        location: 'Whitefield',
        worries: 'Daily traffic',
      },
    },
    { label: '03-priority-commute', text: 'Shorter commute' },
    { label: '04-list-ack', text: 'ok show me those' },
    { label: '05-focus-ONE', text: 'Tell me more about the first one' },
    { label: '06-price-on-focus', text: 'What are the starting prices?' },
    { label: '07-back-matches', text: 'Back to my matches' },
    { label: '08-browse-second', text: 'Tell me more about the second match' },
    { label: '09-browse-third-if-any', text: 'And the third one briefly?' },
    { label: '10-return-to-first', text: 'Back to the first project please' },
    {
      label: '11-visit-ONE-named',
      text: 'Plan a visit to only the first project — not the others',
    },
    { label: '12-visit-day', text: 'This Saturday morning works' },
    { label: '13-confirm-scope', text: 'Just that one project, confirm' },
    { label: '14-plan-visit-day-chip-shaped', text: 'Plan a visit day' },
  ];

  let n = 0;
  let focusId: string | undefined;
  let projectIds: string[] = [];

  for (const turn of turns) {
    n += 1;
    await new Promise((r) => setTimeout(r, 700));
    let text = turn.text;
    let project_id = turn.project_id;

    // Resolve "first/second/third" against last shortlist once we have projects.
    if (turn.label === '05-focus-ONE' && projectIds[0]) {
      project_id = projectIds[0];
      text = `Tell me more about ${projectIds[0]}`;
    }
    if (turn.label === '08-browse-second' && projectIds[1]) {
      project_id = projectIds[1];
      text = `Tell me more about ${projectIds[1]}`;
    }
    if (turn.label === '09-browse-third-if-any' && projectIds[2]) {
      project_id = projectIds[2];
      text = `Brief overview of ${projectIds[2]}`;
    } else if (turn.label === '09-browse-third-if-any' && !projectIds[2]) {
      text = 'Any other match worth a look?';
    }
    if (turn.label === '10-return-to-first' && projectIds[0]) {
      project_id = projectIds[0];
      text = `Tell me more about ${projectIds[0]} again`;
    }
    if (turn.label === '11-visit-ONE-named' && projectIds[0]) {
      project_id = projectIds[0];
      text = `Plan a visit to ${projectIds[0]} only — skip the other projects`;
    }

    const body: Record<string, unknown> = {
      session_id: sid,
      builder_id: BUILDER,
      text,
      ...(turn.preferences ? { preferences: turn.preferences } : {}),
      ...(project_id ? { project_id } : {}),
    };
    const { http, json } = await postJson('/api/advisor/turn', body);
    const log = summarizeAdvisor(n, turn.label, text, http, json);
    if (json.projects?.length) {
      projectIds = json.projects.map((p: any) => p.id ?? p.project_id).filter(Boolean);
    }
    if (json.focused_project?.project_id) focusId = json.focused_project.project_id;
    if (turn.label.startsWith('05') || turn.label.startsWith('10')) {
      log.notes.push(`resolved_focus_candidate=${project_id ?? focusId ?? 'none'}`);
    }
    logs.push(log);
    printTurn(log);
  }
}

async function runChatPath() {
  const phone = `91${String(TS).slice(-10)}`;
  console.log(`\n========== CHAT PATH (/chat) phone=${phone} builder=${BUILDER} ==========`);

  const turns: Array<{ label: string; text: string }> = [
    { label: '01-open', text: 'Hi looking for a home' },
    { label: '02-brief', text: 'Self use 2 BHK apartment in Whitefield under 1 crore' },
    { label: '03-commute', text: 'Shorter commute to ITPL matters more than budget' },
    { label: '04-pick-first', text: 'Tell me more about the first one' },
    { label: '05-price', text: 'Starting price?' },
    { label: '06-visit-one', text: 'I want to visit only this project this Saturday' },
    { label: '07-confirm', text: 'Yes confirm the visit' },
    { label: '08-more-options', text: 'Show me other options too' },
    { label: '09-second', text: 'What about the second project briefly?' },
    { label: '10-visit-slip', text: 'Plan a visit day' },
    { label: '11-scope-check', text: 'Wait — only the first project, not all of them' },
    { label: '12-final', text: 'Confirm Saturday morning for just that one' },
  ];

  let n = 0;
  let conversation_id: string | undefined;
  for (const turn of turns) {
    n += 1;
    await new Promise((r) => setTimeout(r, 700));
    const { http, json } = await postJson('/chat', {
      builder_id: BUILDER,
      buyer_phone: phone,
      text: turn.text,
      channel: 'whatsapp',
      ...(conversation_id ? { conversation_id } : {}),
    });
    conversation_id = json.conversation_id ?? json.conversationId ?? conversation_id;
    const log = summarizeChat(n, turn.label, turn.text, http, json);
    logs.push(log);
    printTurn(log);
  }
}

function verdict() {
  console.log('\n========== VERDICT (evidence-only) ==========');
  const adv = logs.filter((l) => l.path === 'advisor');
  const chat = logs.filter((l) => l.path === 'chat');

  const mid = adv.find((l) => l.label === '01-mid-brief-bhk-only');
  const full = adv.find((l) => l.label === '02-full-brief-dispatch');
  console.log('\n[A] BHK timing');
  console.log(
    `  mid-brief prefs.bhk=${mid?.prefs?.bhk ?? '(none)'} | projects=${mid?.projects?.length ?? 0} | reply=${mid?.reply?.slice(0, 120)}`,
  );
  console.log(
    `  full-brief prefs.bhk=${full?.prefs?.bhk ?? '(none)'} | projects=${full?.projects?.length ?? 0}`,
  );
  if (!mid?.prefs?.bhk && full?.prefs?.bhk) {
    console.log('  FINDING: BHK only lands after full brief dispatch — matches "not going then shows later".');
  }

  const visitNamed = adv.find((l) => l.label === '11-visit-ONE-named');
  const visitDay = adv.find((l) => l.label === '14-plan-visit-day-chip-shaped');
  const browse = adv.filter((l) => /browse|return-to-first|focus-ONE/.test(l.label));
  const engaged = browse.map((l) => l.checklist).filter(Boolean);
  console.log('\n[B] Visit scope (Advisor)');
  console.log(`  after browsing, last checklist=${JSON.stringify(engaged.at(-1) ?? null)}`);
  console.log(`  visit-ONE-named queue=${JSON.stringify(visitNamed?.visitQueue ?? null)}`);
  console.log(`  visit-ONE-named booked=${JSON.stringify(visitNamed?.visitBooked ?? null)}`);
  console.log(`  visit-ONE-named itinerary=${JSON.stringify(visitNamed?.visitItinerary ?? null)?.slice(0, 300)}`);
  console.log(`  "Plan a visit day" reply=${visitDay?.reply?.slice(0, 200)}`);
  console.log(`  "Plan a visit day" queue=${JSON.stringify(visitDay?.visitQueue ?? null)}`);

  console.log('\n[C] Chat path visit');
  for (const l of chat.filter((x) => /visit|scope|final|confirm/.test(x.label))) {
    console.log(`  ${l.label}: ${l.reply.slice(0, 180)}`);
  }

  console.log('\n[D] Soft prefs / tradeoff notes on recommend');
  const rec = adv.find((l) => (l.projects?.length ?? 0) > 0);
  console.log(`  first shortlist notes: ${(rec?.projects ?? []).map((p) => p.tradeoff_note).join(' || ') || '(none)'}`);

  console.log(`\nTarget: ${BASE}`);
  console.log(`Turns logged: ${logs.length}`);
}

async function main() {
  console.log(`Careful dual-path scenario @ ${BASE}`);
  await runAdvisorPath();
  await runChatPath();
  verdict();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
