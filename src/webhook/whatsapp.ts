import type { Env } from '../env.js';
import { resolveBuilderByPhoneNumberId } from '../channel/phone-resolve.js';
import { getMetaAppSecret, verifyMetaWebhookSignature } from '../channel/meta-secrets.js';
import { deliverWhatsAppTurn } from '../channel/wa-deliver.js';
import { fileStatusReceipts, fileTurnReceipts, type MetaStatus } from '../channel/delivery-receipt.js';
import { sendTyping } from '../channel/whatsapp-client.js';
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
          /** A quick-reply tap on a TEMPLATE message — not `interactive`. */
          button?: { text?: string; payload?: string };
        }>;
        /**
         * Meta's verdict on messages WE sent — `sent`, `delivered`, `read`, or
         * `failed` with a reason. It rides the same `messages` field as inbound
         * traffic and has been arriving on every bot send since this webhook
         * existed. This interface not declaring it is the whole reason a
         * message Graph accepted and then refused to deliver left no trace.
         */
        statuses?: MetaStatus[];
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

  // Fail CLOSED when no secret resolves.
  //
  // `if (secret && ...)` skipped verification entirely whenever the lookup
  // came back empty, which is not a rare state: prod has no META_APP_SECRET
  // set at all, and no builder anywhere has a per-tenant one, so the fallback
  // was carrying every environment and on prod it resolved to undefined. An
  // unverified payload here is not inert — it is written to the CRM and it
  // makes the bot send real WhatsApp messages to real phone numbers, billed.
  // So anyone who knew this URL could put words in a tenant's mouth.
  //
  // It also compounds with the resolver above: a tenant we cannot resolve
  // contributes no secret, so the window where a tenant is invisible used to
  // be the same window where nothing was authenticated.
  const secret = builderIds.map((b) => getMetaAppSecret(env, b)).find(Boolean) ?? env.META_APP_SECRET;
  if (!secret) {
    console.error('[wa-webhook] refused: no META_APP_SECRET for', builderIds.join(',') || '(unresolved)');
    return new Response('Forbidden', { status: 403 });
  }
  if (!(await verifyMetaWebhookSignature(rawBody, sig, secret))) {
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
      if (!phoneNumberId) continue;

      const builderId = await resolveBuilderByPhoneNumberId(rt.crm, phoneNumberId);
      if (!builderId) continue;

      // A status-only change carries no `messages` at all, which is how the
      // old guard on this line discarded every one of them.
      if (value.statuses?.length) {
        ctx.waitUntil(fileStatusReceipts(rt.crm, builderId, value.statuses));
      }
      if (!value.messages?.length) continue;

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
        } else if (msg.type === 'button' && msg.button?.text) {
          // A tap on a TEMPLATE quick-reply (the opening message's buttons).
          // Meta sends these as `type:"button"` with the label in `button.text`
          // — a different shape from the interactive `button_reply` above, and
          // until this branch existed every such tap fell through the
          // `!buyerText` guard below and vanished: the buyer tapped
          // "Book a site visit" and nothing happened.
          //
          // The label is deliberately the ONLY thing read. `button.payload`
          // defaults to the label when the send named none (ours never do),
          // and it is not an id from our interactive vocabulary — so the tap
          // becomes the buyer's words, routed by the intent lane exactly as if
          // they had typed them.
          buyerText = msg.button.text;
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
            const report = await deliverWhatsAppTurn(phoneNumberId, buyerPhone, result, creds.access_token);
            await fileTurnReceipts(rt.crm, builderId, result.nd_thread_id, report);
          }
        };

        ctx.waitUntil(job());
      }
    }
  }

  return new Response('ok', { status: 200 });
}
