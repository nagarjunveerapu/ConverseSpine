#!/usr/bin/env node
/**
 * Interactive terminal chat — POSTs to local wrangler dev (/chat).
 * Run wrangler first: npm run dev
 */
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const SPINE_URL = (process.env.CONVERSE_SPINE_URL ?? 'http://127.0.0.1:8789').replace(/\/+$/, '');
const BUILDER_ID = process.env.BUILDER_ID ?? process.env.ADVISOR_BUILDER_ID ?? 'naya-advisor';
/** Pin with BUYER_PHONE=+91… ; otherwise each launch gets a fresh test identity. */
const PINNED_PHONE = process.env.BUYER_PHONE?.trim() || undefined;

function freshBuyerPhone(): string {
  const suffix = String(Date.now() % 10_000_000).padStart(7, '0');
  return `+91999${suffix}`;
}

interface ChatResponse {
  conversation_id: string;
  reply_text: string;
  composer: string;
  turn_index: number;
}

async function health(): Promise<boolean> {
  try {
    const r = await fetch(`${SPINE_URL}/health`);
    const j = (await r.json()) as { status?: string };
    return j.status === 'ok';
  } catch {
    return false;
  }
}

async function sendTurn(
  text: string,
  buyerPhone: string,
  conversationId?: string,
): Promise<ChatResponse> {
  const r = await fetch(`${SPINE_URL}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      builder_id: BUILDER_ID,
      buyer_phone: buyerPhone,
      text,
      ...(conversationId ? { conversation_id: conversationId } : {}),
    }),
  });
  const body = (await r.json()) as ChatResponse & { error?: string };
  if (!r.ok) {
    throw new Error(body.error ?? `HTTP ${r.status}`);
  }
  return body;
}

async function main(): Promise<void> {
  const up = await health();
  if (!up) {
    console.error(`\nCannot reach ConverseSpine at ${SPINE_URL}`);
    console.error('Start it first:  cd ConverseSpine && npm run dev\n');
    process.exit(1);
  }

  let buyerPhone = PINNED_PHONE ?? freshBuyerPhone();
  const phoneNote = PINNED_PHONE ? '(pinned via BUYER_PHONE)' : '(fresh — /new rotates)';

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  ConverseSpine chat REPL → ${SPINE_URL.padEnd(28)}║
║  Builder: ${BUILDER_ID.padEnd(49)}║
║  Phone:   ${buyerPhone.padEnd(49)}║
║  ${phoneNote.padEnd(58)}║
║  /new = fresh phone + new lead (always)                       ║
║  Commands: /new  /health  quit                               ║
║  Turn debug log: logs/turn-debug.jsonl (LOCAL_TURN_LOG=on)   ║
╚══════════════════════════════════════════════════════════════╝
`);

  let conversationId: string | undefined;

  const rl = readline.createInterface({ input, output });

  while (true) {
    const line = (await rl.question('\nYou: ')).trim();
    if (!line) continue;
    const lower = line.toLowerCase();

    if (lower === 'quit' || lower === 'exit') break;
    if (lower === '/new') {
      conversationId = undefined;
      buyerPhone = freshBuyerPhone();
      console.log(`\n[new session — phone ${buyerPhone}, fresh lead on next message]`);
      continue;
    }
    if (lower === '/health') {
      const ok = await health();
      console.log(ok ? '\nSpine: ok' : '\nSpine: unreachable');
      continue;
    }

    try {
      const result = await sendTurn(line, buyerPhone, conversationId);
      conversationId = result.conversation_id;
      console.log(`\nBot [${result.composer}, turn ${result.turn_index}]:\n${result.reply_text}`);
      console.log(`\n(conv ${conversationId.slice(0, 8)}… · ${buyerPhone})`);
    } catch (err) {
      console.error('\nTurn failed:', err instanceof Error ? err.message : err);
    }
  }

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
