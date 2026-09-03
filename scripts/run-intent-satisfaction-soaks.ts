#!/usr/bin/env npx tsx
/**
 * Intent-satisfaction soaks — founder-read, not assert-theatre.
 *
 * Each journey starts from a buyer INTENT + their own language, then runs a
 * long interested thread (12–20+ turns). Output is a transcript board with
 * empty "intent satisfied?" grades for a human — no PASS claimed by the script.
 *
 *   CONVERSE_SPINE_URL=http://127.0.0.1:8789 npx tsx scripts/run-intent-satisfaction-soaks.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SPINE = (
  process.env.CONVERSE_SPINE_URL ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev'
).replace(/\/+$/, '');

type Journey = {
  id: string;
  /** What the buyer actually wants fulfilled — judge THIS, not substrings. */
  intent: string;
  /** How they'd describe themselves (tone / language). */
  voice: string;
  builder_id: string;
  /** Natural turns — no assert objects. Length = interested buyer. */
  turns: string[];
  /** Questions the founder answers after reading the transcript. */
  judge: string[];
};

/**
 * Intent-first journeys. Deliberately NOT the same discover→name→price skeleton.
 * Digressions, self-corrections, emotional beats, and long follow-through.
 */
const JOURNEYS: Journey[] = [
  {
    id: 'INT-AIRPORT-FAMILY',
    intent:
      'Family of 4 wants a livable 3BHK near the airport under ~1.2 Cr, then needs to trust price + schools enough to book a Saturday visit.',
    voice: 'Hesitant parent, mixes English/Hinglish, changes mind twice, asks side questions.',
    builder_id: 'brigade-group',
    turns: [
      'hi… looking for something for my family',
      'we are 4 people, kids school age',
      'airport side maybe? not sure about budget yet',
      'ok say around 1 Cr something',
      '3 bedroom please',
      'hmm which one feels less crowded',
      'wait that Eldorado one — is it actually ready or under construction?',
      'schools around there? my daughter is in 5th',
      'price for 3bhk specifically not the starting from poster',
      'thoda mehengaa lag raha hai yaar',
      'koi cheaper option same area?',
      'ok orchards dikhao then',
      'same question — 3bhk price and schools',
      'if we visit can we see a 3bhk sample flat',
      'saturday morning possible? coming from whitefield',
      'actually make it sunday if saturday full',
      'before I confirm — loan banks?',
      'ok book sunday morning orchards',
      'thanks — and send brochure also',
    ],
    judge: [
      'Did the bot wait for enough brief before dumping a board?',
      'When they said too expensive, did it help (cheaper / adjust) or dead-end?',
      'Was Orchards 3BHK price + schools actually answered (not maintenance spam)?',
      'Did visit logistics (day + origin Whitefield) get collected without restarting search?',
      'Would a real parent feel ready to show up Sunday?',
    ],
  },
  {
    id: 'INT-INVEST-COORG',
    intent:
      'NRI-flavoured investor wants managed plantation near Coorg/Sakleshpur under 75L, cares about yield/operator more than BHK, then compares two and picks one to dig into.',
    voice: 'Direct, slightly impatient, Hinglish numbers, no apartment vocabulary.',
    builder_id: 'lokations',
    turns: [
      'hello',
      'looking at plantation investment not flat',
      'coorg or sakleshpur side under 75 lakh',
      'managed preferably — I am not there to farm',
      'what returns do people usually see',
      'ayana vs krishnaja — which is better for passive',
      'ayana details',
      'operator model? who manages',
      'possession / when can trees be productive',
      'price breakdown and any hidden charges',
      'compare again with krishnaja on price and location',
      'ok stick with ayana',
      'brochure and site visit options',
      'I am in bangalore next month first week',
      'can someone call me or do I just book here',
      'wait also is this agricultural land rera or what',
      'ok if legal is clear send brochure',
      'and hold the visit thought — first I want a callback',
    ],
    judge: [
      'Did it avoid forcing BHK on an investment plantation brief?',
      'Were yield/operator answers honest (or clearly "not on file") — no invented %?',
      'Did compare → focus stick on Ayana without dumping WA card spam?',
      'Legal/RERA for agri — honest, not apartment boilerplate?',
      'Callback/handoff clear vs vague someone-will-call?',
    ],
  },
  {
    id: 'INT-CHAOS-SWITCHER',
    intent:
      'Curious browser who keeps switching projects and topics; eventual intent is pick ONE project and get a clear price they trust.',
    voice: 'Scattered WhatsApp energy — typos, half thoughts, "wait", emoji-less but messy.',
    builder_id: 'brigade-group',
    turns: [
      'hi',
      '2bhk north blr',
      'budget?? idk 80L maybe',
      'show',
      'eldorado',
      'pics?',
      'actually orchards better?',
      'price',
      'rera?',
      'buena vista kya hai',
      'compare orchards and buena',
      'nah orchards only',
      'maintenance kitna',
      'carpet area 2bhk',
      'wait go back — eldorado price again',
      'confusing yaar which is closer to airport',
      'ok eldorado then',
      'final price for 2bhk and can i visit',
      'tomorrow evening?',
      'my wife will come too — any docs to bring',
    ],
    judge: [
      'After all the switching, did the last focus (Eldorado) stick for price+visit?',
      'Any ghost compare / wrong project facts mid-thread?',
      'Was "confused which closer to airport" answered with real geography?',
      'Visit ask — collected day or restarted the whole discovery?',
      'Did the bot feel patient with scatter, or procedural/robotic?',
    ],
  },
  {
    id: 'INT-OUTSIDER-THEN-PIVOT',
    intent:
      'Starts asking Mumbai (wrong market), then pivots to Bangalore once told; still wants a home, not a lecture.',
    voice: 'Out-of-town buyer, polite, slightly embarrassed after the miss.',
    builder_id: 'brigade-group',
    turns: [
      'Hi looking for 2 BHK in Andheri West under 1.5 Cr',
      'really nothing in mumbai?',
      'ok fine bangalore then — same budget 2bhk',
      'north side near airport if possible',
      'what do you have',
      'tell me honestly which one you would pick for a first home',
      'eldorado seems ok — possession?',
      'pricing for 2bhk',
      'any known issues / complaints',
      'if I say too expensive what else under 70L',
      'orchards?',
      'difference between orchards and eldorado in one short para',
      'ok orchards — brochure',
      'and can someone from sales talk tomorrow afternoon',
    ],
    judge: [
      'Mumbai/Andheri — refused without silently showing Bangalore board?',
      'After pivot, did it rebuild brief cleanly (not stuck on Andheri)?',
      'Recommendation feel consultative or dump-list?',
      'Objection/cheaper path useful?',
      'Handoff to sales concrete?',
    ],
  },
  {
    id: 'INT-DEEP-ORCHARDS',
    intent:
      'Already half-sold on Brigade Orchards; wants a long diligence chat (price, legal, schools, payment, visit) before committing — interested buyer, 15+ turns on ONE project.',
    voice: 'Serious, detailed, stays on one project; expects memory.',
    builder_id: 'brigade-group',
    turns: [
      'hi I already like Brigade Orchards — heard from a friend',
      '2 bhk ivory if you have',
      'full price with all charges not just bsp',
      'payment plan / CLP?',
      'khata and rera number please',
      'ec clear?',
      'which banks for home loan',
      'schools and hospital distance',
      'how far from kempegowda airport roughly',
      'any construction delay history you know of',
      'ok what configs left for 2bhk',
      'can I hold a unit or only visit first',
      'visit this weekend saturday 11',
      'coming from hebbal',
      'if saturday full sunday also fine',
      'one more — floor plan pdf',
      'and confirm you still remember orchards not eldorado',
      'book it',
    ],
    judge: [
      'Did it honor named-project entry (not force a fresh North Bangalore search)?',
      'Diligence facets — price/legal/schools/loan — each real or honest miss?',
      'Any project leak to Eldorado despite "remember orchards"?',
      'Hold vs visit — clear, not inventing a holdable unit?',
      'Long thread — still coherent at the end, or amnesiac?',
    ],
  },
];

async function chat(builderId: string, phone: string, text: string, threadId?: string) {
  const r = await fetch(`${SPINE}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      builder_id: builderId,
      buyer_phone: phone,
      text,
      ...(threadId ? { thread_id: threadId } : {}),
    }),
  });
  const body = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(body.error ?? `HTTP ${r.status}`));
  const debug = (body.debug as Record<string, unknown>) ?? {};
  return {
    reply: String(body.reply_text ?? body.reply ?? ''),
    thread_id: String(body.thread_id ?? ''),
    goal: debug.goal,
    phase: debug.phase,
    tools: debug.tools,
  };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function main() {
  const health = await fetch(`${SPINE}/health`)
    .then((r) => r.json())
    .catch(() => null);
  if (!health || (health as { status?: string }).status !== 'ok') {
    console.error('Spine not up:', SPINE);
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(ROOT, 'docs/reports/quality-factory-2026-08-12', `intent-soaks-${stamp}`);
  mkdirSync(runDir, { recursive: true });
  console.log(`Intent-satisfaction soaks → ${SPINE}\n${runDir}\n`);
  console.log('No auto PASS. You grade intent satisfaction in the HTML.\n');

  const all: Array<{
    id: string;
    intent: string;
    voice: string;
    builder_id: string;
    judge: string[];
    turns: Array<{
      index: number;
      buyer: string;
      reply: string;
      phase?: unknown;
      goal?: unknown;
      error?: string;
    }>;
  }> = [];

  for (const j of JOURNEYS) {
    console.log(`══ ${j.id} (${j.turns.length} turns) — ${j.intent.slice(0, 72)}…`);
    const phone = `+9198${Date.now().toString().slice(-10)}`;
    let conv: string | undefined;
    const turns: (typeof all)[0]['turns'] = [];

    for (let i = 0; i < j.turns.length; i++) {
      const text = j.turns[i]!;
      try {
        const resp = await chat(j.builder_id, phone, text, conv);
        conv = resp.thread_id || conv;
        turns.push({
          index: i + 1,
          buyer: text,
          reply: resp.reply,
          phase: resp.phase,
          goal: resp.goal,
        });
        process.stdout.write(`  t${i + 1}/${j.turns.length}\r`);
        await new Promise((r) => setTimeout(r, 280));
      } catch (e) {
        turns.push({
          index: i + 1,
          buyer: text,
          reply: '',
          error: e instanceof Error ? e.message : String(e),
        });
        console.log(`  ✗ t${i + 1} ${e}`);
        break;
      }
    }
    console.log(`  done ${turns.length} turns`);
    const rec = {
      id: j.id,
      intent: j.intent,
      voice: j.voice,
      builder_id: j.builder_id,
      judge: j.judge,
      turns,
    };
    all.push(rec);
    writeFileSync(join(runDir, `${j.id}.json`), JSON.stringify(rec, null, 2));
  }

  writeFileSync(join(runDir, 'summary.json'), JSON.stringify({ spine: SPINE, at: stamp, journeys: all }, null, 2));

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Intent satisfaction — founder read</title>
<style>
  :root {
    --ink: #1c1917;
    --muted: #57534e;
    --paper: #faf7f2;
    --card: #fffefb;
    --line: #e7e0d5;
    --buyer: #1d4ed8;
    --bot: #292524;
    --warn: #9a3412;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Source Serif 4", "Iowan Old Style", Georgia, serif;
    background:
      radial-gradient(ellipse at 10% 0%, #f0e6d8 0%, transparent 50%),
      var(--paper);
    color: var(--ink);
    line-height: 1.5;
  }
  header {
    padding: 2.5rem 1.5rem 1rem;
    max-width: 820px;
    margin: 0 auto;
  }
  header h1 {
    font-family: "DM Sans", "Helvetica Neue", sans-serif;
    font-size: 1.75rem;
    font-weight: 700;
    letter-spacing: -0.03em;
    margin: 0 0 0.5rem;
  }
  header p { color: var(--muted); margin: 0.35rem 0; max-width: 40rem; }
  .nav {
    display: flex; flex-wrap: wrap; gap: 0.5rem;
    max-width: 820px; margin: 0 auto 1.5rem; padding: 0 1.5rem;
    font-family: "DM Sans", sans-serif; font-size: 0.85rem;
  }
  .nav a {
    color: var(--ink); text-decoration: none;
    border: 1px solid var(--line); background: var(--card);
    padding: 0.35rem 0.7rem; border-radius: 999px;
  }
  .nav a:hover { border-color: #a8a29e; }
  article {
    max-width: 820px; margin: 0 auto 2.5rem; padding: 0 1.5rem;
  }
  .intent-card {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 1.25rem 1.35rem;
    margin-bottom: 1rem;
  }
  .intent-card h2 {
    font-family: "DM Sans", sans-serif;
    font-size: 1.15rem;
    margin: 0 0 0.5rem;
    letter-spacing: -0.02em;
  }
  .label { font-family: "DM Sans", sans-serif; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  .thread { margin: 1rem 0 1.5rem; }
  .turn {
    display: grid;
    grid-template-columns: 4.5rem 1fr;
    gap: 0.6rem;
    padding: 0.85rem 0;
    border-bottom: 1px solid var(--line);
  }
  .turn:last-child { border-bottom: 0; }
  .meta { font-family: "DM Sans", sans-serif; font-size: 0.7rem; color: var(--muted); padding-top: 0.15rem; }
  .buyer { color: var(--buyer); font-weight: 600; margin: 0 0 0.35rem; }
  .bot { margin: 0; white-space: pre-wrap; color: var(--bot); }
  .err { color: var(--warn); font-family: "DM Sans", sans-serif; font-size: 0.85rem; }
  .judge {
    background: #fff7ed;
    border: 1px solid #fed7aa;
    border-radius: 12px;
    padding: 1rem 1.2rem;
  }
  .judge h3 { font-family: "DM Sans", sans-serif; font-size: 0.95rem; margin: 0 0 0.6rem; }
  .judge li { margin: 0.45rem 0; }
  .grade {
    font-family: "DM Sans", sans-serif;
    font-size: 0.8rem;
    color: var(--muted);
    border-bottom: 1px dashed #fdba74;
    display: inline-block;
    min-width: 8rem;
    margin-left: 0.35rem;
  }
  footer {
    max-width: 820px; margin: 0 auto; padding: 1rem 1.5rem 3rem;
    font-family: "DM Sans", sans-serif; font-size: 0.8rem; color: var(--muted);
  }
</style>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@500;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap" rel="stylesheet"/>
</head>
<body>
<header>
  <h1>Intent satisfaction soaks</h1>
  <p>Not assert theatre. Each thread starts from a buyer <strong>intent</strong> and their language, then runs a long interested conversation. You decide if the intent was satisfied.</p>
  <p>${esc(SPINE)} · ${esc(stamp)} · ${JOURNEYS.length} journeys · avg ~${Math.round(JOURNEYS.reduce((n, j) => n + j.turns.length, 0) / JOURNEYS.length)} turns</p>
</header>
<nav class="nav">
  ${all.map((j) => `<a href="#${esc(j.id)}">${esc(j.id)}</a>`).join('')}
</nav>
${all
  .map(
    (j) => `
<article id="${esc(j.id)}">
  <div class="intent-card">
    <div class="label">Buyer intent</div>
    <h2>${esc(j.id)}</h2>
    <p>${esc(j.intent)}</p>
    <p><span class="label">Voice</span> ${esc(j.voice)}</p>
    <p><span class="label">Builder</span> ${esc(j.builder_id)} · ${j.turns.length} turns recorded</p>
  </div>
  <div class="thread">
    ${j.turns
      .map(
        (t) => `
    <div class="turn">
      <div class="meta">t${t.index}<br/>${esc(String((t.goal as { kind?: string } | undefined)?.kind ?? t.phase ?? ''))}</div>
      <div>
        <p class="buyer">${esc(t.buyer)}</p>
        ${t.error ? `<p class="err">${esc(t.error)}</p>` : `<p class="bot">${esc(t.reply)}</p>`}
      </div>
    </div>`,
      )
      .join('')}
  </div>
  <div class="judge">
    <h3>Your grades (fill by hand)</h3>
    <ol>
      ${j.judge.map((q) => `<li>${esc(q)} <span class="grade">Y / N / partial</span></li>`).join('')}
    </ol>
    <p><span class="label">Overall intent satisfied?</span> <span class="grade">________ / 10</span></p>
  </div>
</article>`,
  )
  .join('')}
<footer>
  Generated by <code>scripts/run-intent-satisfaction-soaks.ts</code>.
  Script never marks PASS — only records the chat for human judgment.
</footer>
</body>
</html>`;

  const htmlPath = join(runDir, 'intent-board.html');
  writeFileSync(htmlPath, html);
  writeFileSync(join(ROOT, 'docs/reports/quality-factory-2026-08-12/intent-board-latest.html'), html);
  console.log(`\nBoard → ${htmlPath}`);
  console.log(`Latest → docs/reports/quality-factory-2026-08-12/intent-board-latest.html`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
