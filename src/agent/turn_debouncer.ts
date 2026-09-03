import type { Env } from '../env.js';
import type { ThreadState } from '../engine/types.js';
import { sendTyping } from '../channel/whatsapp-client.js';
import { deliverWhatsAppTurn } from '../channel/wa-deliver.js';
import { fileTurnReceipts } from '../channel/delivery-receipt.js';
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
 * Thread DO — WhatsApp debounce + L0 hot chat state.
 * State routes use DO name `state:{threadId}` from store-kv; enqueue uses
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
        const state = (await this.state.storage.get<ThreadState>(L0_STATE_KEY)) ?? null;
        return Response.json({ state });
      }
      if (request.method === 'PUT') {
        let body: { state?: ThreadState };
        try {
          body = (await request.json()) as { state?: ThreadState };
        } catch {
          return Response.json({ error: 'invalid_json' }, { status: 400 });
        }
        if (!body.state?.threadId) {
          return Response.json({ error: 'state_required' }, { status: 400 });
        }
        await this.state.storage.put(L0_STATE_KEY, body.state);
        return Response.json({ ok: true });
      }
      // DPDP erasure. There was no way to delete this before — the DO had GET
      // and PUT and nothing else, so a buyer who asked to be forgotten kept
      // their whole conversation state in durable storage indefinitely, and
      // the next turn read it back as if nothing had happened.
      //
      // deleteAll, not just the state key: this class is addressed two ways
      // and each address holds something of the buyer's. `state:{threadId}`
      // holds l0_state; `builderId:phone` holds their phone number, the
      // WhatsApp phone_number_id, and `inbox` — their raw message text,
      // sitting unprocessed. Erasing one and leaving the other would be the
      // same half-job this whole change exists to end.
      //
      // It also drops the wamid dedupe list, so a Meta retry of the erase
      // message replays. That is safe and deliberate: erasure is idempotent
      // (the tombstone upserts) and a duplicated erase is the harmless
      // direction to fail in.
      if (request.method === 'DELETE') {
        await this.state.storage.deleteAll();
        return Response.json({ ok: true, purged: true });
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
    // How many entries this alarm is answering, read before the first await.
    // The drain at the bottom needs the count as it was when we took the batch,
    // and `inbox.length` is not that number by the time we get there: enqueue
    // can run between any two awaits below and appends to the same key.
    const handled = inbox.length;

    const builder_id = (await this.state.storage.get<string>('builder_id'))!;
    const buyer_phone = (await this.state.storage.get<string>('buyer_phone'))!;
    const phone_number_id = (await this.state.storage.get<string>('phone_number_id'))!;

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
      const report = await deliverWhatsAppTurn(phone_number_id, buyer_phone, result, token);
      // Before the drain below, deliberately. A receipt is part of answering
      // the buyer, not bookkeeping done afterwards — and if the alarm retries,
      // it re-files the same rows rather than losing them.
      await fileTurnReceipts(rt.crm, builder_id, result.nd_thread_id, report);
    }

    // The drain happens HERE, after the reply is out — and it removes exactly
    // the batch this alarm handled rather than blanking the inbox.
    //
    // It used to be the first thing the alarm did, above. That destroyed the
    // buyer's message before anything had been done with it: getWhatsAppCreds
    // is a fetch to Desk, handleChat is the whole engine, deliverWhatsAppTurn
    // is the Meta Graph API, and any of the three can throw. When one did, the
    // runtime's alarm retries all re-entered at `if (inbox.length === 0)
    // return` and did nothing — six no-ops. The buyer sent a message and got
    // permanent silence, with no error anywhere that named them.
    //
    // `.slice(handled)`, not `[]`, because enqueue only ever appends. The first
    // `handled` entries are the batch we just answered; anything past them
    // arrived WHILE we were answering. Blanking would eat those, and that is
    // the commoner loss — a buyer typing "2bhk" and then "in whitefield"
    // produces it every time. The stragglers already have an alarm: enqueue
    // sees getAlarm() as null while this handler runs and sets a fresh one.
    //
    // The trade this accepts: if delivery throws after handleChat succeeded,
    // the retry runs handleChat again, so that turn's Desk appends can double
    // and the second reply is composed from state that already moved. Worse
    // than clean, better than silence. Duplicate *enqueues* are separately
    // guarded — SEEN_KEY holds the last 50 meta_message_ids in strongly
    // consistent storage, checked before anything is appended.
    const queued = (await this.state.storage.get<InboxEntry[]>('inbox')) ?? [];
    await this.state.storage.put('inbox', queued.slice(handled));
  }
}
