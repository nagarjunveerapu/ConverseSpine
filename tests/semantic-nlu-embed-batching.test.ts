import { describe, expect, it } from 'vitest';
import { makeSemanticNlu } from '../src/engine/adapters/semantic-nlu.js';
import type { Env } from '../src/env.js';
import type { Extracted } from '../src/engine/types.js';

/**
 * The clause lane used to embed inside a `for await`, so "compare A and B" paid
 * two full Workers AI round trips end to end. These tests count `AI.run`
 * invocations through the real enrich path, because the count is the cost.
 */
function harness(opts?: { microMarkets?: string[] }) {
  const runs: string[][] = [];
  const queried: number[][] = [];
  const kvStore = new Map<string, string>();

  const env = {
    AI: {
      async run(_model: string, input: { text: string[] }) {
        runs.push([...input.text]);
        return { data: input.text.map((t) => [t.length, 0.5]) };
      },
    },
    PROJECT_VECTORS: {
      async query(vector: number[]) {
        queried.push(vector);
        return {
          matches: [
            {
              score: 0.91,
              metadata: { project_id: `p-${vector[0]}`, name: `Project ${vector[0]}` },
            },
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
    // INTENT_VECTORS deliberately absent — this isolates the project lane from
    // the topic gap-fill lane so the counts below mean one thing.
  } as unknown as Env;

  const ctx = {
    phase: 'discover' as never,
    microMarkets: opts?.microMarkets ?? [],
  };

  const ex: Extracted = { constraints: {} } as Extracted;

  return { env, ctx, ex, runs, queried };
}

describe('semantic-nlu embed batching', () => {
  it('embeds both clauses of a compare in ONE call', async () => {
    const { env, ctx, ex, runs, queried } = harness();

    await makeSemanticNlu(env).enrich('compare ayana and krishnaja', 'b1', ex, ctx);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(2);
    // Both clauses still get their own Vectorize lookup — batching the embed
    // must not collapse two questions into one query.
    expect(queried).toHaveLength(2);
  });

  it('still resolves both projects after batching', async () => {
    const { env, ctx, ex } = harness();

    const out = await makeSemanticNlu(env).enrich(
      'compare ayana and krishnaja',
      'b1',
      ex,
      ctx,
    );

    expect(out.namedProjects?.length).toBe(2);
  });

  it('a repeated question costs no call the second time', async () => {
    const { env, ctx, ex, runs } = harness();
    const nlu = makeSemanticNlu(env);

    await nlu.enrich('tell me about eldorado', 'b1', ex, ctx);
    expect(runs).toHaveLength(1);

    await nlu.enrich('tell me about eldorado', 'b1', ex, ctx);
    expect(runs).toHaveLength(1); // served from L3
  });

  it('re-embeds nothing for the micro-market scan on a warm cache', async () => {
    const microMarkets = Array.from({ length: 24 }, (_, i) => `market-${i}`);
    const { env, ctx, ex, runs } = harness({ microMarkets });
    const nlu = makeSemanticNlu(env);

    await nlu.enrich('projects in whitefield', 'b1', ex, ctx);
    const firstTurnCalls = runs.length;
    expect(firstTurnCalls).toBeGreaterThan(0);

    // Same hint, same 24 static markets — every one of them is now in L3.
    runs.length = 0;
    await nlu.enrich('projects in whitefield', 'b1', ex, ctx);
    expect(runs).toHaveLength(0);
  });

  it('embeds only the new hint when the market list is already warm', async () => {
    const microMarkets = Array.from({ length: 24 }, (_, i) => `market-${i}`);
    const { env, ctx, ex, runs } = harness({ microMarkets });
    const nlu = makeSemanticNlu(env);

    await nlu.enrich('projects in whitefield', 'b1', ex, ctx);
    runs.length = 0;

    await nlu.enrich('projects in sarjapur', 'b1', ex, ctx);

    // One call carrying one text: the 24 markets came from cache.
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual(['sarjapur']);
  });
});
