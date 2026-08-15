import { beforeEach, describe, expect, it } from 'vitest';
import { cachedEmbedMany, cachedEmbedOne } from '../src/cache/embed.js';

/**
 * The unit under test is a COUNT. Workers AI is priced per call, so "did this
 * batch cost one round trip or five" is the whole question — asserting that the
 * vectors came back says nothing about the bill.
 */
function fakeAi() {
  const calls: string[][] = [];
  return {
    calls,
    ai: {
      async run(_model: string, input: { text: string[] }) {
        calls.push([...input.text]);
        // Distinct vector per text so misalignment is detectable.
        return { data: input.text.map((t) => [t.length, 0.5]) };
      },
    },
  };
}

/** KV double with the two methods turn-cache uses. */
function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      async get(key: string, type?: string) {
        const raw = store.get(key);
        if (raw === undefined) return null;
        return type === 'json' ? JSON.parse(raw) : raw;
      },
      async put(key: string, value: string) {
        store.set(key, value);
      },
    } as unknown as KVNamespace,
  };
}

describe('one turn, one embed', () => {
  let ai: ReturnType<typeof fakeAi>;
  let kv: ReturnType<typeof fakeKv>;
  let env: Parameters<typeof cachedEmbedMany>[0];

  beforeEach(() => {
    ai = fakeAi();
    kv = fakeKv();
    env = {
      AI: ai.ai as never,
      TURN_CACHE: kv.kv,
      SIL_EMBED_MODEL: '@cf/baai/bge-base-en-v1.5',
    };
  });

  it('sends a whole batch in ONE call, not one per text', async () => {
    const texts = ['whitefield', 'sarjapur', 'hebbal', 'yelahanka', 'devanahalli'];
    const { vectors, calls } = await cachedEmbedMany(env, texts);

    expect(calls).toBe(1);
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]).toEqual(texts);
    expect(vectors).toHaveLength(5);
    expect(vectors.every((v) => v?.length)).toBe(true);
  });

  it('a second turn over the same texts makes NO call at all', async () => {
    const texts = ['whitefield', 'sarjapur', 'hebbal'];
    await cachedEmbedMany(env, texts);
    expect(ai.calls).toHaveLength(1);

    const second = await cachedEmbedMany(env, texts);
    expect(second.calls).toBe(0);
    expect(second.cache).toBe('hit');
    expect(ai.calls).toHaveLength(1); // still one, from the first turn
    expect(second.vectors.every((v) => v?.length)).toBe(true);
  });

  it('embeds only the misses when a batch is partly cached', async () => {
    await cachedEmbedMany(env, ['whitefield', 'sarjapur']);
    ai.calls.length = 0;

    // The micro-market shape: one new location hint against a warm list.
    const { calls } = await cachedEmbedMany(env, ['whitefield', 'sarjapur', 'hebbal']);

    expect(calls).toBe(1);
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]).toEqual(['hebbal']); // ONLY the miss
  });

  it('keeps results aligned to the input when only some were cached', async () => {
    await cachedEmbedMany(env, ['bbb']);
    const texts = ['a', 'bbb', 'cccccc'];
    const { vectors } = await cachedEmbedMany(env, texts);

    // Fake vectors encode text length, so misalignment is visible.
    expect(vectors.map((v) => v?.[0])).toEqual([1, 3, 6]);
  });

  it('collapses duplicates inside one batch', async () => {
    const { vectors } = await cachedEmbedMany(env, ['eldorado', 'eldorado', 'ayana']);

    expect(ai.calls[0]).toEqual(['eldorado', 'ayana']); // not three
    expect(vectors[0]).toEqual(vectors[1]);
    expect(vectors).toHaveLength(3);
  });

  it('skips blanks without spending a slot on them', async () => {
    const { vectors } = await cachedEmbedMany(env, ['eldorado', '', '   ']);

    expect(ai.calls[0]).toEqual(['eldorado']);
    expect(vectors[1]).toBeNull();
    expect(vectors[2]).toBeNull();
  });

  it('changing the model does not serve vectors from the old one', async () => {
    await cachedEmbedMany(env, ['whitefield']);
    expect(ai.calls).toHaveLength(1);

    // The bake-off ahead swaps this. A key that ignored the model would hand
    // bge-base vectors to a bge-m3 index — no error, just wrong cosines.
    const swapped = { ...env, SIL_EMBED_MODEL: '@cf/baai/bge-m3' };
    const { cache } = await cachedEmbedMany(swapped, ['whitefield']);

    expect(cache).toBe('miss');
    expect(ai.calls).toHaveLength(2);
  });

  it('treats a KV read failure as a miss, never as a turn failure', async () => {
    const broken = {
      ...env,
      TURN_CACHE: {
        async get() {
          throw new Error('KV down');
        },
        async put() {},
      } as unknown as KVNamespace,
    };

    const { vectors, calls } = await cachedEmbedMany(broken, ['whitefield']);

    expect(calls).toBe(1);
    expect(vectors[0]?.length).toBe(2);
  });

  it('still embeds when there is no cache binding at all', async () => {
    const { AI, SIL_EMBED_MODEL } = env;
    const { vectors, calls } = await cachedEmbedMany({ AI, SIL_EMBED_MODEL }, ['a', 'b']);

    expect(calls).toBe(1);
    expect(ai.calls[0]).toEqual(['a', 'b']);
    expect(vectors.every((v) => v?.length)).toBe(true);
  });

  it('cachedEmbedOne keeps its hit/miss/skip contract', async () => {
    const first = await cachedEmbedOne(env, 'whitefield');
    expect(first.cache).toBe('miss');
    expect(first.vector?.length).toBe(2);

    const second = await cachedEmbedOne(env, 'whitefield');
    expect(second.cache).toBe('hit');

    const blank = await cachedEmbedOne(env, '   ');
    expect(blank.cache).toBe('skip');
    expect(blank.vector).toBeNull();
  });

  it('honours cacheText when the embedded text is masked', async () => {
    // Enrich canonicalizes before embedding; the cache key must follow the
    // canonical text or two different raw utterances collide.
    await cachedEmbedMany(env, ['price of <project>'], { cacheTexts: ['canon:price'] });
    ai.calls.length = 0;

    const { calls } = await cachedEmbedMany(env, ['price of <project>'], {
      cacheTexts: ['canon:price'],
    });
    expect(calls).toBe(0);
  });
});
