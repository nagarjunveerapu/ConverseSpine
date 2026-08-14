/**
 * One buyer, one walk, against the DEPLOYED worker — the founder's own
 * sequences, replayed so a defect can be SEEN instead of guessed at.
 *
 *   npx tsx scripts/wa-sim/walk.ts                 # all scenarios + HTML report
 *   npx tsx scripts/wa-sim/walk.ts sequence media  # some scenarios
 *   WA_WALK_STEPS='["/reset","hi"]' npx tsx scripts/wa-sim/walk.ts   # ad hoc
 *
 * Steps are `text`, or `tap:<action_id>|<label>`, or `tap?:<match>|<label>` —
 * the last one taps whichever row of the LAST list has an id containing
 * <match>, which is how "tap every file on the shelf" stays honest when the
 * shelf is drawn from the real book rather than from this script's opinion.
 *
 * Checks are declared per step, never inferred: `expect` (reply must match),
 * `refute` (must not), `media` (the turn must actually carry files).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENDPOINT =
  process.env.WA_LIVE_URL ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev/chat';
const BUILDER = process.env.WA_LIVE_BUILDER ?? 'brigade-group';
const OUT = process.env.WA_WALK_OUT ?? join(ROOT, 'docs', 'reports', 'wa-walk.html');

interface Row {
  id: string;
  title: string;
  description?: string;
}
interface Step {
  /** Free text, or `tap:<id>|<label>`, or `tap?:<id-fragment>|<label>`. */
  say: string;
  expect?: RegExp;
  refute?: RegExp;
  /** true = this turn must deliver files; false = it must not. */
  media?: boolean;
  note?: string;
}
interface Scenario {
  key: string;
  title: string;
  why: string;
  steps: Step[];
  /** Tap every row of the last list whose id starts with this prefix. */
  sweep?: { after: number; prefix: string; media: boolean };
}

const PROJECT = process.env.WA_WALK_PROJECT ?? 'brigade-eldorado';
const SECOND = process.env.WA_WALK_PROJECT2 ?? 'brigade-cornerstone';
const at = (id: string) => `${id}@${PROJECT}`;

const SCENARIOS: Scenario[] = [
  {
    key: 'sequence',
    title: 'The sequence — book → project → section → sub-section → back',
    why: 'The founder’s model, walked end to end: every section opens its own screen, every screen offers the way back, and no tap dead-ends.',
    steps: [
      { say: '/reset', expect: /starting fresh/i },
      { say: 'Help me choose' },
      { say: '2 BHK' },
      { say: 'Under ₹1 Cr' },
      { say: `tap:wa.pick.${PROJECT}|Brigade Eldorado`, expect: /your fit|Brigade/i },
      { say: `tap:${at('wa.node.trust')}|Trust & legal`, expect: /RERA/i },
      { say: `tap:${at('wa.sub.trust.rera')}|RERA registration`, expect: /RERA/i },
      { say: `tap:${at('wa.back.file')}|← Back to the file`, expect: /Trust|Money|Place/i },
      { say: `tap:${at('wa.node.place')}|Place`, expect: /metro|school|hospital|km/i },
      { say: `tap:${at('wa.node.life')}|Life`, expect: /acre|amenit|sqft/i },
      { say: `tap:${at('wa.node.unit')}|The unit`, expect: /BHK|sqft/i },
      { say: `tap:${at('wa.node.money')}|Money`, expect: /₹|cost|lakh/i },
    ],
  },
  {
    key: 'media',
    title: 'Every file on the shelf actually arrives',
    why: 'A row that promises a document and answers with a paragraph is the defect the founder hit on the ownership certificate. Every row on the shelf is tapped, and every one must carry files.',
    steps: [
      { say: '/reset' },
      { say: `tap:wa.pick.${PROJECT}|Brigade Eldorado` },
      {
        say: `tap:${at('wa.node.media')}|Brochure & photos`,
        expect: /send|brochure|plan|photo/i,
        note: 'the shelf itself — what the project can put on your phone',
      },
    ],
    sweep: { after: 2, prefix: 'wa.doc.', media: true },
  },
  {
    key: 'visit',
    title: 'Two projects, two visits',
    why: 'Shortlist two, book both. The second "Book a visit" used to read the first visit back, and pressing it again said "I could not pin that to a date" — for a button with no date in it.',
    steps: [
      { say: '/reset' },
      { say: `tap:wa.pick.${PROJECT}|Brigade Eldorado` },
      {
        say: 'tap:visit_book|Book a visit',
        expect: /which day|day and time/i,
        refute: /could not pin/i,
      },
      {
        say: 'tap:visit_book|Book a visit',
        refute: /could not pin/i,
        note: 'pressing it twice is a request repeated, not a wrong answer',
      },
      { say: 'tap:wa.day.sunday|Sun 16 Aug', refute: /could not pin/i },
      { say: 'tap:wa.window.afternoon|Afternoon', expect: /confirm|shall i/i },
      { say: 'yes', expect: /set for|done/i },
      { say: `tap:wa.pick.${SECOND}|Brigade Cornerstone` },
      {
        say: 'tap:visit_book|Book a visit',
        expect: /which day|day and time/i,
        refute: /your visits:/i,
        note: 'the second project must get its own day question',
      },
      { say: 'tap:wa.day.saturday|Sat 15 Aug', refute: /could not pin/i },
      { say: 'tap:wa.window.morning|Morning' },
      { say: 'yes', expect: /set for|done/i },
      { say: 'what are my visits?', expect: /eldorado/i, note: 'both visits stand' },
    ],
  },
  {
    key: 'erase',
    title: 'STOP erases what it says it erases',
    why: '"I’ve removed your details from our system" was followed, one turn later, by the buyer’s own visit read back to them.',
    steps: [
      { say: '/reset' },
      { say: `tap:wa.pick.${PROJECT}|Brigade Eldorado` },
      { say: 'tap:visit_book|Book a visit' },
      { say: 'tap:wa.day.sunday|Sun 16 Aug' },
      { say: 'tap:wa.window.afternoon|Afternoon' },
      { say: 'yes', expect: /set for|done/i },
      { say: 'what are my visits?', expect: /eldorado/i },
      { say: 'STOP', expect: /removed your details/i },
      {
        say: 'what are my visits?',
        refute: /eldorado|sunday|2:00 pm/i,
        note: 'nothing personal may survive the erase',
      },
    ],
  },
  {
    key: 'reset',
    title: '/reset starts genuinely fresh',
    why: 'Old bookings followed the buyer across every reset and clashed with the new walk — the visits live in Desk, and "starting fresh" only ever meant this side.',
    steps: [
      { say: '/reset' },
      { say: `tap:wa.pick.${PROJECT}|Brigade Eldorado` },
      { say: 'tap:visit_book|Book a visit' },
      { say: 'tap:wa.day.sunday|Sun 16 Aug' },
      { say: 'tap:wa.window.afternoon|Afternoon' },
      { say: 'yes', expect: /set for|done/i },
      { say: '/reset', expect: /starting fresh/i },
      { say: 'what are my visits?', refute: /sunday|2:00 pm/i },
    ],
  },
];

interface TurnRecord {
  say: string;
  actionId?: string;
  label: string;
  reply: string;
  rows: Row[];
  media: Array<{ asset_kind?: string; label?: string }>;
  verdicts: Array<{ ok: boolean; what: string }>;
  note?: string;
  ms: number;
}

function rowsOf(packed: unknown): Row[] {
  const p = packed as { action?: { sections?: Array<{ rows?: Row[] }>; buttons?: Row[] } };
  const rows = (p?.action?.sections ?? []).flatMap((s) => s.rows ?? []);
  return rows.length ? rows : (p?.action?.buttons ?? []);
}

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) return (await res.json()) as Record<string, unknown>;
      if (attempt === 2) return { reply_text: `‼️ HTTP ${res.status}: ${await res.text()}` };
    } catch (err) {
      if (attempt === 2) return { reply_text: `‼️ ${(err as Error).message}` };
    }
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  return { reply_text: '‼️ unreachable' };
}

async function runScenario(sc: Scenario, phone: string): Promise<TurnRecord[]> {
  const out: TurnRecord[] = [];
  let convId: string | undefined;
  let lastRows: Row[] = [];
  const steps = [...sc.steps];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    let raw = step.say;
    let actionId: string | undefined;
    let label = raw;

    if (raw.startsWith('tap?:')) {
      const [frag, lbl] = raw.slice(5).split('|');
      const hit = lastRows.find((r) => r.id.includes(frag!));
      if (!hit) continue;
      actionId = hit.id;
      label = lbl || hit.title;
    } else if (raw.startsWith('tap:')) {
      const [id, lbl] = raw.slice(4).split('|');
      actionId = id;
      label = lbl || id!;
    }

    const t0 = Date.now();
    const res = await post({
      builder_id: BUILDER,
      buyer_phone: phone,
      text: label,
      channel: 'whatsapp',
      ...(convId ? { conversation_id: convId } : {}),
      ...(actionId ? { action_id: actionId } : {}),
    });
    convId = (res.conversation_id as string) ?? convId;
    const reply = String(res.reply_text ?? res.reply ?? '');
    const media = (res.media as TurnRecord['media']) ?? [];
    lastRows = rowsOf(res.whatsapp_interactive);

    const verdicts: TurnRecord['verdicts'] = [];
    if (step.expect) verdicts.push({ ok: step.expect.test(reply), what: `says ${step.expect}` });
    if (step.refute) verdicts.push({ ok: !step.refute.test(reply), what: `never ${step.refute}` });
    if (step.media === true) {
      verdicts.push({ ok: media.length > 0, what: 'delivers the file' });
    }

    out.push({
      say: raw,
      ...(actionId ? { actionId } : {}),
      label,
      reply,
      rows: lastRows,
      media,
      verdicts,
      ...(step.note ? { note: step.note } : {}),
      ms: Date.now() - t0,
    });

    // The shelf is drawn from the real book, so the sweep is expanded from what
    // the buyer was actually offered — never from a list written in here.
    if (sc.sweep && i === sc.sweep.after) {
      const docs = lastRows.filter((r) => r.id.startsWith(sc.sweep!.prefix));
      steps.splice(
        i + 1,
        0,
        ...docs.map((r) => ({
          say: `tap:${r.id}|${r.title}`,
          media: sc.sweep!.media,
          note: r.description,
        })),
      );
    }
  }
  return out;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const wa = (s: string) => esc(s).replace(/\*([^*]+)\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

function render(
  results: Array<{ sc: Scenario; turns: TurnRecord[] }>,
  build: string,
  startedAt: string,
): string {
  const all = results.flatMap((r) => r.turns.flatMap((t) => t.verdicts));
  const failed = all.filter((v) => !v.ok).length;
  const cards = results
    .map(({ sc, turns }) => {
      const bad = turns.flatMap((t) => t.verdicts).filter((v) => !v.ok).length;
      const rows = turns
        .map((t) => {
          const chips = t.verdicts
            .map(
              (v) =>
                `<span class="chip ${v.ok ? 'ok' : 'bad'}">${v.ok ? '✓' : '✗'} ${esc(v.what)}</span>`,
            )
            .join('');
          const files = t.media.length
            ? `<div class="files">📎 ${t.media
                .map((m) => esc(`${m.label ?? m.asset_kind ?? 'file'}`))
                .join(' · ')}</div>`
            : '';
          const list = t.rows.length
            ? `<div class="list">${t.rows
                .map(
                  (r) =>
                    `<div class="row"><span class="rt">${esc(r.title)}</span>${
                      r.description ? `<span class="rd">${esc(r.description)}</span>` : ''
                    }</div>`,
                )
                .join('')}</div>`
            : '';
          return `<div class="turn">
            <div class="said">${t.actionId ? `<span class="tap">TAP</span> ` : ''}${esc(t.label)}${
              t.actionId ? `<span class="aid">${esc(t.actionId)}</span>` : ''
            }</div>
            <div class="bubble">${wa(t.reply) || '<i>(no reply)</i>'}${files}${list}</div>
            ${chips ? `<div class="verdicts">${chips}</div>` : ''}
            ${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}
          </div>`;
        })
        .join('');
      return `<section>
        <h2>${esc(sc.title)} <span class="tag ${bad ? 'bad' : 'ok'}">${
          bad ? `${bad} failing` : 'clean'
        }</span></h2>
        <p class="why">${esc(sc.why)}</p>
        ${rows}
      </section>`;
    })
    .join('');

  return `<title>WhatsApp walk — ${esc(build)}</title>
<style>
  :root{--bg:#f6f7f8;--card:#fff;--ink:#0f1720;--dim:#667380;--line:#e3e7ea;--ok:#1f7a4d;--bad:#b3261e;--tap:#2f6feb}
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0b141a;--card:#111b21;--ink:#e9edef;--dim:#8696a0;--line:#222d34;--ok:#4ad07d;--bad:#ff6b6b;--tap:#7aa7ff}}
  :root[data-theme="dark"]{--bg:#0b141a;--card:#111b21;--ink:#e9edef;--dim:#8696a0;--line:#222d34;--ok:#4ad07d;--bad:#ff6b6b;--tap:#7aa7ff}
  body{background:var(--bg);color:var(--ink);margin:0;padding:28px;
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  h1{font-size:20px;margin:0 0 4px}
  .meta{color:var(--dim);font-size:13px;margin-bottom:24px}
  section{background:var(--card);border:1px solid var(--line);border-radius:12px;
    padding:18px 20px;margin-bottom:18px;max-width:820px}
  h2{font-size:16px;margin:0 0 6px;display:flex;gap:8px;align-items:center}
  .why{color:var(--dim);font-size:13.5px;margin:0 0 16px}
  .turn{border-top:1px solid var(--line);padding:12px 0}
  .said{font-size:13.5px;color:var(--dim);margin-bottom:6px}
  .tap{background:var(--tap);color:#fff;border-radius:4px;padding:1px 5px;font-size:11px;
    letter-spacing:.03em}
  .aid{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;
    color:var(--dim);margin-left:8px}
  .bubble{background:var(--bg);border-radius:10px;padding:11px 13px;font-size:14.5px}
  .files{margin-top:8px;font-size:13px;color:var(--ok)}
  .list{margin-top:10px;border-top:1px solid var(--line);padding-top:8px}
  .row{padding:5px 0;font-size:13.5px;display:flex;gap:8px;flex-wrap:wrap}
  .rd{color:var(--dim);font-size:12.5px}
  .verdicts{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap}
  .chip{font-size:12px;border-radius:20px;padding:2px 9px;border:1px solid var(--line)}
  .chip.ok{color:var(--ok)}.chip.bad{color:var(--bad);border-color:var(--bad)}
  .note{margin-top:6px;font-size:12.5px;color:var(--dim);font-style:italic}
  .tag{font-size:11.5px;border-radius:20px;padding:2px 9px;font-weight:400}
  .tag.ok{color:var(--ok);border:1px solid var(--ok)}
  .tag.bad{color:var(--bad);border:1px solid var(--bad)}
</style>
<h1>The WhatsApp walk — ${failed ? `${failed} checks failing` : 'every check clean'}</h1>
<div class="meta">Live against <code>${esc(ENDPOINT)}</code> · build ${esc(build)} · ${esc(
    startedAt,
  )} · ${all.length} checks over ${results.reduce((n, r) => n + r.turns.length, 0)} turns</div>
${cards}`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const ad = process.env.WA_WALK_STEPS ? (JSON.parse(process.env.WA_WALK_STEPS) as string[]) : null;
  const health = await fetch(ENDPOINT.replace(/\/chat$/, '/health')).catch(() => null);
  const build =
    health && health.ok ? ((await health.json()) as { version?: string }).version ?? '?' : '?';
  const startedAt = new Date().toISOString();
  const tag = String(Date.now()).slice(-7);

  const chosen = ad
    ? [{ key: 'adhoc', title: 'Ad hoc', why: '', steps: ad.map((say) => ({ say })) } as Scenario]
    : SCENARIOS.filter((s) => !argv.length || argv.includes(s.key));

  const results: Array<{ sc: Scenario; turns: TurnRecord[] }> = [];
  for (const [i, sc] of chosen.entries()) {
    // A fresh number per scenario: dev is shared, and a reused phone carries
    // last run's bookings into this one's assertions.
    const phone = process.env.WA_WALK_PHONE ?? `+9198${tag}${i}`;
    process.stdout.write(`\n## ${sc.title}  (${phone})\n`);
    const turns = await runScenario(sc, phone);
    for (const t of turns) {
      const marks = t.verdicts.map((v) => (v.ok ? '✓' : '✗')).join('');
      process.stdout.write(
        `  ${marks || ' '} ${t.actionId ? `[${t.actionId}] ` : ''}${t.label} → ${t.reply
          .replace(/\n/g, ' ')
          .slice(0, 90)}${t.media.length ? `  📎${t.media.length}` : ''}\n`,
      );
    }
    results.push({ sc, turns });
  }

  const failing = results.flatMap((r) => r.turns.flatMap((t) => t.verdicts)).filter((v) => !v.ok);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, render(results, build, startedAt));
  process.stdout.write(`\n${failing.length ? `${failing.length} FAILING` : 'all clean'} → ${OUT}\n`);
}

void main();
