/**
 * A tap on a template quick-reply arrives as `messages[].type === "button"`
 * with the label in `button.text` — a different wire shape from the
 * interactive `button_reply` the webhook has always handled. Before the
 * `button` branch existed, every such tap fell through the `!buyerText` guard
 * and vanished: the buyer tapped "Book a site visit" on the opening template
 * and nothing happened at all.
 *
 * The label is the only field read. `button.payload` defaults to the label
 * when the send named none (ours never do), so it is not an id from our
 * interactive vocabulary — the tap must flow as the buyer's WORDS, not as an
 * action_id the engine would try to look up.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleWhatsAppWebhook } from '../src/webhook/whatsapp.js';
import type { Env } from '../src/env.js';

const PHONE_NUMBER_ID = '773311992244001';
const BUILDER = 'brigade-group';

function ctx(): { ctx: ExecutionContext; settle: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => {} } as ExecutionContext,
    settle: async () => { await Promise.all(pending); },
  };
}

/** A fake TURN_DEBOUNCER that records every enqueue body. */
function fakeDebouncer(): { ns: DurableObjectNamespace; enqueues: Array<Record<string, unknown>> } {
  const enqueues: Array<Record<string, unknown>> = [];
  const ns = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (_url: string, init?: RequestInit) => {
        enqueues.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return new Response('ok');
      },
    }),
  } as unknown as DurableObjectNamespace;
  return { ns, enqueues };
}

function payload(messages: Array<Record<string, unknown>>): Request {
  return new Request('https://spine.test/webhook/whatsapp', {
    method: 'POST',
    body: JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, messages } }] }],
    }),
  });
}

describe('a template quick-reply tap', () => {
  let enqueues: Array<Record<string, unknown>>;
  let env: Env;

  beforeEach(() => {
    const fake = fakeDebouncer();
    enqueues = fake.enqueues;
    env = {
      NAYADESK_URL: 'https://desk.test',
      BOT_SHARED_SECRET: 'shh',
      TURN_DEBOUNCER: fake.ns,
    } as unknown as Env;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/builders')) {
        return new Response(JSON.stringify({
          builders: [{ builder_id: BUILDER, meta_phone_number_id: PHONE_NUMBER_ID }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
  });

  it('becomes the buyer’s words, not a dropped message', async () => {
    const { ctx: c, settle } = ctx();
    const res = await handleWhatsAppWebhook(payload([{
      from: '15556287583',
      id: 'wamid.tap.1',
      type: 'button',
      button: { text: 'Book a site visit', payload: 'Book a site visit' },
    }]), env, c);
    await settle();

    expect(res.status).toBe(200);
    expect(enqueues).toHaveLength(1);
    expect(enqueues[0]).toMatchObject({
      builder_id: BUILDER,
      buyer_phone: '+15556287583',
      phone_number_id: PHONE_NUMBER_ID,
      text: 'Book a site visit',
      meta_message_id: 'wamid.tap.1',
    });
    // The payload is NOT an action_id — the engine would try to resolve it
    // against the interactive vocabulary and fail. Words, not ids.
    expect(enqueues[0]!.action_id).toBeUndefined();
  });

  it('with no label still acks 200 and enqueues nothing', async () => {
    const { ctx: c, settle } = ctx();
    const res = await handleWhatsAppWebhook(payload([{
      from: '15556287583',
      id: 'wamid.tap.2',
      type: 'button',
      button: {},
    }]), env, c);
    await settle();

    expect(res.status).toBe(200);
    expect(enqueues).toHaveLength(0);
  });

  it('rides the same batch as an ordinary text without stealing its turn', async () => {
    const { ctx: c, settle } = ctx();
    await handleWhatsAppWebhook(payload([
      { from: '15556287583', id: 'wamid.tap.3', type: 'button', button: { text: 'Show my details' } },
      { from: '15556287583', id: 'wamid.txt.1', type: 'text', text: { body: 'and the price?' } },
    ]), env, c);
    await settle();

    expect(enqueues.map((e) => e.text)).toEqual(['Show my details', 'and the price?']);
  });
});
