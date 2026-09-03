#!/usr/bin/env npx tsx
/**
 * U9 instrument, step 2 — ask dev what actually happens.
 *
 * scripts/u9-gate-vs-lexical.ts predicts that certain turns lose the project
 * name because the gate refuses to consult PROJECT_VECTORS. A prediction from
 * a pure function is not a finding: the shortlist path, chip resolve, or the
 * focused-phase machinery may bind the name anyway. Only the deployed bot can
 * settle it, so this sends each line to dev on a COLD conversation — the same
 * condition the prediction was computed under — and records the reply.
 *
 * Cold matters: a bare "Brigade Eldorado" mid-funnel has a shortlist to match
 * against and binds trivially. The interesting case is the buyer who opens
 * with it, which is also the most common single utterance in the dev ledger.
 *
 *   npx tsx scripts/u9-live-check.ts <cases.json> <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SPINE = (process.env.CONVERSE_SPINE_URL ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev').replace(/\/+$/, '');
const BUILDER = process.env.BUILDER_ID ?? 'naya-advisor';

interface Case { text: string; occurrences: number; expectName: string; expectId: string }
interface Result extends Case { reply: string; namedExpected: boolean; threadId: string; error?: string }

const cases = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Case[];
const out: Result[] = [];

/** Distinct phone per case → a genuinely cold conversation, never a warm board. */
const phoneFor = (i: number) => `+9198${String(Date.now() % 100000).padStart(5, '0')}${String(i).padStart(2, '0')}`;

async function chat(phone: string, text: string) {
  const r = await fetch(`${SPINE}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ builder_id: BUILDER, buyer_phone: phone, text }),
  });
  const body = (await r.json()) as { reply_text?: string; thread_id?: string; error?: string };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
}

console.log(`live check — ${SPINE} · builder=${BUILDER} · ${cases.length} cold turns\n`);

for (const [i, c] of cases.entries()) {
  try {
    const res = await chat(phoneFor(i), c.text);
    const reply = res.reply_text ?? '';
    // Did the reply actually name the project the buyer named? Substring on the
    // full name, and on the distinctive tail ("Eldorado" out of "Brigade
    // Eldorado") — a reply that says only "Brigade" has named nine projects.
    const tail = c.expectName.replace(/^(brigade|hv)\s+/i, '');
    const namedExpected =
      reply.toLowerCase().includes(c.expectName.toLowerCase()) ||
      reply.toLowerCase().includes(tail.toLowerCase());
    out.push({ ...c, reply, namedExpected, threadId: res.thread_id ?? '' });
    console.log(
      `${namedExpected ? 'BOUND  ' : 'MISSED '} ${String(c.occurrences).padStart(4)}×  ${JSON.stringify(c.text).slice(0, 46).padEnd(48)} ${namedExpected ? '' : '→ ' + reply.slice(0, 90).replace(/\s+/g, ' ')}`,
    );
  } catch (e) {
    out.push({ ...c, reply: '', namedExpected: false, threadId: '', error: String(e).slice(0, 200) });
    console.log(`ERROR   ${JSON.stringify(c.text).slice(0, 46)} — ${String(e).slice(0, 120)}`);
  }
}

const missed = out.filter((r) => !r.namedExpected && !r.error);
const weight = (rs: Result[]) => rs.reduce((a, r) => a + r.occurrences, 0);
console.log(`\nbound : ${out.length - missed.length - out.filter((r) => r.error).length}`);
console.log(`missed: ${missed.length} distinct · ${weight(missed)} occurrences in the dev ledger`);

writeFileSync(process.argv[3], JSON.stringify({ spine: SPINE, builder: BUILDER, results: out }, null, 1));
console.log(`\nwrote ${process.argv[3]}`);
