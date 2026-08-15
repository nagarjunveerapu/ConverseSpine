/**
 * Per-turn embed meter — how many times the turn hit Workers AI, and for how long.
 *
 * `timings.embed_ms` has been declared in the debug shape since the hybrid
 * timing work landed and nothing has ever written it. That is the one phase we
 * most need a number for: the whole regex ladder costs under a millisecond a
 * turn, while a single embedding measures ~266ms p50 / 531ms p90 against dev.
 * The engine could already say where a slow turn went except for the one stage
 * that dominates it.
 *
 * Metering at the `Ai` binding rather than at each call site is deliberate.
 * `env.AI` is only ever the embedding binding — the paid LLM goes out over
 * OPENAI_API_KEY — so every `.run()` on it is an embed, and wrapping it once
 * where the per-turn deps are built catches all of them: the routing lane, both
 * semantic-nlu lanes, education, and the intent embedder. It also catches lanes
 * nobody has written yet, which a per-call-site stopwatch would silently miss.
 *
 * The counts matter as much as the milliseconds. Embedding is priced per
 * *call*, not per text — 32 texts in one call measured 283ms against 266ms for
 * one — so `calls` is the number to drive down and `texts` is what proves the
 * work did not simply get dropped instead of batched.
 */

export interface EmbedMeter {
  /** `AI.run` invocations on the turn path. */
  calls: number;
  /** Strings embedded across those calls — batching moves this off `calls`. */
  texts: number;
  /** Summed wall clock inside those calls, including ones that threw. */
  ms: number;
}

export function newEmbedMeter(): EmbedMeter {
  return { calls: 0, texts: 0, ms: 0 };
}

/** `{ text: string | string[] }` is the shape every embed call site passes. */
function countTexts(input: unknown): number {
  if (!input || typeof input !== 'object') return 0;
  const text = (input as { text?: unknown }).text;
  if (typeof text === 'string') return 1;
  return Array.isArray(text) ? text.length : 0;
}

/**
 * Wrap an `Ai` binding so every `.run()` records against `meter`.
 *
 * Returns the same type, so this drops in wherever the raw binding goes today
 * and no call site changes. A proxy rather than an object literal because the
 * binding carries methods beyond `run` (gateway, models, toMarkdown, …) and
 * enumerating them here would break the next time one is added.
 */
export function meterAi<T extends object>(
  ai: T,
  meter: EmbedMeter,
  nowMs: () => number = () => Date.now(),
): T {
  return new Proxy(ai, {
    get(target, prop) {
      // Read with the TARGET as receiver, not the proxy. A host binding may
      // expose getters that touch internal slots through `this`, and handing
      // those the proxy makes them throw.
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (prop !== 'run') return value.bind(target);
      return async (...args: unknown[]) => {
        const t0 = nowMs();
        try {
          return await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        } finally {
          // A failed embed that took three seconds is exactly the tail worth
          // seeing, so the timer closes in `finally` and the call still counts.
          meter.ms += nowMs() - t0;
          meter.calls += 1;
          meter.texts += countTexts(args[1]);
        }
      };
    },
  }) as T;
}
