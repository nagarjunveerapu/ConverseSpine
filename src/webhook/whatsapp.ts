import type { Env } from '../env.js';
import { resolveBuilderByPhoneNumberId } from '../channel/phone-resolve.js';
import { getMetaAppSecret, verifyMetaWebhookSignature } from '../channel/meta-secrets.js';
import { sendText, sendTyping, sendInteractiveButtons, appendNumberedMenu } from '../channel/whatsapp-client.js';
import { seenWebhookMessage, overRateLimit } from '../channel/ingress-guard.js';
import { createWorkerRuntime } from '../runtime/deps.js';
import { handleChat } from '../worker/routes.js';

interface MetaPayload {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: Array<{
          from: string;
          id: string;
          type: string;
          text?: { body: string };
          interactive?: {
            type?: string;
            button_reply?: { id: string; title: string };
            list_reply?: { id: string; title: string };
          };
        }>;
      };
    }>;
  }>;
}

export async function handleWhatsAppWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const rawBody = await request.text();
  const sig = request.headers.get('X-Hub-Signature-256') ?? '';

  let payload: MetaPayload;
  try {
    payload = JSON.parse(rawBody) as MetaPayload;
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const rt = createWorkerRuntime(env);
  const builderIds: string[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const pid = change.value?.metadata?.phone_number_id;
      if (!pid) continue;
      const bid = await resolveBuilderByPhoneNumberId(rt.crm, pid);
      if (bid) builderIds.push(bid);
    }
  }

  const secret = builderIds.map((b) => getMetaAppSecret(env, b)).find(Boolean) ?? env.META_APP_SECRET;
  if (secret && !(await verifyMetaWebhookSignature(rawBody, sig, secret))) {
    return new Response('Forbidden', { status: 403 });
  }

  if (payload.object !== 'whatsapp_business_account') {
    return new Response('ok', { status: 200 });
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId || !value?.messages?.length) continue;

      const builderId = await resolveBuilderByPhoneNumberId(rt.crm, phoneNumberId);
      if (!builderId) continue;

      for (const msg of value.messages) {
        let buyerText = '';
        let actionId: string | undefined;

        if (msg.type === 'text' && msg.text?.body) {
          buyerText = msg.text.body;
        } else if (msg.type === 'interactive' && msg.interactive) {
          const reply = msg.interactive.button_reply ?? msg.interactive.list_reply;
          if (reply) {
            buyerText = reply.title;
            actionId = reply.id;
          }
        }
        if (!buyerText) continue;

        // W6 — Meta delivers at-least-once: drop retries of an already-seen
        // message id, and stop spending LLM turns on a flooding number. Both
        // ack 200 (a retry storm must not be encouraged by non-200s).
        if (await seenWebhookMessage(env.TURN_CACHE, msg.id)) continue;
        if (await overRateLimit(env.TURN_CACHE, `${builderId}:${msg.from}`, Date.now())) continue;

        const job = async () => {
          if (env.TURN_DEBOUNCER) {
            const id = env.TURN_DEBOUNCER.idFromName(`${builderId}:${msg.from}`);
            await env.TURN_DEBOUNCER.get(id).fetch('https://debouncer/enqueue', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                builder_id: builderId,
                buyer_phone: `+${msg.from.replace(/\D/g, '')}`,
                phone_number_id: phoneNumberId,
                text: buyerText,
                action_id: actionId,
                meta_message_id: msg.id,
              }),
            });
            return;
          }

          const buyerPhone = `+${msg.from.replace(/\D/g, '')}`;
          const creds = await rt.crm.getWhatsAppCreds(builderId);
          if (creds.access_token) await sendTyping(phoneNumberId, msg.id, creds.access_token);

          const result = await handleChat(rt, {
            builder_id: builderId,
            buyer_phone: buyerPhone,
            text: buyerText,
            action_id: actionId,
            channel: 'whatsapp',
          });

          if (creds.access_token) {
            const labels = result.whatsapp_actions?.map((a) => a.label) ?? [];
            const body = labels.length ? appendNumberedMenu(result.reply_text, labels) : result.reply_text;
            if (result.whatsapp_actions?.length) {
              await sendInteractiveButtons(
                phoneNumberId,
                buyerPhone,
                body,
                result.whatsapp_actions.map((a) => ({ id: a.id, title: a.label })),
                creds.access_token,
              );
            } else {
              await sendText(phoneNumberId, buyerPhone, body, creds.access_token);
            }
          }
        };

        ctx.waitUntil(job());
      }
    }
  }

  return new Response('ok', { status: 200 });
}
