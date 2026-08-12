#!/usr/bin/env npx tsx
/**
 * Stage 8 — thin Advisor smoke (shared engine only).
 * Prefs → (optional priority ask) → board → named focus → price.
 * Does not polish Advisor chrome.
 *
 *   npx tsx scripts/run-advisor-smoke.ts
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SPINE = (process.env.CONVERSE_SPINE_URL ?? 'http://127.0.0.1:8789').replace(/\/+$/, '');

function loadSecret(): string {
  if (process.env.BOT_SHARED_SECRET) return process.env.BOT_SHARED_SECRET.trim();
  const p = join(ROOT, '.dev.vars');
  if (!existsSync(p)) return '';
  const line = readFileSync(p, 'utf8').split('\n').find((l) => l.startsWith('BOT_SHARED_SECRET='));
  return line ? line.slice('BOT_SHARED_SECRET='.length).trim().replace(/^["']|["']$/g, '') : '';
}

function replyOf(j: { reply?: string; reply_text?: string }): string {
  return j.reply ?? j.reply_text ?? '';
}

async function main() {
  const secret = loadSecret();
  const sessionId = `qf-smoke-${randomUUID()}`;
  const turns: Array<{ step: string; ok: boolean; note: string; reply?: string }> = [];

  async function advisor(body: Record<string, unknown>) {
    const r = await fetch(`${SPINE}/api/advisor/turn`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret ? { 'x-bot-secret': secret } : {}),
      },
      body: JSON.stringify({
        builder_id: 'brigade-group',
        session_id: sessionId,
        ...body,
      }),
    });
    return (await r.json()) as {
      reply?: string;
      reply_text?: string;
      projects?: unknown[];
      error?: string;
      status?: string;
    };
  }

  let t = await advisor({
    text: 'hi',
    preferences: {
      budget: '₹80L–1 Cr',
      location: 'North Bangalore',
      purpose: 'self_use',
      bhk: '2 BHK',
    },
  });
  let r = replyOf(t).toLowerCase();
  // Advisor may ask priority once before board — shared-engine smoke allows that.
  if (/commute|budget|priority|rank/.test(r) && !(t.projects?.length)) {
    turns.push({
      step: 'prefs→priority',
      ok: true,
      note: 'advisor priority latch (not shared-engine board)',
      reply: replyOf(t).slice(0, 160),
    });
    t = await advisor({ text: 'staying on budget' });
    r = replyOf(t).toLowerCase();
  }

  const projects = t.projects ?? [];
  turns.push({
    step: 'board',
    ok:
      (Array.isArray(projects) && projects.length >= 1) ||
      /fits|eldorado|orchards|option/.test(r),
    note: t.error ?? `projects=${Array.isArray(projects) ? projects.length : 0}`,
    reply: replyOf(t).slice(0, 160),
  });

  t = await advisor({ text: 'Brigade Eldorado' });
  r = replyOf(t).toLowerCase();
  turns.push({
    step: 'named focus',
    ok: r.includes('eldorado') && !r.includes('side-by-side'),
    note: r.includes('side-by-side') ? 'compare leak' : 'ok',
    reply: replyOf(t).slice(0, 160),
  });

  t = await advisor({ text: "what's the price?" });
  r = replyOf(t).toLowerCase();
  turns.push({
    step: 'focused price',
    ok: /₹|price|pricing|lakh|cr|charges/.test(r) && !r.includes('which project'),
    note: 'price tokens',
    reply: replyOf(t).slice(0, 160),
  });

  const outDir = join(ROOT, 'docs/reports/quality-factory-2026-08-12');
  mkdirSync(outDir, { recursive: true });
  const report = {
    at: new Date().toISOString(),
    spine: SPINE,
    session_id: sessionId,
    ok: turns.every((x) => x.ok),
    turns,
  };
  writeFileSync(join(outDir, 'advisor-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
