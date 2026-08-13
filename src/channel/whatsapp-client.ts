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
  const wamid = await sendTextWithWamid(phoneNumberId, to, text, token);
  return !!wamid;
}

/** Like sendText but returns Graph wamid (for agent-send / delivery receipts). */
export async function sendTextWithWamid(
  phoneNumberId: string,
  to: string,
  text: string,
  token: string,
): Promise<string | null> {
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
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      messages?: Array<{ id?: string }>;
    } | null;
    return body?.messages?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

export type MediaKind = 'image' | 'document' | 'video';

/** Human agent-send media (brochure / floor plan) by public link. */
export async function sendMedia(
  phoneNumberId: string,
  to: string,
  kind: MediaKind,
  link: string,
  opts: { caption?: string; filename?: string } = {},
  token: string,
): Promise<string | null> {
  const payload: Record<string, unknown> = { link };
  if (opts.caption) payload.caption = opts.caption;
  if (kind === 'document' && opts.filename) payload.filename = opts.filename;
  try {
    const res = await fetch(url(phoneNumberId), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace(/\D/g, ''),
        type: kind,
        [kind]: payload,
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      messages?: Array<{ id?: string }>;
    } | null;
    return body?.messages?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

export interface WhatsAppReplyButton {
  id: string;
  title: string;
}

/**
 * Meta rejects an interactive message whose ids collide or whose titles are
 * blank — and the rejection is silent from the buyer's side: no chrome, and no
 * answer either. Chrome is the garnish; it must never take the reply with it.
 * So we de-collide before sending, and if Meta still refuses, the text goes out
 * on its own rather than the turn vanishing.
 */
function uniqueById<T extends { id: string; title: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (!it.title.trim()) continue;
    let id = it.id;
    for (let i = 2; seen.has(id); i += 1) id = `${it.id}.${i}`;
    seen.add(id);
    out.push(id === it.id ? it : { ...it, id });
  }
  return out;
}

async function refusal(res: Response): Promise<string> {
  return (await res.text().catch(() => '')).slice(0, 400);
}

/** An interactive body is capped at 1024; plain text gets 4096. */
const INTERACTIVE_BODY_MAX = 1024;
const CARRIER_PROMPT = 'What would you like next?';

/**
 * A long answer (a two-project comparison, a full cost sheet) does not fit an
 * interactive body. Slicing it to 1024 delivered the chrome and ate the end of
 * the answer mid-sentence. Send the answer whole as text, then let the chrome
 * ride on a short follow-up — two bubbles, nothing lost. Returns the body the
 * interactive should carry, or null if the long text itself failed to send.
 */
async function carrierBody(
  phoneNumberId: string,
  to: string,
  bodyText: string,
  token: string,
): Promise<string | null> {
  if (bodyText.length <= INTERACTIVE_BODY_MAX) return bodyText;
  return (await sendText(phoneNumberId, to, bodyText, token)) ? CARRIER_PROMPT : null;
}

/** WhatsApp allows max 3 reply buttons; titles max 20 chars. */
export async function sendInteractiveButtons(
  phoneNumberId: string,
  to: string,
  bodyText: string,
  rawButtons: readonly WhatsAppReplyButton[],
  token: string,
): Promise<boolean> {
  const buttons = uniqueById(rawButtons);
  if (buttons.length === 0) return sendText(phoneNumberId, to, bodyText, token);
  const body = await carrierBody(phoneNumberId, to, bodyText, token);
  if (body === null) return false;
  const answerSent = body !== bodyText;
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
          body: { text: body },
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
    if (res.ok) return true;
    console.error('[wa] interactive buttons refused, falling back to text:', await refusal(res));
    return answerSent || sendText(phoneNumberId, to, bodyText, token);
  } catch (err) {
    console.error('[wa] interactive buttons threw, falling back to text:', err);
    return answerSent || sendText(phoneNumberId, to, bodyText, token);
  }
}

export interface WhatsAppListRow {
  id: string;
  title: string;
  description?: string;
}

export interface WhatsAppListSection {
  title: string;
  rows: readonly WhatsAppListRow[];
}

/** WhatsApp list: ≤10 rows total, titles ≤24, descriptions ≤72. */
export async function sendInteractiveList(
  phoneNumberId: string,
  to: string,
  bodyText: string,
  button: string,
  rawSections: readonly WhatsAppListSection[],
  token: string,
): Promise<boolean> {
  // Ids must be unique across the WHOLE message, not within a section.
  const deduped = uniqueById(rawSections.flatMap((s) => s.rows.map((r) => ({ ...r, _s: s.title }))));
  const sections: WhatsAppListSection[] = rawSections
    .map((s) => ({ title: s.title, rows: deduped.filter((r) => r._s === s.title) }))
    .filter((s) => s.rows.length > 0);
  const rows = sections.flatMap((s) => s.rows);
  if (rows.length === 0) return sendText(phoneNumberId, to, bodyText, token);
  const body = await carrierBody(phoneNumberId, to, bodyText, token);
  if (body === null) return false;
  const answerSent = body !== bodyText;
  try {
    const res = await fetch(url(phoneNumberId), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace(/\D/g, ''),
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: body },
          action: {
            button: button.slice(0, 20),
            sections: sections.slice(0, 10).map((sec) => ({
              title: sec.title.slice(0, 24),
              rows: sec.rows.slice(0, 10).map((r) => ({
                id: r.id.slice(0, 200),
                title: r.title.slice(0, 24),
                ...(r.description ? { description: r.description.slice(0, 72) } : {}),
              })),
            })),
          },
        },
      }),
    });
    if (res.ok) return true;
    console.error('[wa] interactive list refused, falling back to text:', await refusal(res));
    return answerSent || sendText(phoneNumberId, to, bodyText, token);
  } catch (err) {
    console.error('[wa] interactive list threw, falling back to text:', err);
    return answerSent || sendText(phoneNumberId, to, bodyText, token);
  }
}

export function appendNumberedMenu(reply: string, labels: readonly string[]): string {
  if (!labels.length) return reply;
  const menu = labels.slice(0, 3).map((l, i) => `${i + 1}) ${l}`).join('\n');
  const combined = `${reply}\n\n${menu}`;
  return combined.slice(0, 4096);
}
