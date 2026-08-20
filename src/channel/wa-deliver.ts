import type { TurnResult } from '../types.js';
import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendText,
} from './whatsapp-client.js';

/**
 * Send one Spine turn over Cloud API. Packed list XOR buttons; never both.
 * Numbered-menu fallback is only for recovery buttons (no native list).
 */
export async function deliverWhatsAppTurn(
  phoneNumberId: string,
  to: string,
  result: Pick<TurnResult, 'reply_text' | 'whatsapp_actions' | 'whatsapp_interactive' | 'media_attachments' | 'consent_notice'>,
  token: string,
): Promise<void> {
  const packed = result.whatsapp_interactive;
  if (packed?.type === 'list') {
    await sendInteractiveList(phoneNumberId, to, result.reply_text, packed.button, packed.sections, token);
  } else if (packed?.type === 'button') {
    await sendInteractiveButtons(phoneNumberId, to, result.reply_text, packed.buttons, token);
  } else if (result.whatsapp_actions?.length) {
    const { appendNumberedMenu } = await import('./whatsapp-client.js');
    const labels = result.whatsapp_actions.map((a) => a.label);
    await sendInteractiveButtons(
      phoneNumberId,
      to,
      appendNumberedMenu(result.reply_text, labels),
      result.whatsapp_actions.map((a) => ({ id: a.id, title: a.label })),
      token,
    );
  } else {
    await sendText(phoneNumberId, to, result.reply_text, token);
  }
  // The one-time "STOP / DELETE" line, as its own message. Not folded into the
  // body above: that body is capped at 1024 characters when it is a list or a
  // button set, and a notice about a legal right is the wrong thing to lose to
  // a slice. Sent after the answer, so the buyer's actual question is what
  // they read first.
  if (result.consent_notice) {
    await sendText(phoneNumberId, to, result.consent_notice, token);
  }
  const { deliverWhatsAppMediaAttachments } = await import('./deliver-media.js');
  await deliverWhatsAppMediaAttachments(phoneNumberId, to, result.media_attachments, token);
}
