#!/usr/bin/env node
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createNodeEnv, nodeConfig } from './config.js';
import { listFacts, listLedger } from './crm/repository.js';
import { createWorkerRuntime } from './runtime/deps.js';
import { bootDemo, runTurn } from './turn/run-turn.js';

async function main(): Promise<void> {
  const rt = createWorkerRuntime(createNodeEnv());

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  ConverseSpine — production turn spine + NayaDesk CRM        ║
║  NayaDesk: ${nodeConfig.nayadeskUrl.padEnd(47)}║
║  Builder:  ${nodeConfig.defaultBuilderId.padEnd(47)}║
║  Commands: facts | ledger | quit                             ║
╚══════════════════════════════════════════════════════════════╝
`);

  let threadId: string;
  try {
    threadId = await bootDemo(rt, nodeConfig.defaultBuyerPhone);
    console.log(`\nLead ready: ${threadId} (${nodeConfig.defaultBuyerPhone})\n`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const rl = readline.createInterface({ input, output });

  while (true) {
    const line = (await rl.question('\nYou: ')).trim();
    if (!line) continue;
    if (line === 'quit' || line === 'exit') break;

    if (line === 'facts') {
      console.table(await listFacts(rt, threadId));
      continue;
    }
    if (line === 'ledger') {
      for (const row of await listLedger(rt, threadId)) {
        console.log(`#${row.turn_index} in: ${row.buyer_text}`);
        console.log(`    out: ${row.reply_text.slice(0, 100)}…`);
      }
      continue;
    }

    try {
      const result = await runTurn(rt, {
        thread_id: threadId,
        buyer_text: line,
        builder_id: nodeConfig.defaultBuilderId,
        buyer_phone: nodeConfig.defaultBuyerPhone,
      });
      console.log(`\nBot [${result.composer}, turn ${result.turn_index}]:\n${result.reply_text}`);
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
