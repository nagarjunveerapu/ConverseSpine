import type { Env } from '../env.js';

interface TraceSpan {
  name: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
}

/** Langfuse HTTP ingest — optional, non-blocking. */
export class LangfuseTracer {
  private enabled: boolean;
  private auth: string;
  private base: string;

  constructor(env: Env) {
    this.enabled = Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY);
    this.base = (env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com').replace(/\/+$/, '');
    this.auth = this.enabled
      ? `Basic ${btoa(`${env.LANGFUSE_PUBLIC_KEY}:${env.LANGFUSE_SECRET_KEY}`)}`
      : '';
  }

  async traceTurn(
    ctx: ExecutionContext | undefined,
    payload: {
      conversation_id: string;
      turn_index: number;
      buyer_text: string;
      reply_text: string;
      composer: string;
      spans: TraceSpan[];
    },
  ): Promise<void> {
    if (!this.enabled) return;
    const body = {
      batch: [
        {
          id: crypto.randomUUID(),
          type: 'trace-create',
          timestamp: new Date().toISOString(),
          body: {
            id: `${payload.conversation_id}:${payload.turn_index}`,
            name: 'converse-spine-turn',
            input: payload.buyer_text,
            output: payload.reply_text,
            metadata: {
              composer: payload.composer,
              conversation_id: payload.conversation_id,
              turn_index: payload.turn_index,
            },
          },
        },
        ...payload.spans.map((s) => ({
          id: crypto.randomUUID(),
          type: 'span-create',
          timestamp: new Date().toISOString(),
          body: {
            traceId: `${payload.conversation_id}:${payload.turn_index}`,
            name: s.name,
            input: s.input,
            output: s.output,
            metadata: s.metadata,
          },
        })),
      ],
    };

    const send = () =>
      fetch(`${this.base}/api/public/ingestion`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: this.auth },
        body: JSON.stringify(body),
      }).catch(() => undefined);

    if (ctx) ctx.waitUntil(send());
    else await send();
  }
}
