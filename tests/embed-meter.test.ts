import { describe, expect, it } from 'vitest';
import { meterAi, newEmbedMeter } from '../src/cache/embed-meter.js';

/** A fake `Ai` binding with a controllable clock, so timings are exact. */
function fakeAi(opts?: { costMs?: number; throwOn?: number }) {
  let now = 0;
  let call = 0;
  const ai = {
    async run(_model: string, input: { text: string | string[] }) {
      call += 1;
      now += opts?.costMs ?? 10;
      if (opts?.throwOn === call) throw new Error('AI unavailable');
      const n = Array.isArray(input.text) ? input.text.length : 1;
      return { data: Array.from({ length: n }, () => [0.1, 0.2]) };
    },
    other: 'passthrough',
  };
  return { ai, nowMs: () => now };
}

describe('embed meter', () => {
  it('counts one call and one text for a single embed', async () => {
    const { ai, nowMs } = fakeAi();
    const meter = newEmbedMeter();
    const metered = meterAi(ai, meter, nowMs);

    await metered.run('@cf/baai/bge-base-en-v1.5', { text: ['find me a 2bhk'] });

    expect(meter.calls).toBe(1);
    expect(meter.texts).toBe(1);
    expect(meter.ms).toBe(10);
  });

  it('separates calls from texts — the batching lever', async () => {
    const { ai, nowMs } = fakeAi();
    const meter = newEmbedMeter();
    const metered = meterAi(ai, meter, nowMs);

    // What the micro-market lane does today: one call, many texts.
    await metered.run('m', { text: ['a', 'b', 'c', 'd'] });
    // What three serial clause embeds look like: three calls, three texts.
    await metered.run('m', { text: ['x'] });
    await metered.run('m', { text: ['y'] });
    await metered.run('m', { text: ['z'] });

    expect(meter.calls).toBe(4);
    expect(meter.texts).toBe(7);
    // Price is per call, so 4 calls cost 4× the fixed overhead regardless of
    // how the 7 texts are distributed. That is what U2 has to move.
    expect(meter.ms).toBe(40);
  });

  it('still times and counts a call that threw', async () => {
    const { ai, nowMs } = fakeAi({ throwOn: 1 });
    const meter = newEmbedMeter();
    const metered = meterAi(ai, meter, nowMs);

    await expect(metered.run('m', { text: ['boom'] })).rejects.toThrow('AI unavailable');

    // A three-second failure is exactly the tail worth seeing — dropping it
    // would make the meter read healthiest on the worst turns.
    expect(meter.calls).toBe(1);
    expect(meter.ms).toBe(10);
  });

  it('accumulates across lanes into one per-turn total', async () => {
    const { ai, nowMs } = fakeAi();
    const meter = newEmbedMeter();
    // Two different lanes handed the same wrapped binding, as deps.ts does.
    const routing = meterAi(ai, meter, nowMs);
    const semantic = meterAi(ai, meter, nowMs);

    await routing.run('m', { text: ['intent'] });
    await semantic.run('m', { text: ['project name'] });

    expect(meter.calls).toBe(2);
    expect(meter.ms).toBe(20);
  });

  it('passes non-run members through untouched', async () => {
    const { ai, nowMs } = fakeAi();
    const meter = newEmbedMeter();
    const metered = meterAi(ai, meter, nowMs);

    expect(metered.other).toBe('passthrough');
    expect(meter.calls).toBe(0);
  });

  it('counts a bare string as one text', async () => {
    const { ai, nowMs } = fakeAi();
    const meter = newEmbedMeter();
    const metered = meterAi(ai, meter, nowMs);

    await metered.run('m', { text: 'not an array' });

    expect(meter.texts).toBe(1);
  });
});
