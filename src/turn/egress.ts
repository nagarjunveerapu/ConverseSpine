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
    thread_id: string;
    buyer_text: string;
    understood: UnderstandResult;
    visitBooked: boolean;
    project_id?: string;
    /** Resolved IST instant for the booked slot (engine/visit-slot.ts). */
    visit_iso?: string;
    /** What the buyer actually said — kept for display, never for arithmetic. */
    visit_label?: string;
  },
): void {
  const observations: Array<{ fact_key: string; value: unknown; provenance: string; confidence?: number }> =
    input.understood.slot_writes.map((w) => ({
      fact_key: w.slot,
      value: w.value,
      provenance: 'regex',
      confidence: 0.9,
    }));

  // A visit is a fact only when the project AND the resolved instant travel
  // with it (Desk visit-fact-measurement.html, F1+F2). Anything less is a
  // plan, and a plan is not reported as a booking — the old shape sent the
  // journey signal while silently dropping the incomplete fact, which is how
  // Desk accumulated 296 "booked" visits it could never prove.
  const visitFactComplete = input.visitBooked && !!input.project_id && !!input.visit_iso;
  if (input.visitBooked && !visitFactComplete) {
    console.error('visit_booked dropped: incomplete fact', {
      thread_id: input.thread_id,
      has_project: !!input.project_id,
      has_iso: !!input.visit_iso,
    });
  }

  if (visitFactComplete) {
    observations.push({
      fact_key: 'visit_booked',
      value: {
        project_id: input.project_id,
        // WHEN THE VISIT IS. `at` below is when it was booked — the previous
        // shape carried only that, so Desk had a booking with no appointment.
        visit_iso: input.visit_iso,
        ...(input.visit_label ? { said: input.visit_label } : {}),
        at: new Date().toISOString(),
      },
      provenance: 'regex',
      confidence: 1,
    });
  }

  if (observations.length === 0) return;

  const postObs = rt.crm
    .postProfileObservations({
      builder_id: input.builder_id,
      buyer_phone: input.buyer_phone,
      thread_id: input.thread_id,
      observations,
    })
    .catch(() => undefined);

  const kinds = input.understood.intents.map((i) => i.kind);
  const postJourney = rt.crm
    .postJourneySignals({
      builder_id: input.builder_id,
      buyer_phone: input.buyer_phone,
      thread_id: input.thread_id,
      signals: {
        intents: kinds,
        // Same gate as the fact. The signal is what flips Desk's status to
        // visit_booked — sending it without the fact is the split brain.
        visit_booked: visitFactComplete,
        slots_filled: input.understood.slot_writes.map((s) => s.slot),
      },
    })
    .catch(() => undefined);

  const env = rt.env as Env;
  const work = Promise.all([postObs, postJourney]).then(() => {
    return env.TURN_CACHE?.delete(`ctx:${input.thread_id}`);
  });

  if (ctx) ctx.waitUntil(work);
  else void work;
}
