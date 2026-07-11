#!/usr/bin/env npx tsx
/**
 * W5+W1 smoke: ADV-LOK focus integrity + Desk profile/journey fill.
 *
 *   set -a && source .dev.vars && set +a
 *   CONVERSE_SPINE_URL=... npx tsx scripts/smoke-w5-w1-dossier.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadBotSecret(): string {
  if (process.env.BOT_SHARED_SECRET) return process.env.BOT_SHARED_SECRET;
  const p = join(ROOT, '.dev.vars');
  if (!existsSync(p)) return '';
  const line = readFileSync(p, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('BOT_SHARED_SECRET='));
  return line ? line.slice('BOT_SHARED_SECRET='.length).trim().replace(/^["']|["']$/g, '') : '';
}

const SPINE = (process.env.CONVERSE_SPINE_URL ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev').replace(/\/+$/, '');
const DESK = (process.env.NAYADESK_URL ?? 'https://nayadesk-dev.nagarjun-arjun.workers.dev').replace(/\/+$/, '');
const BOT_SECRET = loadBotSecret();

function deskHeaders(): Record<string, string> {
  return BOT_SECRET ? { 'x-bot-secret': BOT_SECRET } : {};
}

const TURNS = [
  'hi',
  'plantation in sakleshpur',
  'Ayana',
  'Floor plan?',
  'brochure bhejo',
  'price kitna hai',
  'also Krishnaja Greens',
  'dono compare karo',
  'Ayana',
  "what's the BSP and carpet area and possession date",
  'Thanks please share the brochure',
  'back to Ayana',
];

async function chat(phone: string, text: string, convId?: string) {
  const r = await fetch(`${SPINE}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      builder_id: 'lokations',
      buyer_phone: phone,
      text,
      ...(convId ? { conversation_id: convId } : {}),
    }),
  });
  const body = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(body.error ?? r.status));
  return {
    reply: String(body.reply_text ?? body.reply ?? ''),
    conversation_id: String(body.conversation_id ?? ''),
    debug: (body.debug as Record<string, unknown>) ?? {},
  };
}

async function main() {
  const phone = `+9198${Date.now().toString().slice(-8)}`;
  console.log(`W5+W1 smoke phone=${phone}\nSpine=${SPINE}\nDesk=${DESK}\n`);
  let conv: string | undefined;
  let fails = 0;
  for (let i = 0; i < TURNS.length; i++) {
    const text = TURNS[i]!;
    const resp = await chat(phone, text, conv);
    conv = resp.conversation_id || conv;
    const goal = resp.debug.goal as { kind?: string; projectId?: string; topic?: string } | undefined;
    const reply = resp.reply.toLowerCase();
    let ok = true;
    const notes: string[] = [];
    if (i >= 2 && i !== 6 && i !== 7) {
      // After Ayana focus (except Krishnaja / compare turns), avoid Desire Spaces.
      if (reply.includes('desire')) {
        ok = false;
        notes.push('desire spaces leak');
      }
    }
    if (i === 9 || i === 10 || i === 11) {
      if (!reply.includes('ayana')) {
        ok = false;
        notes.push('missing ayana');
      }
      if (goal?.projectId && goal.projectId !== 'ayana-lokations') {
        ok = false;
        notes.push(`goal project=${goal.projectId}`);
      }
    }
    console.log(`${ok ? '✓' : '✗'} t${i + 1} ${text.slice(0, 50)}`);
    if (!ok) {
      fails++;
      for (const n of notes) console.log(`   !! ${n}`);
      console.log(`   goal=${JSON.stringify(goal)} reply=${resp.reply.slice(0, 140)}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  // Desk dossier
  await new Promise((r) => setTimeout(r, 800));
  const profile = await fetch(
    `${DESK}/api/profile?builder_id=lokations&buyer_phone=${encodeURIComponent(phone)}`,
    { headers: deskHeaders() },
  ).then((r) => r.json() as Promise<{ facts?: Record<string, unknown>; error?: string }>);
  const journey = await fetch(
    `${DESK}/api/journey?builder_id=lokations&buyer_phone=${encodeURIComponent(phone)}`,
    { headers: deskHeaders() },
  ).then((r) => r.json() as Promise<{ journey?: { stage?: string } | null; trail?: unknown[]; error?: string }>);

  console.log('\n── Desk dossier ──');
  console.log('profile facts keys:', Object.keys(profile.facts ?? {}), profile.error ?? '');
  console.log('journey stage:', journey.journey?.stage ?? null, 'trail:', (journey.trail ?? []).length, journey.error ?? '');

  const factKeys = Object.keys(profile.facts ?? {});
  if (factKeys.length === 0) {
    console.log('✗ profile empty');
    fails++;
  } else {
    console.log('✓ profile has facts');
  }
  if (!journey.journey?.stage || journey.journey.stage === 'discovery' && (journey.trail ?? []).length === 0) {
    // discovery with no trail after recommend/commit is still weak
    if (!journey.journey) {
      console.log('✗ journey null');
      fails++;
    } else if ((journey.trail ?? []).length === 0 && journey.journey.stage === 'discovery') {
      console.log('✗ journey stuck discovery with empty trail');
      fails++;
    } else {
      console.log(`✓ journey stage=${journey.journey.stage}`);
    }
  } else {
    console.log(`✓ journey stage=${journey.journey?.stage} trail=${(journey.trail ?? []).length}`);
  }

  console.log(fails === 0 ? '\nPASS' : `\nFAIL (${fails})`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
