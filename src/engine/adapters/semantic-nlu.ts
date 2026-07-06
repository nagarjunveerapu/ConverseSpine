import type { Env } from '../../env.js';
import type { AnswerTopic, ConversationState, Extracted } from '../types.js';
import { detectTopics } from '../facts.js';

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
const TOPIC_THRESHOLD = 0.72;
const LOCATION_THRESHOLD = 0.78;

const INTENT_TO_TOPIC: Record<string, AnswerTopic> = {
  get_price: 'price',
  get_legal_info: 'legal',
  get_unit_configs: 'availability',
  get_media: 'media',
  compare_projects: 'compare',
  find_projects: 'availability',
  book_visit: 'availability',
};

export interface SemanticNluPort {
  enrich(text: string, builderId: string, ex: Extracted, ctx: SemanticContext): Promise<Extracted>;
}

export interface SemanticContext {
  phase: ConversationState['phase'];
  microMarkets: readonly string[];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embedTexts(ai: Env['AI'], texts: string[]): Promise<number[][]> {
  if (!ai || texts.length === 0) return [];
  const resp = (await ai.run(EMBED_MODEL, { text: texts })) as { data?: number[][] };
  return resp.data ?? [];
}

export function makeSemanticNlu(env: Env): SemanticNluPort {
  return {
    async enrich(text, builderId, ex, ctx): Promise<Extracted> {
      if (!env.AI) return ex;
      let next = ex;
      const topics = ex.askTopics?.length ? ex.askTopics : detectTopics(text);

      if (topics.length === 0 && env.INTENT_VECTORS) {
        const vectors = await embedTexts(env.AI, [text]);
        const query = vectors[0];
        if (query) {
          const results = await env.INTENT_VECTORS.query(query, {
            topK: 3,
            returnMetadata: 'all',
            filter: { builder_scope: builderId },
          }).catch(() => null);
          const top = results?.matches?.[0];
          const kind =
            top?.metadata && typeof top.metadata.intent_kind === 'string'
              ? (top.metadata.intent_kind as string)
              : '';
          const score = top?.score ?? 0;
          const topic = INTENT_TO_TOPIC[kind];
          if (topic && score >= TOPIC_THRESHOLD) {
            next = {
              ...next,
              askTopic: next.askTopic ?? topic,
              askTopics: next.askTopics?.length ? next.askTopics : [topic],
            };
          }
        }
      }

      if (!next.constraints.location && ctx.microMarkets.length > 0) {
        const locHint =
          /\b(?:in|near|around|at|projects?\s+in)\s+([A-Za-z][A-Za-z\s/.-]{2,40})/i.exec(text)?.[1]?.trim() ??
          text.trim();
        if (locHint.length >= 3) {
          const batch = [locHint, ...ctx.microMarkets.slice(0, 24)];
          const vectors = await embedTexts(env.AI, batch);
          if (vectors.length === batch.length) {
            const q = vectors[0]!;
            let bestIdx = -1;
            let bestScore = 0;
            for (let i = 1; i < vectors.length; i++) {
              const score = cosine(q, vectors[i]!);
              if (score > bestScore) {
                bestScore = score;
                bestIdx = i - 1;
              }
            }
            if (bestIdx >= 0 && bestScore >= LOCATION_THRESHOLD) {
              next = {
                ...next,
                constraints: { ...next.constraints, location: ctx.microMarkets[bestIdx] },
              };
            }
          }
        }
      }

      return next;
    },
  };
}

export function noopSemanticNlu(): SemanticNluPort {
  return { async enrich(_t, _b, ex) { return ex; } };
}
