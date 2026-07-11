#!/usr/bin/env npx tsx
/**
 * Adversarial roadmap soak — try to break ConverseSpine on Dev.
 * Covers CONSOLIDATED_ROADMAP golden threads + break attempts for:
 *   - /chat (WhatsApp-shaped bot)
 *   - /api/advisor/turn (NayaAdvisor backend)
 *
 *   CONVERSE_SPINE_URL=https://converse-spine-dev.nagarjun-arjun.workers.dev \
 *     npx tsx scripts/adversarial-roadmap-break.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SPINE = (process.env.CONVERSE_SPINE_URL ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev').replace(
  /\/+$/,
  '',
);

type Channel = 'chat' | 'advisor';

interface CaseResult {
  id: string;
  channel: Channel;
  ok: boolean;
  failures: string[];
  transcript: Array<{ buyer: string; reply: string; meta: Record<string, unknown> }>;
}

const PREFS = {
  purpose: 'Self-use',
  budget: '₹1–1.5 Cr',
  property_type: 'Apartment',
  bhk: '3 BHK',
  location: 'Whitefield',
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function chatTurn(
  builderId: string,
  phone: string,
  text: string,
  convId?: string,
  actionId?: string,
): Promise<{ reply: string; conversation_id: string; debug: Record<string, unknown> }> {
  const r = await fetch(`${SPINE}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      builder_id: builderId,
      buyer_phone: phone,
      text,
      ...(convId ? { conversation_id: convId } : {}),
      ...(actionId ? { action_id: actionId } : {}),
    }),
  });
  const body = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(body.error ?? `HTTP ${r.status}`));
  return {
    reply: String(body.reply_text ?? body.reply ?? ''),
    conversation_id: String(body.conversation_id ?? ''),
    debug: (body.debug as Record<string, unknown>) ?? {},
  };
}

async function advisorTurn(
  sessionId: string,
  text: string,
  opts?: { prefs?: boolean; project_id?: string; action_id?: string; board_tab?: string },
): Promise<{ reply: string; body: Record<string, unknown> }> {
  const payload: Record<string, unknown> = { session_id: sessionId, text };
  if (opts?.prefs) payload.preferences = PREFS;
  if (opts?.project_id) payload.project_id = opts.project_id;
  if (opts?.action_id) payload.action_id = opts.action_id;
  if (opts?.board_tab) payload.board_tab = opts.board_tab;
  const r = await fetch(`${SPINE}/api/advisor/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(body.error ?? `HTTP ${r.status}`));
  return { reply: String(body.reply ?? ''), body };
}

function goalKind(debug: Record<string, unknown> | undefined, body?: Record<string, unknown>): string {
  const g = (debug?.goal ?? body?.goal_kind ?? body?.debug) as Record<string, unknown> | string | undefined;
  if (typeof g === 'string') return g;
  if (g && typeof g === 'object' && 'kind' in g) return String((g as { kind?: string }).kind ?? '');
  if (body?.goal_kind) return String(body.goal_kind);
  const dbg = body?.debug as Record<string, unknown> | undefined;
  const dg = dbg?.goal as { kind?: string } | undefined;
  return dg?.kind ?? '';
}

function focusBlob(debug: Record<string, unknown> | undefined, body?: Record<string, unknown>): string {
  const parts: string[] = [];
  const df = debug?.focus as { projectId?: string; projectName?: string } | undefined;
  if (df?.projectId) parts.push(df.projectId);
  if (df?.projectName) parts.push(df.projectName);
  const fp = body?.focused_project as { project_id?: string; name?: string } | undefined;
  if (fp?.project_id) parts.push(fp.project_id);
  if (fp?.name) parts.push(fp.name);
  const nba = body?.nba as { board_project_id?: string } | undefined;
  if (nba?.board_project_id) parts.push(nba.board_project_id);
  const cs = body?.checklist_snapshot as { focus_project_id?: string; focus_project_name?: string } | undefined;
  if (cs?.focus_project_id) parts.push(cs.focus_project_id);
  if (cs?.focus_project_name) parts.push(cs.focus_project_name);
  return parts.join(' ').toLowerCase();
}

function phaseOf(debug: Record<string, unknown> | undefined, body?: Record<string, unknown>): string {
  return String(debug?.phase ?? body?.phase ?? (body?.debug as { phase?: string } | undefined)?.phase ?? '');
}

function speechAct(debug: Record<string, unknown> | undefined, body?: Record<string, unknown>): string {
  return String(
    debug?.speech_act ??
      body?.speech_act ??
      (body?.debug as { speech_act?: string } | undefined)?.speech_act ??
      '',
  );
}

function nbaChips(body: Record<string, unknown>): string[] {
  const nba = body.nba as { chips?: string[] } | undefined;
  return nba?.chips ?? [];
}

async function runCase(
  id: string,
  channel: Channel,
  fn: (rec: CaseResult) => Promise<void>,
): Promise<CaseResult> {
  const result: CaseResult = { id, channel, ok: true, failures: [], transcript: [] };
  try {
    await fn(result);
  } catch (e) {
    result.ok = false;
    result.failures.push(e instanceof Error ? e.message : String(e));
  }
  if (result.failures.length) result.ok = false;
  const mark = result.ok ? 'PASS' : 'FAIL';
  console.log(`${mark} [${channel}] ${id}${result.failures.length ? ' — ' + result.failures.join('; ') : ''}`);
  return result;
}

function expect(cond: boolean, msg: string, result: CaseResult) {
  if (!cond) result.failures.push(msg);
}

function expectIncludes(hay: string, needle: string, result: CaseResult, label: string) {
  if (!hay.toLowerCase().includes(needle.toLowerCase())) {
    result.failures.push(`${label}: missing "${needle}" in "${hay.slice(0, 120)}"`);
  }
}

function expectExcludes(hay: string, needle: string, result: CaseResult, label: string) {
  if (hay.toLowerCase().includes(needle.toLowerCase())) {
    result.failures.push(`${label}: unexpected "${needle}" in "${hay.slice(0, 120)}"`);
  }
}

async function main() {
  const health = await fetch(`${SPINE}/health`).then((r) => r.json()).catch(() => null);
  if (!health || (health as { status?: string }).status !== 'ok') {
    console.error('Spine not up at', SPINE);
    process.exit(1);
  }
  console.log(`\nAdversarial roadmap break → ${SPINE}\n`);

  const ts = Date.now();
  const results: CaseResult[] = [];

  // ─── CHAT: golden + break ───────────────────────────────────────────

  results.push(
    await runCase('P0-G01-coorg-ayana-depth', 'chat', async (r) => {
      const phone = `+9198${ts}01`;
      let conv: string | undefined;
      for (const text of [
        'looking for a plantation home near Coorg under 1.5 Cr',
        'Ayana looks interesting',
        'whats the cost breakdown',
        'tell me more details about this project',
      ]) {
        const out = await chatTurn('lokations', phone, text, conv);
        conv = out.conversation_id;
        r.transcript.push({ buyer: text, reply: out.reply, meta: { goal: goalKind(out.debug), phase: phaseOf(out.debug) } });
        await sleep(400);
      }
      const last = r.transcript[r.transcript.length - 1]!;
      expectIncludes(last.reply, 'ayana', r, 'stay on Ayana');
      expectExcludes(last.reply.toLowerCase(), "couldn't find", r, 'not lost');
    }),
  );

  results.push(
    await runCase('SA-G01-plot-sizes-not-no-fit', 'chat', async (r) => {
      const phone = `+9198${ts}02`;
      let conv: string | undefined;
      for (const text of ['Whitefield 3BHK apartment under 1.5 Cr', 'Cornerstone Utopia', 'what are the plot sizes / unit sizes?']) {
        const out = await chatTurn('brigade-group', phone, text, conv);
        conv = out.conversation_id;
        r.transcript.push({ buyer: text, reply: out.reply, meta: { goal: goalKind(out.debug), act: speechAct(out.debug) } });
        await sleep(400);
      }
      const last = r.transcript[r.transcript.length - 1]!;
      const g = String(last.meta.goal ?? '');
      expect(g !== 'no_fit', `goal should not be no_fit got ${g}`, r);
      expectExcludes(last.reply, 'tap a button', r, 'no tap-button dodge');
    }),
  );

  results.push(
    await runCase('SA-G02-visit-book-vs-recall', 'chat', async (r) => {
      const phone = `+9198${ts}03`;
      let conv: string | undefined;
      let out = await chatTurn('brigade-group', phone, 'Whitefield 3BHK', conv);
      conv = out.conversation_id;
      out = await chatTurn('brigade-group', phone, 'Eldorado looks good', conv);
      await sleep(300);
      out = await chatTurn('brigade-group', phone, 'lets do a site visit', conv);
      r.transcript.push({ buyer: 'lets do a site visit', reply: out.reply, meta: { goal: goalKind(out.debug), phase: phaseOf(out.debug), act: speechAct(out.debug) } });
      const bookGoal = goalKind(out.debug);
      const bookPhase = phaseOf(out.debug);
      expect(
        bookPhase === 'visit' || bookGoal.startsWith('visit') || /visit|day|schedule|when/i.test(out.reply),
        `book path weak goal=${bookGoal} phase=${bookPhase}`,
        r,
      );
      await sleep(300);
      out = await chatTurn('brigade-group', phone, 'my visits', conv);
      r.transcript.push({ buyer: 'my visits', reply: out.reply, meta: { goal: goalKind(out.debug), phase: phaseOf(out.debug), act: speechAct(out.debug) } });
      // Recall should not re-ask "which day" as if booking fresh without acknowledging recall
      const recallAct = speechAct(out.debug);
      if (recallAct) {
        expect(recallAct !== 'visit_book' || /visit|booked|scheduled|queue/i.test(out.reply), `recall act=${recallAct}`, r);
      }
    }),
  );

  results.push(
    await runCase('SA-G03-compare-both', 'chat', async (r) => {
      const phone = `+9198${ts}04`;
      let conv: string | undefined;
      for (const text of [
        'Whitefield apartments 3BHK',
        'tell me about Eldorado',
        'also about Orchards',
        'compare both',
      ]) {
        const out = await chatTurn('brigade-group', phone, text, conv);
        conv = out.conversation_id;
        r.transcript.push({ buyer: text, reply: out.reply, meta: { goal: goalKind(out.debug), act: speechAct(out.debug) } });
        await sleep(400);
      }
      const last = r.transcript[r.transcript.length - 1]!;
      const reply = last.reply.toLowerCase();
      expect(
        /eldorado/.test(reply) && /orchard/.test(reply),
        'compare should mention both Eldorado and Orchards',
        r,
      );
      expect(String(last.meta.goal) !== 'no_fit', 'compare not no_fit', r);
    }),
  );

  results.push(
    await runCase('ADV-F01-orchards-facets', 'chat', async (r) => {
      const phone = `+9198${ts}05`;
      let conv: string | undefined;
      for (const text of ['Whitefield 3BHK', 'Orchards', 'which banks?', 'is EC clear?', 'starting price?']) {
        const out = await chatTurn('brigade-group', phone, text, conv);
        conv = out.conversation_id;
        r.transcript.push({ buyer: text, reply: out.reply, meta: { goal: goalKind(out.debug) } });
        await sleep(350);
      }
      for (const t of r.transcript.slice(2)) {
        expect(String(t.meta.goal) !== 'no_fit', `facet ${t.buyer} no_fit`, r);
        expectIncludes(t.reply, 'orchard', r, `facet stay ${t.buyer}`);
      }
    }),
  );

  results.push(
    await runCase('ADV-H01-haan-affirm', 'chat', async (r) => {
      const phone = `+9198${ts}06`;
      let conv: string | undefined;
      let out = await chatTurn('brigade-group', phone, 'Whitefield 3BHK apartment', conv);
      conv = out.conversation_id;
      out = await chatTurn('brigade-group', phone, 'Eldorado', conv);
      await sleep(300);
      out = await chatTurn('brigade-group', phone, 'haan', conv);
      r.transcript.push({ buyer: 'haan', reply: out.reply, meta: { goal: goalKind(out.debug), act: speechAct(out.debug) } });
      expectExcludes(out.reply, "didn't catch", r, 'haan understood');
      expect(goalKind(out.debug) !== 'no_fit', 'haan not no_fit', r);
    }),
  );

  results.push(
    await runCase('MEM-G01-legal-then-banks', 'chat', async (r) => {
      const phone = `+9198${ts}07`;
      let conv: string | undefined;
      for (const text of ['Whitefield', 'Orchards', 'legal status?', 'what banks?']) {
        const out = await chatTurn('brigade-group', phone, text, conv);
        conv = out.conversation_id;
        r.transcript.push({ buyer: text, reply: out.reply, meta: { goal: goalKind(out.debug), topic: (out.debug.goal as { topic?: string })?.topic } });
        await sleep(350);
      }
      const last = r.transcript[r.transcript.length - 1]!;
      expectIncludes(last.reply, 'bank', r, 'banks answer');
      expect(String(last.meta.goal) !== 'no_fit', 'banks not no_fit', r);
    }),
  );

  results.push(
    await runCase('RTI-G02-yes-after-pricing-cta', 'chat', async (r) => {
      const phone = `+9198${ts}08`;
      let conv: string | undefined;
      for (const text of ['Whitefield 2BHK', 'Eldorado', 'show 2BHK options', 'yes']) {
        const out = await chatTurn('brigade-group', phone, text, conv);
        conv = out.conversation_id;
        r.transcript.push({
          buyer: text,
          reply: out.reply,
          meta: { goal: goalKind(out.debug), focus: focusBlob(out.debug) },
        });
        await sleep(400);
      }
      const last = r.transcript[r.transcript.length - 1]!;
      expectExcludes(last.reply + ' ' + String(last.meta.focus), 'buena', r, 'yes not Buena Vista');
      expect(String(last.meta.goal) !== 'no_fit', 'yes not no_fit', r);
    }),
  );

  results.push(
    await runCase('P7-G01-chat-starting-prices', 'chat', async (r) => {
      const phone = `+9198${ts}09`;
      let conv: string | undefined;
      for (const text of ['Whitefield 3BHK', 'Cornerstone Utopia', 'Starting prices']) {
        const out = await chatTurn('brigade-group', phone, text, conv);
        conv = out.conversation_id;
        r.transcript.push({ buyer: text, reply: out.reply, meta: { goal: goalKind(out.debug), focus: focusBlob(out.debug) } });
        await sleep(400);
      }
      const last = r.transcript[r.transcript.length - 1]!;
      expect(String(last.meta.goal) !== 'no_fit', 'Starting prices not no_fit', r);
      expectIncludes(last.reply + ' ' + String(last.meta.focus), 'cornerstone', r, 'stay Cornerstone');
      expectExcludes(last.reply + ' ' + String(last.meta.focus), 'buena', r, 'not Buena');
    }),
  );

  results.push(
    await runCase('P7-G02-chat-send-brochure-stickiness', 'chat', async (r) => {
      const phone = `+9198${ts}10`;
      let conv: string | undefined;
      // Vanam is on naya-advisor / lokations catalog — try brigade first then lokations
      for (const text of ['looking near Coorg plantation', 'Vanam', 'Send brochure']) {
        const out = await chatTurn('lokations', phone, text, conv);
        conv = out.conversation_id;
        r.transcript.push({ buyer: text, reply: out.reply, meta: { goal: goalKind(out.debug), focus: focusBlob(out.debug) } });
        await sleep(400);
      }
      const last = r.transcript[r.transcript.length - 1]!;
      expectIncludes(last.reply + ' ' + String(last.meta.focus), 'vanam', r, 'stay Vanam');
      expectExcludes(last.reply + ' ' + String(last.meta.focus), 'buena', r, 'not Buena Vista');
    }),
  );

  results.push(
    await runCase('LOC-G01-north-bangalore', 'chat', async (r) => {
      const phone = `+9198${ts}11`;
      const out = await chatTurn('brigade-group', phone, 'show me projects in North Bangalore under 1.5 Cr 3BHK');
      r.transcript.push({ buyer: 'North Bangalore', reply: out.reply, meta: { goal: goalKind(out.debug) } });
      const reply = out.reply.toLowerCase();
      expect(
        /eldorado|orchard|neo|cornerstone|meadow/i.test(reply),
        'North Bangalore should surface known Brigade projects',
        r,
      );
    }),
  );

  // ─── BREAK ATTEMPTS (chat) ──────────────────────────────────────────

  results.push(
    await runCase('BREAK-chip-spam-rapid-yes', 'chat', async (r) => {
      const phone = `+9198${ts}20`;
      let conv: string | undefined;
      let out = await chatTurn('brigade-group', phone, 'Whitefield 3BHK', conv);
      conv = out.conversation_id;
      out = await chatTurn('brigade-group', phone, 'Eldorado', conv);
      for (const text of ['yes', 'yes', 'ok', 'sure', 'haan']) {
        out = await chatTurn('brigade-group', phone, text, conv);
        r.transcript.push({ buyer: text, reply: out.reply, meta: { goal: goalKind(out.debug) } });
        // Should not invent a different project mid-spam
        expectExcludes(out.reply, 'Buena Vista', r, `spam ${text}`);
        await sleep(200);
      }
    }),
  );

  results.push(
    await runCase('BREAK-switch-mid-facet', 'chat', async (r) => {
      const phone = `+9198${ts}21`;
      let conv: string | undefined;
      for (const text of ['Whitefield', 'Eldorado', 'Starting prices', 'what about Cornerstone?', 'Send brochure']) {
        const out = await chatTurn('brigade-group', phone, text, conv);
        conv = out.conversation_id;
        r.transcript.push({
          buyer: text,
          reply: out.reply,
          meta: { goal: goalKind(out.debug), act: speechAct(out.debug), focus: focusBlob(out.debug) },
        });
        await sleep(350);
      }
      const switchTurn = r.transcript[3]!;
      expectIncludes(switchTurn.reply + ' ' + String(switchTurn.meta.focus), 'cornerstone', r, 'switch to Cornerstone');
      const brochure = r.transcript[4]!;
      expectIncludes(brochure.reply + ' ' + String(brochure.meta.focus), 'cornerstone', r, 'brochure stays Cornerstone');
      expectExcludes(brochure.reply + ' ' + String(brochure.meta.focus), 'eldorado', r, 'brochure not Eldorado');
    }),
  );

  results.push(
    await runCase('BREAK-empty-neo-pricing', 'chat', async (r) => {
      const phone = `+9198${ts}22`;
      let conv: string | undefined;
      for (const text of ['North Bangalore apartments', 'Neo', 'Starting prices']) {
        const out = await chatTurn('brigade-group', phone, text, conv);
        conv = out.conversation_id;
        r.transcript.push({ buyer: text, reply: out.reply, meta: { goal: goalKind(out.debug) } });
        await sleep(350);
      }
      const last = r.transcript[r.transcript.length - 1]!;
      // Honest path: not invent a fake price; not no_fit search
      expect(String(last.meta.goal) !== 'no_fit', 'Neo prices not no_fit search', r);
      expectExcludes(last.reply, '₹0', r, 'no zero-rupee display');
    }),
  );

  results.push(
    await runCase('BREAK-compare-without-pair', 'chat', async (r) => {
      const phone = `+9198${ts}23`;
      let conv: string | undefined;
      let out = await chatTurn('brigade-group', phone, 'Whitefield', conv);
      conv = out.conversation_id;
      out = await chatTurn('brigade-group', phone, 'compare both', conv);
      r.transcript.push({ buyer: 'compare both', reply: out.reply, meta: { goal: goalKind(out.debug) } });
      // Should clarify / ask which — not hallucinate a comparison table of random projects
      expect(
        /which|compare|two|both|pick|projects?/i.test(out.reply),
        'should ask which projects to compare',
        r,
      );
    }),
  );

  results.push(
    await runCase('BREAK-gibberish-then-facet', 'chat', async (r) => {
      const phone = `+9198${ts}24`;
      let conv: string | undefined;
      let out = await chatTurn('brigade-group', phone, 'asdf qwerty zxcv', conv);
      conv = out.conversation_id;
      r.transcript.push({ buyer: 'gibberish', reply: out.reply, meta: { goal: goalKind(out.debug) } });
      out = await chatTurn('brigade-group', phone, 'Eldorado pricing', conv);
      r.transcript.push({ buyer: 'Eldorado pricing', reply: out.reply, meta: { goal: goalKind(out.debug) } });
      expectIncludes(out.reply, 'eldorado', r, 'recover to Eldorado');
      expect(goalKind(out.debug) !== 'no_fit' || /price|₹|lakh|cr/i.test(out.reply), 'pricing recoverable', r);
    }),
  );

  results.push(
    await runCase('BREAK-visit-hijack-from-configs', 'chat', async (r) => {
      const phone = `+9198${ts}25`;
      let conv: string | undefined;
      for (const text of ['Whitefield', 'Eldorado', 'what about the unit configurations?']) {
        const out = await chatTurn('brigade-group', phone, text, conv);
        conv = out.conversation_id;
        r.transcript.push({
          buyer: text,
          reply: out.reply,
          meta: { goal: goalKind(out.debug), phase: phaseOf(out.debug) },
        });
        await sleep(350);
      }
      const last = r.transcript[r.transcript.length - 1]!;
      expect(String(last.meta.goal) !== 'visit_ask', 'configs not visit_ask', r);
      expect(String(last.meta.phase) !== 'visit' || !/which day/i.test(last.reply), 'configs not visit day ask', r);
    }),
  );

  // ─── ADVISOR channel ────────────────────────────────────────────────

  results.push(
    await runCase('ADV-P7-G01-starting-prices', 'advisor', async (r) => {
      const sid = `adv-p7g01-${ts}`;
      await advisorTurn(sid, 'Whitefield', { prefs: true });
      await sleep(300);
      let out = await advisorTurn(sid, 'Cornerstone Utopia looks good');
      r.transcript.push({ buyer: 'pick', reply: out.reply, meta: { focus: focusBlob(undefined, out.body), chips: nbaChips(out.body) } });
      expectIncludes(focusBlob(undefined, out.body), 'cornerstone', r, 'focus Cornerstone');
      await sleep(300);
      out = await advisorTurn(sid, 'Starting prices');
      r.transcript.push({
        buyer: 'Starting prices',
        reply: out.reply,
        meta: { focus: focusBlob(undefined, out.body), goal: goalKind(undefined, out.body), chips: nbaChips(out.body) },
      });
      expectIncludes(focusBlob(undefined, out.body), 'cornerstone', r, 'stay after prices');
      expect(goalKind(undefined, out.body) !== 'no_fit', 'not no_fit', r);
      expect(nbaChips(out.body).length > 0, 'nba chips present', r);
    }),
  );

  results.push(
    await runCase('ADV-P7-G02-brochure-stickiness', 'advisor', async (r) => {
      const sid = `adv-p7g02-${ts}`;
      await advisorTurn(sid, 'Whitefield', { prefs: true });
      await sleep(300);
      let out = await advisorTurn(sid, 'Vanam looks good');
      expectIncludes(focusBlob(undefined, out.body), 'vanam', r, 'focus Vanam');
      await sleep(300);
      out = await advisorTurn(sid, 'Send brochure');
      r.transcript.push({
        buyer: 'Send brochure',
        reply: out.reply,
        meta: { focus: focusBlob(undefined, out.body), chips: nbaChips(out.body) },
      });
      expectIncludes(focusBlob(undefined, out.body), 'vanam', r, 'stay Vanam');
      expectExcludes(focusBlob(undefined, out.body), 'buena', r, 'not Buena');
    }),
  );

  results.push(
    await runCase('ADV-nba-rails-after-facet', 'advisor', async (r) => {
      const sid = `adv-nba-${ts}`;
      await advisorTurn(sid, 'Whitefield', { prefs: true });
      await sleep(300);
      await advisorTurn(sid, 'Eldorado looks good');
      await sleep(300);
      const out = await advisorTurn(sid, 'Starting prices');
      const chips = nbaChips(out.body);
      r.transcript.push({ buyer: 'Starting prices', reply: out.reply, meta: { chips, nba: out.body.nba } });
      expect(chips.length > 0 && chips.length <= 6, `chip count ${chips.length}`, r);
      // Escape rail should exist somewhere in focused nba
      expect(
        chips.some((c) => /back to my matches|compare|visit|matches/i.test(c)),
        `missing escape rail in ${JSON.stringify(chips)}`,
        r,
      );
    }),
  );

  results.push(
    await runCase('ADV-BREAK-board-tab-legal-then-banks', 'advisor', async (r) => {
      const sid = `adv-tab-${ts}`;
      await advisorTurn(sid, 'Whitefield', { prefs: true });
      await sleep(300);
      await advisorTurn(sid, 'Orchards looks good');
      await sleep(300);
      let out = await advisorTurn(sid, 'legal status', { board_tab: 'legal' });
      r.transcript.push({ buyer: 'legal', reply: out.reply, meta: { chips: nbaChips(out.body), tab: (out.body.nba as { board_tab?: string })?.board_tab } });
      await sleep(300);
      out = await advisorTurn(sid, 'what banks?', { board_tab: 'legal' });
      r.transcript.push({ buyer: 'banks', reply: out.reply, meta: { focus: focusBlob(undefined, out.body), goal: goalKind(undefined, out.body) } });
      expectIncludes(focusBlob(undefined, out.body), 'orchard', r, 'stay Orchards');
      expect(goalKind(undefined, out.body) !== 'no_fit', 'banks not no_fit', r);
    }),
  );

  results.push(
    await runCase('ADV-BREAK-chip-label-vs-action', 'advisor', async (r) => {
      const sid = `adv-chip-${ts}`;
      await advisorTurn(sid, 'Whitefield', { prefs: true });
      await sleep(300);
      await advisorTurn(sid, 'Eldorado looks good');
      await sleep(300);
      // Typed chip label without action_id (SPA bug path)
      const out = await advisorTurn(sid, 'Back to my matches');
      r.transcript.push({
        buyer: 'Back to my matches',
        reply: out.reply,
        meta: { phase: phaseOf(undefined, out.body), goal: goalKind(undefined, out.body), focus: focusBlob(undefined, out.body) },
      });
      // Should leave focused project board / return to matches — not invent Buena Vista
      expectExcludes(out.reply + ' ' + focusBlob(undefined, out.body), 'buena', r, 'escape not Buena');
    }),
  );

  results.push(
    await runCase('ADV-BREAK-rapid-facet-chips', 'advisor', async (r) => {
      const sid = `adv-rapid-${ts}`;
      await advisorTurn(sid, 'Whitefield', { prefs: true });
      await sleep(300);
      await advisorTurn(sid, 'Cornerstone Utopia looks good');
      const facets = ['Starting prices', 'Send brochure', 'Legal status', 'Unit configurations', 'Location & connectivity'];
      for (const text of facets) {
        const out = await advisorTurn(sid, text);
        r.transcript.push({
          buyer: text,
          reply: out.reply,
          meta: { focus: focusBlob(undefined, out.body), goal: goalKind(undefined, out.body) },
        });
        expectIncludes(focusBlob(undefined, out.body), 'cornerstone', r, `stick after ${text}`);
        expectExcludes(focusBlob(undefined, out.body), 'buena', r, `no Buena after ${text}`);
        expect(goalKind(undefined, out.body) !== 'no_fit', `${text} not no_fit`, r);
        await sleep(250);
      }
    }),
  );

  results.push(
    await runCase('ADV-BREAK-compare-from-focused', 'advisor', async (r) => {
      const sid = `adv-cmp-${ts}`;
      await advisorTurn(sid, 'Whitefield', { prefs: true });
      await sleep(300);
      await advisorTurn(sid, 'Eldorado looks good');
      await sleep(300);
      await advisorTurn(sid, 'also interested in Orchards');
      await sleep(300);
      const out = await advisorTurn(sid, 'Compare these two');
      r.transcript.push({
        buyer: 'Compare these two',
        reply: out.reply,
        meta: { goal: goalKind(undefined, out.body), chips: nbaChips(out.body), nba: out.body.nba },
      });
      const reply = out.reply.toLowerCase();
      expect(/eldorado/.test(reply) && /orchard/.test(reply), 'compare names both', r);
      const board = (out.body.nba as { board?: string } | undefined)?.board;
      if (board) expect(board === 'compare' || board === 'project' || board === 'matches', `board=${board}`, r);
    }),
  );

  results.push(
    await runCase('ADV-V01-configs-no-visit', 'advisor', async (r) => {
      const sid = `adv-v01-${ts}`;
      await advisorTurn(sid, 'Whitefield', { prefs: true });
      await sleep(300);
      await advisorTurn(sid, 'Cornerstone Utopia looks good');
      await sleep(300);
      const out = await advisorTurn(sid, 'what about the unit configurations of Eldorado?');
      r.transcript.push({
        buyer: 'Eldorado configs',
        reply: out.reply,
        meta: { goal: goalKind(undefined, out.body), phase: phaseOf(undefined, out.body) },
      });
      expect(goalKind(undefined, out.body) !== 'visit_ask', 'not visit_ask', r);
      expect(!/which day works/i.test(out.reply), 'not visit day', r);
    }),
  );

  // Write report
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(ROOT, 'scenarios', 'runs', `adversarial-${stamp}`);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'report.json'), JSON.stringify({ spine: SPINE, results }, null, 2));

  const passed = results.filter((x) => x.ok).length;
  const failed = results.filter((x) => !x.ok);
  console.log(`\n══ Summary: ${passed}/${results.length} passed ══`);
  if (failed.length) {
    console.log('\nFAILURES:');
    for (const f of failed) {
      console.log(`  ✗ [${f.channel}] ${f.id}`);
      for (const msg of f.failures) console.log(`      - ${msg}`);
      const last = f.transcript[f.transcript.length - 1];
      if (last) console.log(`      last reply: ${last.reply.replace(/\s+/g, ' ').slice(0, 180)}`);
    }
  }
  console.log(`\nReport → ${runDir}/report.json`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
