/**
 * Embedder-only probe — measurement surface for "how good is the intent
 * embedding, really?"
 *
 * `classifyTurnRouting` reaches the embedder only when a visit rule, the
 * speech-act projection and the rule ladder ALL defer, and the speech act is
 * unknown. In normal traffic that is rarely true, so the embedding layer's
 * quality is invisible from production behaviour. This runs the SAME
 * `embedderRouting` the engine uses, with those gates bypassed, so its verdict
 * can be scored against the held-out corpus split it never trained on.
 *
 * Measurement only, dev-gated (`SIL_EVAL_ENABLED`). It never affects a turn.
 */
import type { Env } from '../env.js';
import { embedderRouting } from '../engine/turn-routing/classify.js';
import type { TurnRoutingInput } from '../engine/turn-routing/types.js';

export interface SilProbeItem {
  text: string;
  /** Ground-truth intent_kind from the corpus row, echoed back for scoring. */
  expected?: string;
}

export interface SilProbeResult {
  text: string;
  expected?: string;
  top_kind?: string;
  top_score?: number;
  margin?: number;
  miss_reason?: string;
  /** What the embedder verdict would route to, or '' when it binds nothing. */
  routing: string;
  /** Ranked candidates behind the bind. A distinct SECOND intent above tau is
   *  what a multi-intent turn looks like, and it is invisible from top_kind. */
  top_matches?: { id?: string; kind: string; score: number }[];
}

export async function runSilProbe(
  env: Env,
  builderId: string,
  items: SilProbeItem[],
): Promise<SilProbeResult[]> {
  const out: SilProbeResult[] = [];
  for (const item of items) {
    // Deliberately state-free: `discover` phase, no focus, no named projects.
    // That is the point — this measures what the EMBEDDING alone knows, with no
    // conversation state to lean on, which is exactly the "if we only depended
    // on the embedder" question.
    const input: TurnRoutingInput = {
      text: item.text,
      builder_id: builderId,
      phase: 'discover',
      named_project_ids: [],
    };
    try {
      const r = await embedderRouting(env, input);
      out.push({
        text: item.text,
        ...(item.expected ? { expected: item.expected } : {}),
        ...(r.top_kind !== undefined ? { top_kind: r.top_kind } : {}),
        ...(r.top_score !== undefined ? { top_score: r.top_score } : {}),
        ...(r.margin !== undefined ? { margin: r.margin } : {}),
        ...(r.miss_reason !== undefined ? { miss_reason: r.miss_reason } : {}),
        routing: r.result?.routing ?? '',
        ...(r.top_matches ? { top_matches: r.top_matches } : {}),
      });
    } catch (err) {
      out.push({
        text: item.text,
        ...(item.expected ? { expected: item.expected } : {}),
        miss_reason: `error:${err instanceof Error ? err.message.slice(0, 80) : 'unknown'}`,
        routing: '',
      });
    }
  }
  return out;
}
