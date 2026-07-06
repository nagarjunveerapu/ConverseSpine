#!/usr/bin/env node
/**
 * Quality eval — scenario suite (default) or random personas.
 *
 *   npm run eval:quality              # full scenario suite (Lokations + Brigade)
 *   EVAL_MODE=random npm run eval:quality   # random personas
 */
import { createNodeEnv, nodeConfig } from '../config.js';
import { runQualityEval, runScenarioSuite } from './runner.js';
import { createWorkerRuntime } from '../runtime/deps.js';
import { allBuilderIds } from './persona-library.js';

async function main(): Promise<void> {
  const rt = createWorkerRuntime(createNodeEnv());

  try {
    await rt.crm.health();
  } catch {
    console.error('NayaDesk not reachable at', nodeConfig.nayadeskUrl);
    process.exit(1);
  }

  const mode = process.env.EVAL_MODE ?? 'scenarios';
  const builders = process.env.EVAL_BUILDERS?.split(',').map((s) => s.trim()).filter(Boolean);

  let reportPath: string;
  if (mode === 'random') {
    const count = parseInt(process.env.EVAL_COUNT ?? '3', 10);
    ({ reportPath } = await runQualityEval(rt, { count, builderId: builders?.[0] }));
  } else {
    ({ reportPath } = await runScenarioSuite(rt, { builders: builders?.length ? builders : allBuilderIds() }));
  }

  console.log(`Open: ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
