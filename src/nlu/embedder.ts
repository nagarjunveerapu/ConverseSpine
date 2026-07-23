import type { Env } from '../env.js';
import { gapFillTau, projectIntentVector } from './intent-projection.js';

/** Default only — env.SIL_EMBED_MODEL is the single source of truth so the
 *  query side can never drift from the index side. */
const DEFAULT_EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';

/** Vectorize + Workers AI intent match — optional when bindings wired. */
export class IntentEmbedder {
  constructor(private readonly env: Env) {}

  async matchIntent(buyerText: string, builderId: string): Promise<{ kind: string; score: number } | null> {
    if (!this.env.INTENT_VECTORS || !this.env.AI) return null;

    const model = this.env.SIL_EMBED_MODEL || DEFAULT_EMBED_MODEL;
    const embed = await this.env.AI.run(model as never, { text: [buyerText] }) as {
      data?: number[][];
    };
    const raw = embed.data?.[0];
    if (!raw) return null;
    const vector = projectIntentVector(this.env, raw);

    const results = await this.env.INTENT_VECTORS.query(vector, {
      topK: 3,
      returnMetadata: 'all',
      filter: { builder_scope: builderId },
    });

    const top = results.matches?.[0];
    if (!top?.metadata || typeof top.metadata.intent_kind !== 'string') return null;
    const score = top.score ?? 0;
    if (score < gapFillTau(this.env)) return null;
    return { kind: top.metadata.intent_kind as string, score };
  }
}
