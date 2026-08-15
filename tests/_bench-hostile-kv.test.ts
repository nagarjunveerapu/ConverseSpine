/**
 * Bench, not a gate. The ideal-KV bench assumes a cache that is instantly
 * consistent. Real Cloudflare KV is not: a key that is read-and-missed is
 * NEGATIVELY cached in that colo for up to ~60s, and a later put() does not
 * reliably clear it. Buyer turns arrive seconds apart, so an entire
 * conversation fits inside one negative-cache window.
 *
 * That is the pessimistic bound, and it is the one worth publishing: under it
 * the L3 cache contributes NOTHING within a conversation, and whatever
 * improvement survives is pure batching. Runs identically on origin/main and
 * on the branch.
 *
 * Three regimes:
 *   none    — no TURN_CACHE binding at all
 *   hostile — negative caching: a key missed once stays missed for the run
 *   ideal   — instantly-consistent map (what the other bench assumed)
 */
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { makeSemanticNlu } from '../src/engine/adapters/semantic-nlu.js';
import type { Env } from '../src/env.js';
import type { Extracted } from '../src/engine/types.js';

const MICRO_MARKETS = Array.from({ length: 24 }, (_, i) => `micro-market-${i}`);

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

type Regime = 'none' | 'hostile' | 'ideal';

function makeCache(regime: Regime) {
  if (regime === 'none') return undefined;
  const store = new Map<string, string>();
  // Keys this colo has already answered "not found" for. Under `hostile` they
  // keep answering "not found" for the rest of the run — no clock, because the
  // whole conversation is inside the 60s window anyway.
  const negative = new Set<string>();
  return {
    async get(key: string, type?: string) {
      if (regime === 'hostile' && negative.has(key)) return null;
      const raw = store.get(key);
      if (raw === undefined) {
        negative.add(key);
        return null;
      }
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function harness(regime: Regime) {
  const runs: string[][] = [];
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
    TURN_CACHE: makeCache(regime),
    SIL_EMBED_MODEL: '@cf/baai/bge-base-en-v1.5',
  } as unknown as Env;
  return { env, runs };
}

describe('bench: embed calls under hostile KV', () => {
  it('counts AI.run across three cache regimes', async () => {
    const out: Record<string, unknown> = {};

    for (const regime of ['none', 'hostile', 'ideal'] as Regime[]) {
      const { env, runs } = harness(regime);
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

      const calls = perTurn.reduce((n, t) => n + t.calls, 0);
      const texts = perTurn.reduce((n, t) => n + t.texts, 0);
      const worst = perTurn.reduce((m, t) => Math.max(m, t.calls), 0);
      out[regime] = { perTurn, calls, texts, worst };
      console.log(`HOSTILE-BENCH ${regime.padEnd(8)} calls=${calls} texts=${texts} worst=${worst}`);
    }

    const dest = process.env.HOSTILE_OUT;
    if (dest) writeFileSync(dest, JSON.stringify(out, null, 2));
  });
});
