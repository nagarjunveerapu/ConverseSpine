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

function env(): Env {
  return { NAYADESK_URL: 'https://desk.test', BOT_SHARED_SECRET: 'shh' } as unknown as Env;
}

function ctx(): { ctx: ExecutionContext; settle: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => {} } as ExecutionContext,
    settle: async () => { await Promise.all(pending); },
  };
}

function payload(value: Record<string, unknown>): Request {
  return new Request('https://spine.test/webhook/whatsapp', {
    method: 'POST',
    body: JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, ...value } }] }],
    }),
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
    const res = await handleWhatsAppWebhook(payload({
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
    const res = await handleWhatsAppWebhook(payload({}), env(), c);
    await settle();

    expect(res.status).toBe(200);
    expect(posts.filter((p) => p.url.includes('/api/whatsapp/delivery'))).toHaveLength(0);
  });
});
