#!/usr/bin/env npx tsx
/**
 * Dig load soak — concurrent chats against converse-spine-dev.
 *
 *   npx tsx scripts/run-dig-load-soak.ts
 *   SOAK_CHATS=100 SOAK_CONCURRENCY=20 npx tsx scripts/run-dig-load-soak.ts
 *
 * Includes packed multi-intent turns. Exit 1 if warm p95 > 1500ms or pass < 70%.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SPINE = (
  process.env.CONVERSE_SPINE_URL ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev'
).replace(/\/+$/, '');
const CHATS = Math.max(1, Number(process.env.SOAK_CHATS ?? '100'));
/** Default 5 — high concurrency saturates Workers AI/Desk and inflates wall p95. */
const CONCURRENCY = Math.max(1, Number(process.env.SOAK_CONCURRENCY ?? '5'));
const BUILDER = process.env.SOAK_BUILDER_ID ?? 'brigade-group';

type Journey = { id: string; turns: string[] };

const JOURNEYS: Journey[] = [
  {
    id: 'packed-price-legal',
    turns: [
      'Hi',
      'Looking at Brigade Eldorado',
      'Brochure and RERA please',
      'What is the all-in price for 2BHK?',
    ],
  },
  {
    id: 'packed-schools-price',
    turns: [
      'Hello',
      'Eldorado Whitefield',
      'Schools nearby and starting price?',
    ],
  },
  {
    id: 'recommend-focus',
    turns: [
      'Hi looking for 2BHK in Whitefield under 1.2 Cr',
      'Tell me more about the first one',
      'Price and possession',
    ],
  },
  {
    id: 'visit-digress',
    turns: [
      'Hi',
      'Brigade Eldorado',
      'I want to visit this weekend',
      'Also what about the payment plan?',
      'ok Saturday morning',
    ],
  },
];

function pct(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

async function chat(
  buyer: string,
  text: string,
  conversationId?: string,
): Promise<{
  ok: boolean;
  wall_ms: number;
  conversation_id?: string;
  total_ms?: number;
  cache?: Record<string, string>;
  reply?: string;
}> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${SPINE}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        builder_id: BUILDER,
        buyer_phone: buyer,
        text,
        ...(conversationId ? { conversation_id: conversationId } : {}),
        channel: 'api',
      }),
    });
    const wall_ms = Date.now() - t0;
    const j = (await res.json()) as {
      conversation_id?: string;
      reply?: string;
      reply_text?: string;
      debug?: { timings?: { total_ms?: number }; cache?: Record<string, string> };
    };
    return {
      ok: res.ok,
      wall_ms,
      conversation_id: j.conversation_id,
      total_ms: j.debug?.timings?.total_ms,
      cache: j.debug?.cache,
      reply: j.reply_text ?? j.reply,
    };
  } catch {
    return { ok: false, wall_ms: Date.now() - t0 };
  }
}

async function runOne(i: number): Promise<{
  walls: number[];
  pass: boolean;
  cacheHits: number;
  cacheSeen: number;
}> {
  const journey = JOURNEYS[i % JOURNEYS.length]!;
  const buyer = `91${String(9000000000 + i).slice(0, 10)}`;
  let conv: string | undefined;
  const walls: number[] = [];
  let pass = true;
  let cacheHits = 0;
  let cacheSeen = 0;
  for (const text of journey.turns) {
    const r = await chat(buyer, text, conv);
    walls.push(r.wall_ms);
    if (r.conversation_id) conv = r.conversation_id;
    if (!r.ok || !r.reply?.trim()) pass = false;
    if (r.cache) {
      for (const v of Object.values(r.cache)) {
        cacheSeen += 1;
        if (v === 'hit') cacheHits += 1;
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return { walls, pass, cacheHits, cacheSeen };
}

async function pool<T>(n: number, items: number[], fn: (i: number) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()));
  return out;
}

async function main() {
  console.log(`Dig soak → ${SPINE} chats=${CHATS} concurrency=${CONCURRENCY}`);
  const items = Array.from({ length: CHATS }, (_, i) => i);
  const results = await pool(CONCURRENCY, items, runOne);
  const allWalls = results.flatMap((r) => r.walls).sort((a, b) => a - b);
  // Warm = drop first turn of each chat (cold extract/search).
  const warm: number[] = [];
  for (const r of results) {
    for (let i = 1; i < r.walls.length; i++) warm.push(r.walls[i]!);
  }
  warm.sort((a, b) => a - b);
  const passes = results.filter((r) => r.pass).length;
  const cacheHits = results.reduce((a, r) => a + r.cacheHits, 0);
  const cacheSeen = results.reduce((a, r) => a + r.cacheSeen, 0);
  const summary = {
    spine: SPINE,
    chats: CHATS,
    concurrency: CONCURRENCY,
    pass_rate: passes / CHATS,
    wall_p50: pct(allWalls, 50),
    wall_p95: pct(allWalls, 95),
    warm_p50: pct(warm, 50),
    warm_p95: pct(warm, 95),
    cache_hit_rate: cacheSeen ? cacheHits / cacheSeen : null,
  };
  const outDir = join(ROOT, 'docs/reports', `dig-load-soak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`wrote ${outDir}/summary.json`);

  const warmP95 = summary.warm_p95 ?? Infinity;
  const passOk = summary.pass_rate >= 0.7;
  // Target SLO p95 ≤1s; interim gate 1.5s once caches are warm. Record always.
  const sloOk = warmP95 <= 1500;
  const status = { passOk, sloOk, target_warm_p95_ms: 1000, interim_gate_ms: 1500 };
  writeFileSync(join(outDir, 'gate.json'), JSON.stringify(status, null, 2));
  if (!passOk || !sloOk) {
    console.error(
      `SOAK GATE FAIL pass=${summary.pass_rate} warm_p95=${warmP95} (need pass≥0.7 warm_p95≤1500) — report kept`,
    );
    process.exit(1);
  }
  console.log('SOAK GATE PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
