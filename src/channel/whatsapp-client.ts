const GRAPH = 'https://graph.facebook.com';
const VERSION = 'v22.0';

function url(phoneNumberId: string): string {
  return `${GRAPH}/${VERSION}/${phoneNumberId}/messages`;
}

export async function sendTyping(phoneNumberId: string, wamid: string, token: string): Promise<void> {
  try {
    await fetch(url(phoneNumberId), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: wamid }),
    });
  } catch {
    /* best-effort */
  }
}

export async function sendText(phoneNumberId: string, to: string, text: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(url(phoneNumberId), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace(/\D/g, ''),
        type: 'text',
        text: { body: text.slice(0, 4096) },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface WhatsAppReplyButton {
  id: string;
  title: string;
}

/** WhatsApp allows max 3 reply buttons; titles max 20 chars. */
export async function sendInteractiveButtons(
  phoneNumberId: string,
  to: string,
  bodyText: string,
  buttons: readonly WhatsAppReplyButton[],
  token: string,
): Promise<boolean> {
  if (buttons.length === 0) return sendText(phoneNumberId, to, bodyText, token);
  try {
    const res = await fetch(url(phoneNumberId), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace(/\D/g, ''),
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText.slice(0, 1024) },
          action: {
            buttons: buttons.slice(0, 3).map((b) => ({
              type: 'reply',
              reply: {
                id: b.id.slice(0, 256),
                title: b.title.slice(0, 20),
              },
            })),
          },
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function appendNumberedMenu(reply: string, labels: readonly string[]): string {
  if (!labels.length) return reply;
  const menu = labels.slice(0, 3).map((l, i) => `${i + 1}) ${l}`).join('\n');
  const combined = `${reply}\n\n${menu}`;
  return combined.slice(0, 4096);
}
