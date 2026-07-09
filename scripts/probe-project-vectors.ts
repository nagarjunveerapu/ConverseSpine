#!/usr/bin/env npx tsx
/**
 * Probe PROJECT_VECTORS end-to-end against running wrangler dev.
 *
 *   cd NayaDesk && npm run dev          # :8787
 *   cd ConverseSpine && BUILDER_ID=lokations npm run dev  # :8789
 *   npx tsx scripts/probe-project-vectors.ts
 */
const SPINE = (process.env.CONVERSE_SPINE_URL ?? 'http://127.0.0.1:8789').replace(/\/+$/, '');
const BUILDER = process.env.BUILDER_ID ?? 'lokations';
const PHONE = `+91998${String(Date.now() % 1_000_000).padStart(6, '0')}`;

interface ChatResp {
  conversation_id: string;
  reply_text: string;
  turn_index: number;
}

const SCENARIOS: Array<{ id: string; turns: string[]; assertTurn: (i: number, reply: string) => void }> = [
  {
    id: 'P1C-G06',
    turns: [
      'hi',
      'plantation in sakleshpur',
      'give me details on the project',
      'what about legal details',
      'and the pricing details',
      'tell me also about krishnaja greens',
    ],
    assertTurn: (i, reply) => {
      if (i === 5) {
        if (!/krishnaja/i.test(reply)) throw new Error(`turn 6 expected Krishnaja in reply, got: ${reply.slice(0, 120)}`);
        if (/great choice.*ayana/i.test(reply)) throw new Error('turn 6 still on Ayana overview');
      }
    },
  },
  {
    id: 'P1C-FACET',
    turns: [
      'hi',
      'plantation in sakleshpur',
      'give me details on the project',
      'what about legal details',
    ],
    assertTurn: (i, reply) => {
      if (i === 3 && /krishnaja|switch/i.test(reply) && !/legal|rera/i.test(reply)) {
        throw new Error(`turn 4 false switch: ${reply.slice(0, 120)}`);
      }
    },
  },
  {
    id: 'P1C-TYPO',
    turns: [
      'hi',
      'plantation in sakleshpur',
      'give me details on the project',
      'kirshnaja greens pricing',
    ],
    assertTurn: (i, reply) => {
      if (i === 3 && !/krishnaja|₹39/i.test(reply)) {
        throw new Error(`typo switch failed: ${reply.slice(0, 120)}`);
      }
    },
  },
  {
    id: 'P1C-COMPARE',
    turns: ['hi', 'plantation in sakleshpur', 'compare ayana and krishnaja greens'],
    assertTurn: (i, reply) => {
      if (i === 2 && (!/ayana/i.test(reply) || !/krishnaja/i.test(reply))) {
        throw new Error(`compare failed: ${reply.slice(0, 120)}`);
      }
    },
  },
];

async function chat(text: string, convId?: string, phone = PHONE): Promise<ChatResp> {
  const r = await fetch(`${SPINE}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      builder_id: BUILDER,
      buyer_phone: phone,
      text,
      ...(convId ? { conversation_id: convId } : {}),
    }),
  });
  const body = (await r.json()) as ChatResp & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
}

async function main(): Promise<void> {
  const health = await fetch(`${SPINE}/health`).then((r) => r.json()).catch(() => null);
  if (!health || (health as { status?: string }).status !== 'ok') {
    console.error('ConverseSpine not up at', SPINE);
    process.exit(1);
  }

  console.log(`\nProbe PROJECT_VECTORS — ${SPINE} builder=${BUILDER}\n`);
  const results: Array<{ id: string; ok: boolean; detail: string }> = [];

  for (const sc of SCENARIOS) {
    const phone = `+91998${String(Date.now() % 1_000_000).padStart(6, '0')}${SCENARIOS.indexOf(sc)}`;
    let convId: string | undefined;
    let ok = true;
    let detail = '';
    try {
      for (let i = 0; i < sc.turns.length; i++) {
        const text = sc.turns[i]!;
        const resp = await chat(text, convId, phone);
        convId = resp.conversation_id;
        sc.assertTurn(i, resp.reply_text);
        console.log(`  [${sc.id} t${i + 1}] ${text.slice(0, 50)}`);
        console.log(`           → ${resp.reply_text.replace(/\s+/g, ' ').slice(0, 100)}…`);
      }
      detail = 'pass';
    } catch (e) {
      ok = false;
      detail = e instanceof Error ? e.message : String(e);
      console.log(`  [${sc.id}] FAIL: ${detail}`);
    }
    results.push({ id: sc.id, ok, detail });
  }

  console.log('\n── Summary ──');
  for (const r of results) {
    console.log(`${r.ok ? '✅' : '❌'} ${r.id}: ${r.detail}`);
  }
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main();
