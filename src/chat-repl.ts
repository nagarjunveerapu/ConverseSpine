#!/usr/bin/env node
/**
 * Interactive terminal chat — POSTs to local wrangler dev (/chat).
 * Run wrangler first: npm run dev
 */
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const SPINE_URL = (process.env.CONVERSE_SPINE_URL ?? 'http://127.0.0.1:8789').replace(/\/+$/, '');
const BUILDER_ID = process.env.BUILDER_ID ?? process.env.ADVISOR_BUILDER_ID ?? 'naya-advisor';
const BUYER_PHONE = process.env.BUYER_PHONE ?? '+919990000001';

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
  conversationId?: string,
): Promise<ChatResponse> {
  const r = await fetch(`${SPINE_URL}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      builder_id: BUILDER_ID,
      buyer_phone: BUYER_PHONE,
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

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  ConverseSpine chat REPL → ${SPINE_URL.padEnd(28)}║
║  Builder: ${BUILDER_ID.padEnd(49)}║
║  Phone:   ${BUYER_PHONE.padEnd(49)}║
║  Commands: /new  /health  quit                               ║
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
      console.log('\n[new session — next message creates a fresh lead]');
      continue;
    }
    if (lower === '/health') {
      const ok = await health();
      console.log(ok ? '\nSpine: ok' : '\nSpine: unreachable');
      continue;
    }

    try {
      const result = await sendTurn(line, conversationId);
      conversationId = result.conversation_id;
      console.log(`\nBot [${result.composer}, turn ${result.turn_index}]:\n${result.reply_text}`);
      console.log(`\n(conv ${conversationId.slice(0, 8)}…)`);
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
