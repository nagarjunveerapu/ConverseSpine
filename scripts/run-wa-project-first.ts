/**
 * WA project-first walk — LLD §9.1 ship gate, no Meta account needed.
 *
 * Drives the packer + minimal brief end to end on the engine fakes
 * (Hi → Help me choose → size → budget → pick → price → EMI → visit →
 * Projects → an unrouted statement) and asserts the locked-funnel gates.
 * Writes the conversation to docs/reports/wa-project-first-walk.html.
 *
 *   npx tsx scripts/run-wa-project-first.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEngineTurn, type WaPacked } from '../src/engine/turn.js';
import { fakeDeps } from '../tests/fakes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

interface Row {
  who: 'buyer' | 'bot';
  text: string;
  actionId?: string;
  goal?: string;
  chrome?: WaPacked;
}

const rows: Row[] = [];
const failures: string[] = [];

function gate(label: string, ok: boolean): void {
  if (!ok) failures.push(label);
  console.log(`${ok ? '  ✓' : '  ✗ GATE'} ${label}`);
}

function chromeText(packed: WaPacked | undefined): string {
  if (!packed || packed.kind === 'text') return '';
  if (packed.kind === 'buttons') {
    return packed.buttons.map((b) => `[ ${b.title} ]`).join('  ');
  }
  const rowsTxt = packed.sections
    .flatMap((s) => s.rows)
    .map((r) => `• ${r.title}${r.description ? ` — ${r.description}` : ''}`)
    .join('\n');
  return `≡ ${packed.button}\n${rowsTxt}`;
}

async function main(): Promise<void> {
  const deps = { ...fakeDeps(), waProjectFirst: true };
  const turn = async (text: string, actionId?: string) => {
    const result = await runEngineTurn(
      {
        convId: 'wa-walk',
        builderId: 'lokations',
        text,
        buyerPhone: '+919999990000',
        channel: 'whatsapp',
        ...(actionId ? { action_id: actionId } : {}),
      },
      deps,
    );
    rows.push({ who: 'buyer', text, ...(actionId ? { actionId } : {}) });
    rows.push({
      who: 'bot',
      text: result.reply,
      goal: result.debug.goal.kind,
      ...(result.whatsappInteractive ? { chrome: result.whatsappInteractive } : {}),
    });
    console.log(`\n> ${actionId ? `(tap ${actionId}) ` : ''}${text}`);
    console.log(result.reply.split('\n').map((l) => `  ${l}`).join('\n'));
    const chrome = chromeText(result.whatsappInteractive);
    if (chrome) console.log(chrome.split('\n').map((l) => `  ${l}`).join('\n'));
    return result;
  };

  console.log('— flag ON: builder-allotted book with size → area → budget —');

  const t1 = await turn('Hi');
  gate('greet shows the book, no Advisor interview', !/what brings you here|worries|commute/i.test(t1.reply));
  gate(
    'greet doors include Help me find a home',
    t1.whatsappInteractive?.kind === 'buttons' &&
      t1.whatsappInteractive.buttons[0]!.id === 'wa.menu.choose',
  );

  const t2 = await turn('Help me find a home', 'wa.menu.choose');
  gate(
    'Help me find a home opens the size sheet',
    t2.whatsappInteractive?.kind === 'list' && t2.whatsappInteractive.button === 'Choose bedrooms',
  );

  const t3 = await turn('3 BHK', 'wa.bhk.3_bhk');
  gate(
    'size answer opens the live area sheet',
    t3.whatsappInteractive?.kind === 'list' && t3.whatsappInteractive.button === 'Choose area',
  );
  gate(
    'area rows are catalog ids, not Advisor loc ids',
    t3.whatsappInteractive?.kind === 'list' &&
      t3.whatsappInteractive.sections[0]!.rows.some((r) => r.id.startsWith('wa.area.')) &&
      !t3.whatsappInteractive.sections[0]!.rows.some((r) => r.id.startsWith('wa.brief.loc.')),
  );
  const t3b = await turn('Any area', 'wa.area.any');
  gate(
    'area answer opens the budget bands',
    t3b.whatsappInteractive?.kind === 'list' && t3b.whatsappInteractive.button === 'Set budget',
  );
  const bandId =
    t3b.whatsappInteractive?.kind === 'list' ? t3b.whatsappInteractive.sections[0]!.rows[1]!.id : 'wa.budget.any';
  const bandTitle =
    t3b.whatsappInteractive?.kind === 'list' ? t3b.whatsappInteractive.sections[0]!.rows[1]!.title : 'Any budget';

  const t4 = await turn(bandTitle, bandId);
  gate(
    'budget answer closes the brief',
    t4.debug.goal.kind === 'recommend' || t4.debug.goal.kind === 'no_fit' || t4.debug.goal.kind === 'clarify_intent',
  );
  gate(
    'reply names the size cut',
    /3 BHK/i.test(t4.reply) || /home fits/i.test(t4.reply) || /don't have/i.test(t4.reply),
  );

  const t5 = await turn('Brigade Eldorado', 'wa.pick.eldorado');
  gate('pick names Eldorado', /Brigade Eldorado/.test(t5.reply));
  gate(
    'pick packs a project file, not the greet doors',
    t5.whatsappInteractive?.kind === 'list' || t5.whatsappInteractive?.kind === 'buttons',
  );

  const t6 = await turn('Price', 'wa.money.menu');
  // The money door opens a menu whose rows are the project's OWN configs —
  // "Price / EMI" used to promise EMI in the label and never deliver it.
  gate('price tap opens the money menu', t6.whatsappInteractive?.kind === 'list');
  gate(
    'money menu is a list with a total-cost or EMI row',
    t6.whatsappInteractive?.kind === 'list' &&
      t6.whatsappInteractive.sections[0]!.rows.some(
        (r) => r.id === 'wa.money.emi' || r.id.startsWith('wa.money.') || r.id.startsWith('wa.node.money'),
      ),
  );

  const t7 = await turn('what about emi for 20 years?');
  gate('typed facet ask stays focused', !!t7.state.focus && t7.state.focus.projectId === 'eldorado');

  const t8 = await turn('Book a visit', 'visit_book');
  gate(
    'visit ask offers real dates from the builder hours, plus a way back',
    t8.whatsappInteractive?.kind === 'list' &&
      t8.whatsappInteractive.sections[0]!.rows.filter((r) => r.id.startsWith('wa.day.')).length >= 2 &&
      t8.whatsappInteractive.sections[0]!.rows.some((r) => r.id === 'wa.menu.projects' || r.title.startsWith('←')),
  );

  const t9 = await turn('sunday 12');
  gate('typed day+time rides the visit FSM', /sunday/i.test(t9.reply));

  const t10 = await turn('Projects', 'wa.menu.projects');
  gate('Projects clears focus and re-offers the book', !t10.state.focus && t10.whatsappInteractive?.kind === 'list');

  const t11 = await turn('something green side, near hills');
  gate(
    'unrouted statement gets an honest miss or the three doors, not the Advisor interview',
    t11.debug.goal.kind === 'clarify_intent' ||
      t11.debug.goal.kind === 'no_fit' ||
      t11.debug.goal.kind === 'recommend',
  );
  gate(
    'chrome stays doors or a list, never purpose/worries',
    t11.whatsappInteractive?.kind === 'buttons' || t11.whatsappInteractive?.kind === 'list',
  );

  // Locked funnel: live catalog area is allowed. Advisor interview is not.
  const forbiddenProbe =
    /\b(?:what brings you here|part of the city|purpose|self.use|investment or|worries|worried|schools?|commute hub)\b/i;
  const leaks = rows.filter((r) => r.who === 'bot' && forbiddenProbe.test(r.text));
  gate(
    `no reply asks purpose/city/worries/schools/commute${leaks.length ? ` (leaked: "${leaks[0]!.text.slice(0, 60)}…")` : ''}`,
    leaks.length === 0,
  );

  console.log('\n— flag OFF: same walk must fall back to the Advisor path —');
  const offDeps = fakeDeps();
  const off = await runEngineTurn(
    { convId: 'wa-walk-off', builderId: 'lokations', text: 'Hi', buyerPhone: '+919999990001', channel: 'whatsapp' },
    offDeps,
  );
  gate('flag off: no packer payload', off.whatsappInteractive === undefined);

  const reportDir = join(ROOT, 'docs', 'reports');
  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, 'wa-project-first-walk.html');
  writeFileSync(reportPath, renderHtml(rows, failures));
  console.log(`\nreport: ${reportPath}`);

  if (failures.length) {
    console.error(`\n${failures.length} gate(s) failed`);
    process.exit(1);
  }
  console.log('all gates green');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderHtml(transcript: Row[], failed: string[]): string {
  const bubbles = transcript
    .map((r) => {
      const chrome = r.chrome ? `<pre class="chrome">${esc(chromeText(r.chrome))}</pre>` : '';
      const meta = r.who === 'bot' ? `<div class="meta">goal: ${esc(r.goal ?? '')}</div>` : r.actionId ? `<div class="meta">tap · ${esc(r.actionId)}</div>` : '';
      return `<div class="m ${r.who}"><div class="b">${esc(r.text).replace(/\n/g, '<br>')}</div>${chrome}${meta}</div>`;
    })
    .join('\n');
  const banner = failed.length
    ? `<p class="bad">${failed.length} gate(s) failed: ${esc(failed.join('; '))}</p>`
    : `<p class="ok">All gates green.</p>`;
  return `<!doctype html><meta charset="utf-8"><title>WA project-first walk</title>
<style>
body{margin:0;background:#efe7dc;font:14px/1.45 -apple-system,"Segoe UI",sans-serif;color:#1b1f1c}
.wrap{max-width:520px;margin:0 auto;padding:24px 14px 60px}
h1{font-size:18px}
.ok{color:#00705c;font-weight:600}.bad{color:#b3423a;font-weight:600}
.m{margin:8px 0;display:flex;flex-direction:column}
.m.buyer{align-items:flex-end}.m.bot{align-items:flex-start}
.b{max-width:86%;padding:8px 11px;border-radius:9px;box-shadow:0 1px 1px rgba(0,0,0,.08);white-space:pre-wrap}
.buyer .b{background:#d9fdd3}.bot .b{background:#fff}
.chrome{max-width:86%;background:#fff;border-radius:9px;padding:8px 11px;margin:4px 0 0;color:#00806e;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;box-shadow:0 1px 1px rgba(0,0,0,.08)}
.meta{font:10.5px ui-monospace,Menlo,monospace;color:#8b9287;margin-top:3px}
</style>
<div class="wrap"><h1>WA project-first walk — engine fakes</h1>${banner}${bubbles}</div>`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
