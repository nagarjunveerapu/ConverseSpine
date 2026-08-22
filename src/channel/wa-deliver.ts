import type { TurnResult } from '../types.js';
import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendTextOutcome,
  type SendOutcome,
} from './whatsapp-client.js';

/**
 * One bubble the buyer was supposed to receive, and what Graph said about it.
 *
 * `content` is the join key, not decoration. The engine writes every line it
 * COMPOSES to Desk (`crm.appendMessage`) before delivery is attempted, so the
 * row exists by the time we get here and holds this exact string — which is
 * how a receipt finds its row without threading a message id back through
 * forty return sites. Media attachments are absent on purpose: they have no
 * Desk row to file a receipt against.
 */
export interface DeliveredPart {
  content: string;
  status: 'sent' | 'failed';
  /** Graph's id, when it gave one. The key Meta's own status webhook uses. */
  wamid?: string;
  /** Why it did not go, in Graph's words. Only ever set alongside 'failed'. */
  detail?: string;
}

export interface WhatsAppDeliveryReport {
  parts: DeliveredPart[];
}

/**
 * An interactive body caps at 1024. A welcome that pushes the answer past that
 * would be handed to `carrierBody`, which sends the long text as its own
 * message — the very bubble that was just refused. So the fold happens only
 * when it changes nothing about how the answer travels.
 */
const FOLD_MAX = 1024;

function part(content: string, out: SendOutcome): DeliveredPart {
  if (!out.ok) {
    return { content, status: 'failed', detail: out.error ?? 'WhatsApp refused it.' };
  }
  return { content, status: 'sent', ...(out.wamid ? { wamid: out.wamid } : {}) };
}

/**
 * Send one Spine turn over Cloud API. Packed list XOR buttons; never both.
 * Numbered-menu fallback is only for recovery buttons (no native list).
 *
 * Returns what actually happened, per bubble. It used to return void, and that
 * was the whole defect: `engine/turn.ts` had already told Desk the message was
 * sent, this function found out whether that was true, and then threw the
 * answer away. A buyer who received nothing and an agent reading a clean
 * transcript were both looking at the same conversation.
 */
export async function deliverWhatsAppTurn(
  phoneNumberId: string,
  to: string,
  result: Pick<TurnResult, 'reply_text' | 'whatsapp_actions' | 'whatsapp_interactive' | 'media_attachments' | 'consent_notice' | 'welcome_message'>,
  token: string,
): Promise<WhatsAppDeliveryReport> {
  const parts: DeliveredPart[] = [];

  // The self-registration hello, ahead of everything. A buyer who filled a
  // form at a gate and tapped a wa.me link has no way of knowing whose number
  // they just opened; the answer to their message makes sense only after they
  // know they reached the right builder. Its own message, because the body
  // below caps at 1024 characters whenever the turn carries a list.
  //
  // And if that own message is refused, it rides the answer instead. This is
  // the one line whose absence leaves the buyer staring at an unexplained
  // number — on 22 Aug 2026 it was refused, silently, and what the buyer had
  // instead was Meta's `hello_world` sample text and then a project card from
  // nobody. Losing the greeting to its own bubble is not a trade worth making
  // when the words fit in the bubble that follows.
  let lead = '';
  if (result.welcome_message) {
    const out = await sendTextOutcome(phoneNumberId, to, result.welcome_message, token);
    const fits = result.welcome_message.length + result.reply_text.length + 2 <= FOLD_MAX;
    if (!out.ok && fits) {
      lead = `${result.welcome_message}\n\n`;
      console.error('[wa] welcome folded into the reply after refusal:', out.error);
      parts.push({ content: result.welcome_message, status: 'sent' });
    } else {
      parts.push(part(result.welcome_message, out));
    }
  }

  const body = `${lead}${result.reply_text}`;
  const packed = result.whatsapp_interactive;
  let replyOut: SendOutcome;
  if (packed?.type === 'list') {
    replyOut = await sendInteractiveList(phoneNumberId, to, body, packed.button, packed.sections, token);
  } else if (packed?.type === 'button') {
    replyOut = await sendInteractiveButtons(phoneNumberId, to, body, packed.buttons, token);
  } else if (result.whatsapp_actions?.length) {
    const { appendNumberedMenu } = await import('./whatsapp-client.js');
    const labels = result.whatsapp_actions.map((a) => a.label);
    replyOut = await sendInteractiveButtons(
      phoneNumberId,
      to,
      appendNumberedMenu(body, labels),
      result.whatsapp_actions.map((a) => ({ id: a.id, title: a.label })),
      token,
    );
  } else {
    replyOut = await sendTextOutcome(phoneNumberId, to, body, token);
  }
  // Filed under `reply_text`, never under `body` — the fold is a delivery
  // detail, and Desk's row holds the reply the engine composed.
  parts.push(part(result.reply_text, replyOut));

  // The one-time "STOP / DELETE" line, as its own message. Not folded into the
  // body above: that body is capped at 1024 characters when it is a list or a
  // button set, and a notice about a legal right is the wrong thing to lose to
  // a slice. Sent after the answer, so the buyer's actual question is what
  // they read first.
  if (result.consent_notice) {
    parts.push(part(result.consent_notice, await sendTextOutcome(phoneNumberId, to, result.consent_notice, token)));
  }
  const { deliverWhatsAppMediaAttachments } = await import('./deliver-media.js');
  await deliverWhatsAppMediaAttachments(phoneNumberId, to, result.media_attachments, token);
  return { parts };
}
