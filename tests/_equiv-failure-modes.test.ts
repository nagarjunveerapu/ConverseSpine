/**
 * Differential harness for the unhappy paths. Batching changes what a single
 * failure costs: on main a thrown AI.run lost ONE text, on the branch it can
 * lose a whole batch. That is the risk this file exists to measure.
 *
 * Runs identically on origin/main and on the branch and dumps outcomes to
 * JSON. The bar is not "the branch handles failure well" — it is "the branch
 * is no worse than main", judged per scenario.
 */
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { makeSemanticNlu } from '../src/engine/adapters/semantic-nlu.js';
import type { Env } from '../src/env.js';
import type { Extracted } from '../src/engine/types.js';

const MICRO_MARKETS = Array.from({ length: 24 }, (_, i) => `micro-market-${i}`);

/** Two shapes: a single-clause ask and a compare, which is the batching case. */
const SAYS = ['tell me about eldorado', 'compare eldorado and ayana', 'projects in whitefield'];

type AiBehaviour =
  | 'ok'
  | 'throw-always'
  | 'throw-first'
  | 'partial-data'
  | 'empty-data'
  | 'no-data'
  | 'null-rows'
  | 'short-vectors'
  | 'reject-nonerror';

type VecBehaviour = 'ok' | 'throw-always' | 'throw-first' | 'empty' | 'no-metadata';
type KvBehaviour = 'ok' | 'get-throws' | 'put-throws' | 'get-garbage' | 'get-wrong-shape';

function makeEnv(ai: AiBehaviour, vec: VecBehaviour, kv: KvBehaviour) {
  let aiCalls = 0;
  let vecCalls = 0;
  const runs: string[][] = [];
  const store = new Map<string, string>();

  const env = {
    AI: {
      async run(_m: string, input: { text: string[] | string }) {
        aiCalls += 1;
        const texts = Array.isArray(input.text) ? input.text : [input.text];
        runs.push([...texts]);
        if (ai === 'throw-always') throw new Error('AI unavailable');
        if (ai === 'throw-first' && aiCalls === 1) throw new Error('AI unavailable (first)');
        if (ai === 'reject-nonerror') throw 'string rejection';
        if (ai === 'no-data') return {};
        if (ai === 'empty-data') return { data: [] };
        // One vector short — the alignment hazard batching introduces.
        if (ai === 'partial-data') return { data: texts.slice(1).map((t) => [t.length, 0.5]) };
        if (ai === 'null-rows') return { data: texts.map(() => null) };
        if (ai === 'short-vectors') return { data: texts.map(() => []) };
        return { data: texts.map((t) => [t.length, 0.5]) };
      },
    },
    PROJECT_VECTORS: {
      async query(vector: number[]) {
        vecCalls += 1;
        if (vec === 'throw-always') throw new Error('Vectorize down');
        if (vec === 'throw-first' && vecCalls === 1) throw new Error('Vectorize down (first)');
        if (vec === 'empty') return { matches: [] };
        if (vec === 'no-metadata') return { matches: [{ score: 0.91 }] };
        return {
          matches: [
            { score: 0.91, metadata: { project_id: `p-${vector[0]}`, name: `P${vector[0]}` } },
          ],
        };
      },
    },
    TURN_CACHE: {
      async get(key: string, type?: string) {
        if (kv === 'get-throws') throw new Error('KV read failed');
        if (kv === 'get-garbage') return type === 'json' ? undefined : 'not-json{';
        if (kv === 'get-wrong-shape') return type === 'json' ? { nope: true } : '{"nope":true}';
        const raw = store.get(key);
        if (raw === undefined) return null;
        return type === 'json' ? JSON.parse(raw) : raw;
      },
      async put(key: string, value: string) {
        if (kv === 'put-throws') throw new Error('KV write failed');
        store.set(key, value);
      },
    },
    SIL_EMBED_MODEL: '@cf/baai/bge-base-en-v1.5',
  } as unknown as Env;

  return { env, stats: () => ({ aiCalls, vecCalls, runs }) };
}

const AI_MODES: AiBehaviour[] = [
  'ok', 'throw-always', 'throw-first', 'partial-data',
  'empty-data', 'no-data', 'null-rows', 'short-vectors', 'reject-nonerror',
];
const VEC_MODES: VecBehaviour[] = ['ok', 'throw-always', 'throw-first', 'empty', 'no-metadata'];
const KV_MODES: KvBehaviour[] = ['ok', 'get-throws', 'put-throws', 'get-garbage', 'get-wrong-shape'];

describe('equivalence: failure modes', () => {
  it('dumps outcomes for every failure combination', async () => {
    const rows: unknown[] = [];

    for (const ai of AI_MODES) {
      for (const vec of VEC_MODES) {
        for (const kv of KV_MODES) {
          for (const say of SAYS) {
            // Fresh env per row: a thrown KV write must not poison the next row.
            const { env, stats } = makeEnv(ai, vec, kv);
            const nlu = makeSemanticNlu(env);
            let threw: string | null = null;
            let named: string[] | null = null;
            let location: string | null = null;

            try {
              // Two turns: the second is where a poisoned cache would surface.
              await nlu.enrich(say, 'b1', { constraints: {} } as Extracted, {
                phase: 'discover' as never,
                microMarkets: MICRO_MARKETS,
              });
              const out = await nlu.enrich(say, 'b1', { constraints: {} } as Extracted, {
                phase: 'discover' as never,
                microMarkets: MICRO_MARKETS,
              });
              named = (out.namedProjects ?? []).map((p) => `${p.projectId}|${p.name}`);
              location = out.constraints?.location ?? null;
            } catch (err) {
              threw = err instanceof Error ? err.message : String(err);
            }

            const s = stats();
            rows.push({
              ai, vec, kv, say,
              threw,
              named,
              location,
              aiCalls: s.aiCalls,
              vecCalls: s.vecCalls,
            });
          }
        }
      }
    }

    const dest = process.env.FAILMODE_OUT;
    if (dest) writeFileSync(dest, JSON.stringify(rows, null, 1));
    const threwCount = rows.filter((r) => (r as { threw: string | null }).threw).length;
    console.log(`FAILMODE rows=${rows.length} threw=${threwCount}`);
  });
});
