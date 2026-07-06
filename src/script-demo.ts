#!/usr/bin/env node
import { createNodeEnv } from './config.js';
import { listFacts, listLedger } from './crm/repository.js';
import { createWorkerRuntime } from './runtime/deps.js';
import { bootDemo, runTurn } from './turn/run-turn.js';

async function say(rt: ReturnType<typeof createWorkerRuntime>, conversationId: string, user: string): Promise<void> {
  console.log(`\n--- You: ${user}`);
  const r = await runTurn(rt, { conversation_id: conversationId, buyer_text: user });
  console.log(`Bot [${r.composer}, turn ${r.turn_index}]:\n${r.reply_text}`);
}

async function main(): Promise<void> {
  const rt = createWorkerRuntime(createNodeEnv());
  console.log('ConverseSpine scripted demo\n');
  const conversationId = await bootDemo(rt, '+919990000010');
  console.log(`Using conversation: ${conversationId}\n`);

  await say(rt, conversationId, 'hi');
  await say(rt, conversationId, '2 bhk Whitefield 80 lakhs');
  await say(rt, conversationId, 'tell me about Ayana');
  await say(rt, conversationId, 'i want the details on pricing');
  await say(rt, conversationId, 'i would like to do a site visit');
  await say(rt, conversationId, 'yes');

  console.table(await listFacts(rt, conversationId));
  console.log('Transcript turns:', (await listLedger(rt, conversationId)).length);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
