/**
 * Bench, not a gate: drives a realistic buyer conversation through the REAL
 * makeSemanticNlu and counts Workers AI round trips. Runs identically on
 * origin/main and on this branch, so the two numbers are comparable.
 *
 * Writes JSON to BENCH_OUT for the report generator.
 */
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { makeSemanticNlu } from '../src/engine/adapters/semantic-nlu.js';
import type { Env } from '../src/env.js';
import type { Extracted } from '../src/engine/types.js';

// A real Bangalore builder's market list is this long; these are placeholders,
// never a hardcoded catalog — the live list arrives through ctx.microMarkets.
const MICRO_MARKETS = Array.from({ length: 24 }, (_, i) => `micro-market-${i}`);

/** Turns a buyer actually sends, in the order they send them. */
const CONVERSATION = [
  'projects in whitefield',
  'what about sarjapur',
  'tell me about eldorado',
  'compare eldorado and ayana',
  'price of eldorado',
  'projects in whitefield',
  'compare ayana and krishnaja',
  'i want to visit eldorado and ayana',
];

function harness() {
  const runs: string[][] = [];
  const kvStore = new Map<string, string>();
  const env = {
    AI: {
      async run(_m: string, input: { text: string[] }) {
        runs.push([...input.text]);
        return { data: input.text.map((t) => [t.length, 0.5]) };
      },
    },
    PROJECT_VECTORS: {
      async query(vector: number[]) {
        return {
          matches: [
            { score: 0.91, metadata: { project_id: `p-${vector[0]}`, name: `P${vector[0]}` } },
          ],
        };
      },
    },
    TURN_CACHE: {
      async get(key: string, type?: string) {
        const raw = kvStore.get(key);
        if (raw === undefined) return null;
        return type === 'json' ? JSON.parse(raw) : raw;
      },
      async put(key: string, value: string) {
        kvStore.set(key, value);
      },
    },
    SIL_EMBED_MODEL: '@cf/baai/bge-base-en-v1.5',
  } as unknown as Env;
  return { env, runs };
}

describe('bench: embed calls per turn', () => {
  it('counts AI.run across a realistic conversation', async () => {
    const { env, runs } = harness();
    const nlu = makeSemanticNlu(env);
    const perTurn: Array<{ say: string; calls: number; texts: number }> = [];

    for (const say of CONVERSATION) {
      const before = runs.length;
      const beforeTexts = runs.reduce((n, r) => n + r.length, 0);
      await nlu.enrich(say, 'b1', { constraints: {} } as Extracted, {
        phase: 'discover' as never,
        microMarkets: MICRO_MARKETS,
      });
      perTurn.push({
        say,
        calls: runs.length - before,
        texts: runs.reduce((n, r) => n + r.length, 0) - beforeTexts,
      });
    }

    const totalCalls = perTurn.reduce((n, t) => n + t.calls, 0);
    const totalTexts = perTurn.reduce((n, t) => n + t.texts, 0);
    const out = process.env.BENCH_OUT;
    const payload = { perTurn, totalCalls, totalTexts };
    if (out) writeFileSync(out, JSON.stringify(payload, null, 2));
    console.log(`BENCH calls=${totalCalls} texts=${totalTexts}`);
    for (const t of perTurn) {
      console.log(`  ${t.calls} call(s) ${String(t.texts).padStart(3)} text(s)  ${t.say}`);
    }
  });
});
