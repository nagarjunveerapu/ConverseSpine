import { describe, expect, it } from 'vitest';
import { Stopwatch } from '../src/engine/timing.js';

/**
 * A timing channel that silently reports nothing is worse than none — it looks
 * like the answer. `llm_latency_ms` is 0 on all 2,953 outbound rows and
 * `tool_runs.latency_ms` is a literal `0` in the ledger writer; both look like
 * instrumentation and neither ever measured anything.
 */
const fakeClock = (times: number[]) => {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)]!;
};

describe('the stopwatch measures what it claims to', () => {
  it('attributes each span to the phase that ended', () => {
    const sw = new Stopwatch(fakeClock([0, 10, 40, 100, 100]));
    sw.mark('load_state');   // 0 -> 10
    sw.mark('extract');      // 10 -> 40
    sw.mark('routing');      // 40 -> 100
    const t = sw.summary();
    expect(t.load_state).toBe(10);
    expect(t.extract).toBe(30);
    expect(t.routing).toBe(60);
  });

  it('reports total as wall clock, not the sum of the phases', () => {
    // The difference between them is time no phase claimed. Reporting the sum
    // as the total would hide exactly the unaccounted work worth finding.
    const sw = new Stopwatch(fakeClock([0, 10, 500]));
    sw.mark('extract');
    const t = sw.summary();
    expect(t.extract).toBe(10);
    expect(t.total).toBe(500);
    expect(t.total).toBeGreaterThan(t.extract);
  });

  it('accumulates a phase that runs more than once', () => {
    const sw = new Stopwatch(fakeClock([0, 5, 8, 13, 13]));
    sw.mark('desk_write');
    sw.mark('other');
    sw.mark('desk_write');
    expect(sw.summary().desk_write).toBe(10);
  });

  it('separates the post-reply writes, which is the whole argument', () => {
    // The reply text is final before these run. Timing them together with
    // compose would make the buyer's wait look like work on their answer.
    const sw = new Stopwatch(fakeClock([0, 1000, 4500, 4500]));
    sw.mark('compose');
    sw.mark('post_reply_writes');
    const t = sw.summary();
    expect(t.compose).toBe(1000);
    expect(t.post_reply_writes).toBe(3500);
  });
});
