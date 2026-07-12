import type { Env } from '../env.js';
import { sendText, sendTyping, sendInteractiveButtons, appendNumberedMenu } from '../channel/whatsapp-client.js';
import { createWorkerRuntime } from '../runtime/deps.js';
import { handleChat } from '../worker/routes.js';

interface InboxEntry {
  text: string;
  meta_message_id: string;
  received_at: number;
}

const DEBOUNCE_MS = 2000;

export class TurnDebouncer implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/enqueue')) {
      return this.enqueue(request);
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  private async enqueue(request: Request): Promise<Response> {
    const body = await request.json() as {
      builder_id: string;
      buyer_phone: string;
      phone_number_id: string;
      text: string;
      meta_message_id: string;
    };

    await this.state.storage.put('builder_id', body.builder_id);
    await this.state.storage.put('buyer_phone', body.buyer_phone);
    await this.state.storage.put('phone_number_id', body.phone_number_id);

    const inbox = (await this.state.storage.get<InboxEntry[]>('inbox')) ?? [];
    inbox.push({ text: body.text, meta_message_id: body.meta_message_id, received_at: Date.now() });
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

    const text = inbox.map((e) => e.text).join(' ');
    const lastWamid = inbox[inbox.length - 1]?.meta_message_id;

    const rt = createWorkerRuntime(this.env);
    const creds = await rt.crm.getWhatsAppCreds(builder_id);
    const token = creds.access_token;
    if (lastWamid && token) await sendTyping(phone_number_id, lastWamid, token);

    // W6 — the debouncer is only ever fed by the WhatsApp webhook.
    const result = await handleChat(rt, { builder_id, buyer_phone, text, channel: 'whatsapp' });

    if (token) {
      const labels = result.whatsapp_actions?.map((a) => a.label) ?? [];
      const body = labels.length ? appendNumberedMenu(result.reply_text, labels) : result.reply_text;
      if (result.whatsapp_actions?.length) {
        await sendInteractiveButtons(
          phone_number_id,
          buyer_phone,
          body,
          result.whatsapp_actions.map((a) => ({ id: a.id, title: a.label })),
          token,
        );
      } else {
        await sendText(phone_number_id, buyer_phone, body, token);
      }
    }
  }
}
