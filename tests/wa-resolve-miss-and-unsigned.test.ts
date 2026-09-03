/**
 * Two ways a buyer's message used to disappear between Meta and a reply.
 *
 * 1. THE MINUTE AFTER CONNECTING. The number→builder map is memoised for 60s
 *    and a miss did not refresh it. So a tenant connected 20 seconds ago was
 *    not in the map, the lookup missed, and the caller dropped the message on
 *    `if (!builderId) continue` — silently, answering Meta 200, which records
 *    it as delivered. It healed by itself a minute later, which reads as
 *    flakiness rather than as a cache, and it lands exactly on the operator
 *    who was told to text the number to verify the connection.
 *
 * 2. NO SECRET, NO CHECK. `if (secret && !verify(...))` skipped verification
 *    entirely whenever no secret resolved. Prod has no META_APP_SECRET set and
 *    no builder has a per-tenant one, so on prod that branch never ran. The
 *    payload is not inert: it is written to the CRM and it makes the bot send
 *    real WhatsApp messages to real numbers, billed. Both existing webhook
 *    tests passed BECAUSE of this — neither sent a signature.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveBuilderByPhoneNumberId,
  __resetPhoneResolveCache,
} from '../src/channel/phone-resolve.js';
import { handleWhatsAppWebhook } from '../src/webhook/whatsapp.js';
import type { Env } from '../src/env.js';

const PHONE_NUMBER_ID = '773311992244001';
const BUILDER = 'builder-late';

/** What GET /api/v1/builders currently answers. Cases mutate this mid-test. */
let listed: Array<{ builder_id: string; meta_phone_number_id: string }> = [];
let listCalls = 0;

function ctx(): ExecutionContext {
  return {
    waitUntil: () => {}, passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

describe('resolving a number that was connected a moment ago', () => {
  beforeEach(() => {
    __resetPhoneResolveCache();
    listed = [];
    listCalls = 0;
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/v1/builders')) {
        listCalls += 1;
        return new Response(JSON.stringify({ builders: listed }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('refetches on a miss instead of serving a stale map for the rest of the TTL', async () => {
    const crm = { listBuilders: () => fetch('https://desk.test/api/v1/builders').then((r) => r.json()) } as never;

    // The map is built before this tenant exists.
    expect(await resolveBuilderByPhoneNumberId(crm, PHONE_NUMBER_ID)).toBeNull();
    expect(listCalls).toBe(1);

    // They connect. The TTL has NOT expired — this is the whole failure.
    listed = [{ builder_id: BUILDER, meta_phone_number_id: PHONE_NUMBER_ID }];
    vi.advanceTimersByTime(6_000);

    expect(await resolveBuilderByPhoneNumberId(crm, PHONE_NUMBER_ID)).toBe(BUILDER);
    expect(listCalls).toBe(2);
  });

  it('does not refetch per message for a number that belongs to nobody', async () => {
    const crm = { listBuilders: () => fetch('https://desk.test/api/v1/builders').then((r) => r.json()) } as never;

    await resolveBuilderByPhoneNumberId(crm, 'pn-belongs-to-nobody');
    await resolveBuilderByPhoneNumberId(crm, 'pn-belongs-to-nobody');
    await resolveBuilderByPhoneNumberId(crm, 'pn-belongs-to-nobody');

    // One populate. A stray or probing number must not turn every inbound
    // message into a round trip to Desk.
    expect(listCalls).toBe(1);
  });

  it('serves a hit from cache without any refetch', async () => {
    listed = [{ builder_id: BUILDER, meta_phone_number_id: PHONE_NUMBER_ID }];
    const crm = { listBuilders: () => fetch('https://desk.test/api/v1/builders').then((r) => r.json()) } as never;

    expect(await resolveBuilderByPhoneNumberId(crm, PHONE_NUMBER_ID)).toBe(BUILDER);
    vi.advanceTimersByTime(30_000);
    expect(await resolveBuilderByPhoneNumberId(crm, PHONE_NUMBER_ID)).toBe(BUILDER);
    expect(listCalls).toBe(1);
  });
});

describe('a webhook payload nobody signed', () => {
  beforeEach(() => {
    __resetPhoneResolveCache();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/v1/builders')) {
        return new Response(JSON.stringify({
          builders: [{ builder_id: BUILDER, meta_phone_number_id: PHONE_NUMBER_ID }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
  });

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  function request(): Request {
    return new Request('https://spine.test/webhook/whatsapp', {
      method: 'POST',
      body: JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ field: 'messages', value: {
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          messages: [{ from: '919900000000', id: 'wamid.forged', type: 'text', text: { body: 'hello' } }],
        } }] }],
      }),
    });
  }

  it('is refused when no app secret is configured anywhere', async () => {
    // Exactly prod's shape today: no META_APP_SECRET, no per-builder override.
    const env = { NAYADESK_URL: 'https://desk.test', BOT_SHARED_SECRET: 'shh' } as unknown as Env;
    const res = await handleWhatsAppWebhook(request(), env, ctx());
    expect(res.status).toBe(403);
  });

  it('is refused when a secret exists and the signature is wrong', async () => {
    const env = {
      NAYADESK_URL: 'https://desk.test', BOT_SHARED_SECRET: 'shh',
      META_APP_SECRET: 'test-app-secret',
    } as unknown as Env;
    const req = new Request(request(), { headers: { 'x-hub-signature-256': 'sha256=deadbeef' } });
    const res = await handleWhatsAppWebhook(req, env, ctx());
    expect(res.status).toBe(403);
  });
});
