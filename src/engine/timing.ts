/**
 * Where the turn actually spends its time.
 *
 * There was no answer to that question. Not one stopwatch in the engine:
 * `messages.llm_latency_ms` is 0 across every row, and `tool_runs.latency_ms`
 * is the literal `0` in the ledger writer. So a turn measured at 43.9s from a
 * client could be the search, the LLM, the Desk writes or the network, and
 * nothing in the system could tell us which.
 *
 * The marks land in `debug.timing` on every response, which means a test run
 * driving the API captures them for free, and in the ledger so they survive.
 *
 * Cost is a `Date.now()` per boundary. This is measurement, not sampling —
 * every turn is timed, because the slow ones are the point and a sampler
 * would miss exactly the tail we are chasing.
 */

/** Milliseconds spent in each phase, in the order they ran. */
export type TurnTiming = Record<string, number>;

export class Stopwatch {
  private readonly t0: number;
  private last: number;
  private readonly marks: Array<[string, number]> = [];

  constructor(now: () => number = Date.now) {
    this.now = now;
    this.t0 = now();
    this.last = this.t0;
  }

  private readonly now: () => number;

  /** Close the phase that just ended. Repeat names accumulate. */
  mark(phase: string): void {
    const t = this.now();
    const dt = t - this.last;
    this.last = t;
    const existing = this.marks.find((m) => m[0] === phase);
    if (existing) existing[1] += dt;
    else this.marks.push([phase, dt]);
  }

  /** Phases plus `total`, which is wall clock and not the sum — the gap
   *  between them is time nobody claimed, and that gap is worth seeing. */
  summary(): TurnTiming {
    const out: TurnTiming = {};
    for (const [k, v] of this.marks) out[k] = v;
    out.total = this.now() - this.t0;
    return out;
  }
}
