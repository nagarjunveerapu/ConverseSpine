import { describe, expect, it } from 'vitest';
import { TurnDebouncer } from '../src/agent/turn_debouncer.js';
import type { Env } from '../src/env.js';

/**
 * Meta delivers webhooks at-least-once. The guard used to sit in KV, which is
 * a cache with a per-colo negative window — a retry that lands elsewhere reads
 * the id as unseen and the buyer is answered twice, the same words in the same
 * thread. Every message for one buyer routes through this DO, and DO storage
 * is strongly consistent, so the guard is tested here.
 */
function fakeState() {
  const store = new Map<string, unknown>();
  let alarm: number | null = null;
  return {
    storage: {
      get: async <T>(k: string) => store.get(k) as T | undefined,
      put: async (k: string, v: unknown) => void store.set(k, v),
      getAlarm: async () => alarm,
      setAlarm: async (t: number) => void (alarm = t),
    },
    _store: store,
  } as unknown as DurableObjectState & { _store: Map<string, unknown> };
}

function enqueue(dob: TurnDebouncer, wamid: string, text = 'Hi'): Promise<Response> {
  return dob.fetch(
    new Request('https://debouncer/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        builder_id: 'brigade-group',
        buyer_phone: '+919900000001',
        phone_number_id: 'pn1',
        text,
        meta_message_id: wamid,
      }),
    }),
  );
}

describe('TurnDebouncer retry guard', () => {
  it('accepts a message id once and drops the retry', async () => {
    const state = fakeState();
    const dob = new TurnDebouncer(state, {} as Env);

    const first = (await (await enqueue(dob, 'wamid.A')).json()) as Record<string, unknown>;
    const retry = (await (await enqueue(dob, 'wamid.A')).json()) as Record<string, unknown>;

    expect(first).toMatchObject({ queued: true, inbox_size: 1 });
    expect(retry).toMatchObject({ deduped: true });
    // The retry must not leave a second turn behind to answer.
    expect((state._store.get('inbox') as unknown[]).length).toBe(1);
  });

  it('still queues genuinely different messages', async () => {
    const state = fakeState();
    const dob = new TurnDebouncer(state, {} as Env);

    await enqueue(dob, 'wamid.A', 'Hi');
    const second = (await (await enqueue(dob, 'wamid.B', '2 BHK')).json()) as Record<string, unknown>;

    expect(second).toMatchObject({ queued: true, inbox_size: 2 });
  });

  it('remembers recent ids without growing without bound', async () => {
    const state = fakeState();
    const dob = new TurnDebouncer(state, {} as Env);

    for (let i = 0; i < 60; i++) await enqueue(dob, `wamid.${i}`);

    expect((state._store.get('seen_wamids') as string[]).length).toBe(50);
    // The most recent id is still guarded; a very old one has aged out.
    expect((await (await enqueue(dob, 'wamid.59')).json()) as unknown).toMatchObject({
      deduped: true,
    });
  });
});
