import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env.js';
import type { NayaDeskClient } from '../src/crm/nayadesk-client.js';
import {
  __resetPhoneResolveCache,
  resolveBuilderByPhoneNumberId,
  resolveLineByPhoneNumberId,
} from '../src/channel/phone-resolve.js';

/**
 * The line exists — slice 1 of the front desk / project lines split.
 *
 * A builder used to be one WhatsApp number. Spine resolved an inbound
 * `phone_number_id` to a builder and nothing else; the reply was sent with
 * the builder's one token; the pursuit was born on whatever project the
 * ladder guessed. A second number, scoped to one project, had nowhere to
 * land.
 *
 * Desk now lists project lines beside builders (`GET /api/v1/builders` →
 * `lines`) and answers `GET /whatsapp/:b/creds?phone_number_id=` with the
 * line's own token. This file holds Spine's half:
 *
 *   1. the resolver answers builder AND project for a line, project null
 *      for the front desk, and still works on a Desk that sends no `lines`
 *   2. the webhook hands the debouncer the line's project
 *   3. the debouncer asks Desk for the LINE's credentials and hands the
 *      engine the line's project
 *   4. handleChat opens the pursuit on that project
 *
 * Differential: on main, 1 has no `resolveLineByPhoneNumberId`, 2 sends no
 * `line_project_id`, 3 calls `getWhatsAppCreds(builder_id)` with one
 * argument, and 4 upserts with no `project_id`.
 */

// handleChat runs the whole engine after the upsert; this file is about the
// upsert. Hoisted, so the webhook's import of routes.js sees the same stub.
vi.mock('../src/turn/run-turn.js', () => ({
  runTurn: async () => ({ reply_text: 'ok', composer: 'test', turn_index: 0, nd_thread_id: 't1' }),
}));

const DESK = 'pn-desk-brigade';
const LINE = 'pn-line-meadows';
const B = 'brigade-group';
const PROJECT = 'proj-meadows';

function fakeCrm(lines?: unknown): NayaDeskClient {
  return {
    listBuilders: async () => ({
      builders: [{ builder_id: B, meta_phone_number_id: DESK, name: 'Brigade' }],
      ...(lines === undefined ? {} : { lines }),
    }),
  } as unknown as NayaDeskClient;
}

describe('the resolver names the line', () => {
  beforeEach(() => __resetPhoneResolveCache());

  it('a project line resolves to its builder AND its project; the front desk to the builder alone', async () => {
    const crm = fakeCrm([
      { phone_number_id: LINE, builder_id: B, project_id: PROJECT, display_name: 'Meadows', status: 'connected' },
    ]);
    expect(await resolveLineByPhoneNumberId(crm, LINE)).toEqual({ builder_id: B, project_id: PROJECT });
    expect(await resolveLineByPhoneNumberId(crm, DESK)).toEqual({ builder_id: B, project_id: null });
    expect(await resolveLineByPhoneNumberId(crm, 'pn-nobody')).toBeNull();
    // The builder-only wrapper every older caller still uses.
    expect(await resolveBuilderByPhoneNumberId(crm, LINE)).toBe(B);
    expect(await resolveBuilderByPhoneNumberId(crm, DESK)).toBe(B);
  });

  it('a Desk that predates lines still resolves the front desk', async () => {
    const crm = fakeCrm(undefined);
    expect(await resolveLineByPhoneNumberId(crm, DESK)).toEqual({ builder_id: B, project_id: null });
    expect(await resolveBuilderByPhoneNumberId(crm, DESK)).toBe(B);
  });
});

/* ---------------------------------------------------------------------- */

const APP_SECRET = 'test-meta-app-secret';

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return 'sha256=' + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function metaMessage(phoneNumberId: string, wamid: string): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: phoneNumberId },
          messages: [{ from: '919900000001', id: wamid, type: 'text', text: { body: '2 BHK?' } }],
        },
      }],
    }],
  });
}

describe('the webhook hands the debouncer the line', () => {
  const enqueued: Array<Record<string, unknown>> = [];
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    __resetPhoneResolveCache();
    enqueued.length = 0;
    // Desk, as the webhook sees it: one builder, one project line.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/api/v1/builders')) {
        return Response.json({
          builders: [{ builder_id: B, meta_phone_number_id: DESK, name: 'Brigade' }],
          lines: [{ phone_number_id: LINE, builder_id: B, project_id: PROJECT, display_name: 'Meadows', status: 'connected' }],
        });
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    }) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  async function deliver(phoneNumberId: string, wamid: string): Promise<Response> {
    const { handleWhatsAppWebhook } = await import('../src/webhook/whatsapp.js');
    const body = metaMessage(phoneNumberId, wamid);
    const pending: Promise<unknown>[] = [];
    const env = {
      META_APP_SECRET: APP_SECRET,
      NAYADESK_URL: 'https://desk.test.invalid',
      BOT_SHARED_SECRET: 'bot-secret',
      TURN_DEBOUNCER: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: async (_url: string, init: { body: string }) => {
            enqueued.push(JSON.parse(init.body) as Record<string, unknown>);
            return Response.json({ queued: true });
          },
        }),
      },
    } as unknown as Env;
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException: () => {} } as ExecutionContext;
    const res = await handleWhatsAppWebhook(
      new Request('https://spine.test/webhook/whatsapp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Hub-Signature-256': await sign(body) },
        body,
      }),
      env,
      ctx,
    );
    await Promise.all(pending);
    return res;
  }

  it('a message on a project line carries line_project_id; one on the front desk carries none', async () => {
    expect((await deliver(LINE, 'wamid.line.1')).status).toBe(200);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      builder_id: B, phone_number_id: LINE, line_project_id: PROJECT, buyer_phone: '+919900000001',
    });

    expect((await deliver(DESK, 'wamid.desk.1')).status).toBe(200);
    expect(enqueued).toHaveLength(2);
    expect(enqueued[1]).toMatchObject({ builder_id: B, phone_number_id: DESK });
    expect(enqueued[1]).not.toHaveProperty('line_project_id');
  });
});

/* ---------------------------------------------------------------------- */

describe('handleChat opens the pursuit on the line\'s project', () => {
  it('passes line_project_id to the upsert as project_id, and nothing when the front desk sent it', async () => {
    const { handleChat } = await import('../src/worker/routes.js');
    const upserts: Array<Record<string, unknown>> = [];
    const rt = {
      crm: {
        upsertLead: async (req: Record<string, unknown>) => { upserts.push(req); return { thread_id: 't1' }; },
      },
    } as unknown as Parameters<typeof handleChat>[0];

    await handleChat(rt, { builder_id: B, buyer_phone: '+919900000001', text: 'hi', channel: 'whatsapp', line_project_id: PROJECT });
    expect(upserts[0]).toMatchObject({ builder_id: B, project_id: PROJECT, channel: 'whatsapp' });

    await handleChat(rt, { builder_id: B, buyer_phone: '+919900000001', text: 'hi', channel: 'whatsapp' });
    expect(upserts[1]).not.toHaveProperty('project_id');
  });
});
