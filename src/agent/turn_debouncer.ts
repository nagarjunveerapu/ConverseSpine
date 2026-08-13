import type { Env } from '../env.js';
import type { ConversationState } from '../engine/types.js';
import { sendTyping } from '../channel/whatsapp-client.js';
import { deliverWhatsAppTurn } from '../channel/wa-deliver.js';
import { createWorkerRuntime } from '../runtime/deps.js';
import { handleChat } from '../worker/routes.js';

interface InboxEntry {
  text: string;
  action_id?: string;
  meta_message_id: string;
  received_at: number;
}

const DEBOUNCE_MS = 2000;
const L0_STATE_KEY = 'l0_state';
/** Meta message ids already accepted for this buyer — the retry guard. */
const SEEN_KEY = 'seen_wamids';
const SEEN_MAX = 50;

/**
 * Conversation DO — WhatsApp debounce + L0 hot conversation state.
 * State routes use DO name `state:{convId}` from store-kv; enqueue uses
 * `builderId:phone` from the WhatsApp webhook.
 */
export class TurnDebouncer implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === 'POST' && path.endsWith('/enqueue')) {
      return this.enqueue(request);
    }
    if (path.endsWith('/state') || path.endsWith('/state/')) {
      if (request.method === 'GET') {
        const state = (await this.state.storage.get<ConversationState>(L0_STATE_KEY)) ?? null;
        return Response.json({ state });
      }
      if (request.method === 'PUT') {
        let body: { state?: ConversationState };
        try {
          body = (await request.json()) as { state?: ConversationState };
        } catch {
          return Response.json({ error: 'invalid_json' }, { status: 400 });
        }
        if (!body.state?.convId) {
          return Response.json({ error: 'state_required' }, { status: 400 });
        }
        await this.state.storage.put(L0_STATE_KEY, body.state);
        return Response.json({ ok: true });
      }
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  private async enqueue(request: Request): Promise<Response> {
    const body = await request.json() as {
      builder_id: string;
      buyer_phone: string;
      phone_number_id: string;
      text: string;
      action_id?: string;
      meta_message_id: string;
    };

    // Meta delivers at-least-once. The webhook's KV guard is a cache — a retry
    // that lands on another colo reads the id as unseen and the buyer gets the
    // same answer twice. Every message for this buyer routes through this one
    // DO, whose storage is strongly consistent, so the guard belongs here.
    if (body.meta_message_id) {
      const seen = (await this.state.storage.get<string[]>(SEEN_KEY)) ?? [];
      if (seen.includes(body.meta_message_id)) {
        return Response.json({ deduped: true });
      }
      await this.state.storage.put(SEEN_KEY, [...seen, body.meta_message_id].slice(-SEEN_MAX));
    }

    await this.state.storage.put('builder_id', body.builder_id);
    await this.state.storage.put('buyer_phone', body.buyer_phone);
    await this.state.storage.put('phone_number_id', body.phone_number_id);

    const inbox = (await this.state.storage.get<InboxEntry[]>('inbox')) ?? [];
    inbox.push({
      text: body.text,
      ...(body.action_id ? { action_id: body.action_id } : {}),
      meta_message_id: body.meta_message_id,
      received_at: Date.now(),
    });
    await this.state.storage.put('inbox', inbox);

    const existing = await this.state.storage.getAlarm();
    if (!existing) await this.state.storage.setAlarm(Date.now() + DEBOUNCE_MS);

    return Response.json({ queued: true, inbox_size: inbox.length });
  }

  async alarm(): Promise<void> {
    const inbox = (await this.state.storage.get<InboxEntry[]>('inbox')) ?? [];
    if (inbox.length === 0) return;

    const builder_id = (await this.state.storage.get<string>('builder_id'))!;
    const buyer_phone = (await this.state.storage.get<string>('buyer_phone'))!;
    const phone_number_id = (await this.state.storage.get<string>('phone_number_id'))!;

    await this.state.storage.put('inbox', []);

    const last = inbox[inbox.length - 1];
    const action_id = [...inbox].reverse().find((e) => e.action_id)?.action_id;
    const text =
      last?.action_id
        ? last.text
        : inbox.map((e) => e.text).join(' ');
    const lastWamid = last?.meta_message_id;

    const rt = createWorkerRuntime(this.env);
    const creds = await rt.crm.getWhatsAppCreds(builder_id);
    const token = creds.access_token;
    if (lastWamid && token) await sendTyping(phone_number_id, lastWamid, token);

    // W6 — the debouncer is only ever fed by the WhatsApp webhook.
    const result = await handleChat(rt, {
      builder_id,
      buyer_phone,
      text,
      ...(action_id ? { action_id } : {}),
      channel: 'whatsapp',
    });

    if (token) {
      await deliverWhatsAppTurn(phone_number_id, buyer_phone, result, token);
    }
  }
}
