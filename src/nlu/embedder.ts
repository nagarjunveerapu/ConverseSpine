import type { Env } from '../env.js';

/** Vectorize + Workers AI intent match — optional when bindings wired. */
export class IntentEmbedder {
  constructor(private readonly env: Env) {}

  async matchIntent(buyerText: string, builderId: string): Promise<{ kind: string; score: number } | null> {
    if (!this.env.INTENT_VECTORS || !this.env.AI) return null;

    const embed = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [buyerText] }) as {
      data?: number[][];
    };
    const vector = embed.data?.[0];
    if (!vector) return null;

    const results = await this.env.INTENT_VECTORS.query(vector, {
      topK: 3,
      returnMetadata: 'all',
      filter: { builder_scope: builderId },
    });

    const top = results.matches?.[0];
    if (!top?.metadata || typeof top.metadata.intent_kind !== 'string') return null;
    const score = top.score ?? 0;
    if (score < 0.72) return null;
    return { kind: top.metadata.intent_kind as string, score };
  }
}
