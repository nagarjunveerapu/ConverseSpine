/**
 * Meta answers every send twice: once synchronously, and once — minutes later
 * — on this webhook, saying whether the message actually reached the handset.
 * The second answer is the only place a message Graph ACCEPTED and then failed
 * to deliver becomes knowable, and it is the answer that explains a welcome
 * that never arrived while the Desk thread said it had.
 *
 * Spine has been receiving these on every bot message since the webhook
 * existed. `if (!phoneNumberId || !value?.messages?.length) continue;` dropped
 * every one of them: a status-only change carries no `messages` at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleWhatsAppWebhook } from '../src/webhook/whatsapp.js';
import type { Env } from '../src/env.js';

const PHONE_NUMBER_ID = '773311992244001';
const BUILDER = 'brigade-group';

const APP_SECRET = 'test-app-secret';

function env(): Env {
  return {
    NAYADESK_URL: 'https://desk.test',
    BOT_SHARED_SECRET: 'shh',
    // The webhook refuses an unsigned payload now, so these have to sign like
    // Meta does. They used to pass BECAUSE verification was skipped whenever
    // no secret resolved — the suite was resting on the fail-open.
    META_APP_SECRET: APP_SECRET,
  } as unknown as Env;
}

/** X-Hub-Signature-256 exactly as Meta computes it: HMAC-SHA256 of the raw body. */
async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `sha256=${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function ctx(): { ctx: ExecutionContext; settle: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => {} } as ExecutionContext,
    settle: async () => { await Promise.all(pending); },
  };
}

async function payload(value: Record<string, unknown>): Promise<Request> {
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, ...value } }] }],
  });
  return new Request('https://spine.test/webhook/whatsapp', {
    method: 'POST',
    body,
    headers: { 'x-hub-signature-256': await sign(body) },
  });
}

describe('a status-only webhook', () => {
  let posts: Array<{ url: string; body: any }>;

  beforeEach(() => {
    posts = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/builders')) {
        return new Response(JSON.stringify({
          builders: [{ builder_id: BUILDER, meta_phone_number_id: PHONE_NUMBER_ID }],
        }), { status: 200 });
      }
      posts.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true, matched: 1 }), { status: 200 });
    }));
  });

  it('files Meta’s verdict against the row instead of being discarded', async () => {
    const { ctx: c, settle } = ctx();
    const res = await handleWhatsAppWebhook(await payload({
      statuses: [
        { id: 'wamid.welcome', status: 'failed', recipient_id: '919000000001', errors: [
          { code: 131049, title: 'Not delivered', error_data: { details: 'Meta chose not to deliver this message.' } },
        ] },
        { id: 'wamid.card', status: 'delivered', recipient_id: '919000000001' },
      ],
    }), env(), c);
    await settle();

    expect(res.status).toBe(200);
    const filed = posts.find((p) => p.url.includes('/api/whatsapp/delivery'));
    expect(filed, 'the status webhook must reach Desk').toBeTruthy();
    expect(filed!.body.builder_id).toBe(BUILDER);
    expect(filed!.body.reports).toEqual([
      { wamid: 'wamid.welcome', status: 'failed', detail: '131049: Meta chose not to deliver this message.' },
      { wamid: 'wamid.card', status: 'delivered' },
    ]);
  });

  it('still acks and files nothing when the change carries neither messages nor statuses', async () => {
    const { ctx: c, settle } = ctx();
    const res = await handleWhatsAppWebhook(await payload({}), env(), c);
    await settle();

    expect(res.status).toBe(200);
    expect(posts.filter((p) => p.url.includes('/api/whatsapp/delivery'))).toHaveLength(0);
  });
});
