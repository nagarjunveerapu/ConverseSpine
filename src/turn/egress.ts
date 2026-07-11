import type { TurnRuntime } from '../runtime/deps.js';
import type { UnderstandResult } from '../types.js';
import type { Env } from '../env.js';

/** Fire-and-forget BPE egress after reply ships. */
export function postTurnEgress(
  rt: TurnRuntime,
  ctx: ExecutionContext | undefined,
  input: {
    builder_id: string;
    buyer_phone: string;
    conversation_id: string;
    buyer_text: string;
    understood: UnderstandResult;
    visitBooked: boolean;
    project_id?: string;
  },
): void {
  const observations: Array<{ fact_key: string; value: unknown; provenance: string; confidence?: number }> =
    input.understood.slot_writes.map((w) => ({
      fact_key: w.slot,
      value: w.value,
      provenance: 'regex',
      confidence: 0.9,
    }));

  if (input.visitBooked && input.project_id) {
    observations.push({
      fact_key: 'visit_booked',
      value: { project_id: input.project_id, at: new Date().toISOString() },
      provenance: 'regex',
      confidence: 1,
    });
  }

  if (observations.length === 0) return;

  const postObs = rt.crm
    .postProfileObservations({
      builder_id: input.builder_id,
      buyer_phone: input.buyer_phone,
      conversation_id: input.conversation_id,
      observations,
    })
    .catch(() => undefined);

  const kinds = input.understood.intents.map((i) => i.kind);
  const postJourney = rt.crm
    .postJourneySignals({
      builder_id: input.builder_id,
      buyer_phone: input.buyer_phone,
      conversation_id: input.conversation_id,
      signals: {
        intents: kinds,
        visit_booked: input.visitBooked,
        slots_filled: input.understood.slot_writes.map((s) => s.slot),
      },
    })
    .catch(() => undefined);

  const env = rt.env as Env;
  const work = Promise.all([postObs, postJourney]).then(() => {
    return env.TURN_CACHE?.delete(`ctx:${input.conversation_id}`);
  });

  if (ctx) ctx.waitUntil(work);
  else void work;
}
