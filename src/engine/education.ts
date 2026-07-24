import type { Env } from '../env.js';
import type { NayaDeskClient } from '../crm/nayadesk-client.js';
import { EDUCATION_TAU } from '../rebuild/education-index.js';

export interface EducationEvidence {
  entryId: string;
  topicKey: string;
  jurisdiction: 'india' | 'karnataka';
  domain?: string;
  question: string;
  answer: string;
  whatToCheck?: string;
  disclaimer?: string;
  score?: number;
  match: 'vector' | 'lookup';
}

function preferJurisdiction<T extends { jurisdiction: string }>(
  rows: T[],
  prefer: 'india' | 'karnataka',
): T | null {
  if (!rows.length) return null;
  return rows.find((r) => r.jurisdiction === prefer) ?? rows.find((r) => r.jurisdiction === 'india') ?? rows[0] ?? null;
}

export function speakEducation(edu: EducationEvidence): string {
  const parts = [edu.answer.trim()];
  if (edu.whatToCheck?.trim()) parts.push(edu.whatToCheck.trim());
  if (edu.disclaimer?.trim()) parts.push(edu.disclaimer.trim());
  return parts.join(' ');
}

/**
 * Resolve a definition ask against the dedicated education index, falling back
 * to Desk lexical lookup when Vectorize is unbound or below tau.
 */
export async function educationSearch(
  crm: NayaDeskClient,
  text: string,
  opts: {
    jurisdiction?: 'india' | 'karnataka';
    env?: Pick<Env, 'AI' | 'EDUCATION_VECTORS' | 'SIL_EMBED_MODEL'>;
  } = {},
): Promise<EducationEvidence | null> {
  const q = text.trim();
  if (!q) return null;
  const prefer = opts.jurisdiction ?? 'karnataka';
  const env = opts.env;

  if (env?.AI && env.EDUCATION_VECTORS) {
    try {
      const model = env.SIL_EMBED_MODEL || '@cf/baai/bge-base-en-v1.5';
      const embedded = (await env.AI.run(model as never, { text: [q] })) as { data?: number[][] };
      const vector = embedded.data?.[0];
      if (vector?.length) {
        const results = await env.EDUCATION_VECTORS.query(vector, {
          topK: 8,
          returnMetadata: 'all',
        });
        const matches = (results.matches ?? [])
          .filter((m) => (m.score ?? 0) >= EDUCATION_TAU)
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        const byTopic = new Map<string, Array<{ score: number; entry_id: string; jurisdiction: string; topic_key: string; domain?: string }>>();
        for (const m of matches) {
          const meta = (m.metadata ?? {}) as Record<string, unknown>;
          const topic_key = String(meta.topic_key ?? '');
          const entry_id = String(meta.entry_id ?? '');
          if (!topic_key || !entry_id) continue;
          const arr = byTopic.get(topic_key) ?? [];
          arr.push({
            score: m.score ?? 0,
            entry_id,
            jurisdiction: String(meta.jurisdiction ?? 'india'),
            topic_key,
            domain: meta.domain ? String(meta.domain) : undefined,
          });
          byTopic.set(topic_key, arr);
        }
        const topTopic = [...byTopic.entries()].sort(
          (a, b) => Math.max(...b[1].map((x) => x.score)) - Math.max(...a[1].map((x) => x.score)),
        )[0];
        if (topTopic) {
          const preferred = preferJurisdiction(
            topTopic[1].map((x) => ({ ...x, jurisdiction: x.jurisdiction as 'india' | 'karnataka' })),
            prefer,
          );
          if (preferred) {
            const looked = await crm.buyerEducationLookup({ topic_key: preferred.topic_key, jurisdiction: prefer });
            const entry = looked.entry;
            if (entry) {
              return {
                entryId: entry.entry_id,
                topicKey: entry.topic_key,
                jurisdiction: entry.jurisdiction,
                domain: entry.domain,
                question: entry.canonical_question,
                answer: entry.approved_answer,
                whatToCheck: entry.what_to_check || undefined,
                disclaimer: entry.disclaimer || undefined,
                score: preferred.score,
                match: 'vector',
              };
            }
          }
        }
      }
    } catch {
      /* fall through to Desk lookup */
    }
  }

  try {
    const looked = await crm.buyerEducationLookup({ q, jurisdiction: prefer });
    const entry = looked.entry;
    if (!entry) return null;
    return {
      entryId: entry.entry_id,
      topicKey: entry.topic_key,
      jurisdiction: entry.jurisdiction,
      domain: entry.domain,
      question: entry.canonical_question,
      answer: entry.approved_answer,
      whatToCheck: entry.what_to_check || undefined,
      disclaimer: entry.disclaimer || undefined,
      score: looked.score,
      match: 'lookup',
    };
  } catch {
    return null;
  }
}
