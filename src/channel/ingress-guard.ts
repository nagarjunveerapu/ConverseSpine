/**
 * Ingress guards (Spine hardening W6) — webhook dedupe + inbound rate limit.
 *
 * Both ride the existing TURN_CACHE KV. KV get→put has a race window, so
 * counters are approximate — deliberate: at beta scale a rare duplicate slip
 * costs one LLM call, while an exact counter would cost a Durable Object to
 * operate forever (rejected in the LLD; the upgrade path slots behind these
 * same two functions if real-volume abuse ever shows up).
 *
 * Scope: INBOUND BUYER traffic only. Staff-side advisor turns and
 * x-bot-secret callers are never throttled — the callers enforce that.
 */

/** Max inbound buyer messages per window before we stop spending LLM turns. */
export const RATE_LIMIT_MAX = 20;
/** Fixed rate-limit window (ms). */
export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
/** How long a seen webhook message id stays deduped (Meta retries same-day). */
const WAMID_TTL_S = 24 * 60 * 60;

/**
 * Meta delivers webhooks at-least-once (it retries on slow/non-200 responses).
 * True = this message id was already accepted — skip it entirely.
 * Marks the id as seen immediately, so retries arriving mid-processing dedupe too.
 */
export async function seenWebhookMessage(kv: KVNamespace | undefined, wamid: string): Promise<boolean> {
  if (!kv || !wamid) return false;
  const key = `wamid:${wamid}`;
  if (await kv.get(key)) return true;
  await kv.put(key, '1', { expirationTtl: WAMID_TTL_S });
  return false;
}

/**
 * Fixed-window inbound counter. True = over the cap, drop the turn (the
 * caller acks the webhook with 200 regardless — Meta must not retry spam).
 */
export async function overRateLimit(
  kv: KVNamespace | undefined,
  scopeKey: string,
  nowMs: number,
): Promise<boolean> {
  if (!kv) return false;
  const bucket = Math.floor(nowMs / RATE_LIMIT_WINDOW_MS);
  const key = `rl:${scopeKey}:${bucket}`;
  const n = parseInt((await kv.get(key)) ?? '0', 10);
  if (n >= RATE_LIMIT_MAX) return true;
  await kv.put(key, String(n + 1), { expirationTtl: Math.ceil((RATE_LIMIT_WINDOW_MS * 2) / 1000) });
  return false;
}
