import { describe, it, expect } from 'vitest';
import { seenWebhookMessage, overRateLimit, RATE_LIMIT_MAX } from '../src/channel/ingress-guard.js';

/** Minimal in-memory KV double (get/put with TTL ignored). */
function fakeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) { return store.get(key) ?? null; },
    async put(key: string, value: string) { store.set(key, value); },
  } as unknown as KVNamespace;
}

describe('W6 ingress guards', () => {
  it('dedupes a retried webhook message id (Meta at-least-once delivery)', async () => {
    const kv = fakeKv();
    expect(await seenWebhookMessage(kv, 'wamid.abc')).toBe(false); // first delivery
    expect(await seenWebhookMessage(kv, 'wamid.abc')).toBe(true);  // retry → dropped
    expect(await seenWebhookMessage(kv, 'wamid.def')).toBe(false); // different id fine
  });

  it('fails open without KV — never blocks a real buyer on infra absence', async () => {
    expect(await seenWebhookMessage(undefined, 'wamid.abc')).toBe(false);
    expect(await overRateLimit(undefined, 'b:1', Date.now())).toBe(false);
  });

  it(`caps a flooding number at ${RATE_LIMIT_MAX} per window; other buyers unaffected`, async () => {
    const kv = fakeKv();
    const now = 1_750_000_000_000; // fixed → single bucket
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect(await overRateLimit(kv, 'brigade:919000000001', now + i)).toBe(false);
    }
    expect(await overRateLimit(kv, 'brigade:919000000001', now + 999)).toBe(true);   // 21st drops
    expect(await overRateLimit(kv, 'brigade:919000000002', now + 999)).toBe(false); // neighbor fine
  });

  it('the window resets in the next bucket', async () => {
    const kv = fakeKv();
    const now = 1_750_000_000_000;
    for (let i = 0; i <= RATE_LIMIT_MAX; i++) await overRateLimit(kv, 'b:x', now);
    expect(await overRateLimit(kv, 'b:x', now)).toBe(true);
    expect(await overRateLimit(kv, 'b:x', now + 5 * 60 * 1000)).toBe(false); // next bucket
  });
});
