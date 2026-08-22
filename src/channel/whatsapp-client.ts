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

/**
 * What Graph actually said.
 *
 * The text and media senders used to answer `null` for every unhappy path —
 * a 400 from Meta, a thrown fetch, and an accepted message that came back
 * without an id were all one value, and none of them logged. Two messages
 * that Meta refused on 22 Aug 2026 (a self-registration welcome and the
 * STOP/DELETE consent line) therefore left no trace anywhere: the compose
 * row in Desk said they were sent, WhatsApp did not have them, and the
 * reason had already been discarded inside this file. The interactive
 * senders twenty lines below had logged their refusals since the day they
 * shipped; the text sender never did.
 *
 * `ok` is Meta's own verdict, not "did we get an id". A message Graph
 * accepted but answered without a wamid is SENT — treating that as a failure
 * is what made a working long-body send abort a whole turn.
 */
export interface SendOutcome {
  /** Graph returned 2xx. */
  ok: boolean;
  /** Present when Graph named the message. Absent is not a failure. */
  wamid: string | null;
  /** Graph's own words. Never empty when `ok` is false. */
  error?: string;
}

async function graphSend(
  phoneNumberId: string,
  token: string,
  payload: Record<string, unknown>,
  label: string,
): Promise<SendOutcome> {
  try {
    const res = await fetch(url(phoneNumberId), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const why = `${res.status} ${await refusal(res)}`;
      console.error(`[wa] ${label} refused:`, why);
      return { ok: false, wamid: null, error: why };
    }
    const body = (await res.json().catch(() => null)) as {
      messages?: Array<{ id?: string }>;
    } | null;
    return { ok: true, wamid: body?.messages?.[0]?.id ?? null };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.error(`[wa] ${label} threw:`, why);
    return { ok: false, wamid: null, error: why };
  }
}

/** Plain text, with Graph's verdict attached. */
export async function sendTextOutcome(
  phoneNumberId: string,
  to: string,
  text: string,
  token: string,
): Promise<SendOutcome> {
  return graphSend(
    phoneNumberId,
    token,
    {
      messaging_product: 'whatsapp',
      to: to.replace(/\D/g, ''),
      type: 'text',
      text: { body: text.slice(0, 4096) },
    },
    'text',
  );
}

export async function sendText(phoneNumberId: string, to: string, text: string, token: string): Promise<boolean> {
  return (await sendTextOutcome(phoneNumberId, to, text, token)).ok;
}

/** Like sendText but returns Graph wamid (for agent-send / delivery receipts). */
export async function sendTextWithWamid(
  phoneNumberId: string,
  to: string,
  text: string,
  token: string,
): Promise<string | null> {
  const out = await sendTextOutcome(phoneNumberId, to, text, token);
  return out.ok ? out.wamid : null;
}

export type MediaKind = 'image' | 'document' | 'video';

/** Human agent-send media (brochure / floor plan) by public link. */
export async function sendMediaOutcome(
  phoneNumberId: string,
  to: string,
  kind: MediaKind,
  link: string,
  opts: { caption?: string; filename?: string } = {},
  token: string,
): Promise<SendOutcome> {
  const payload: Record<string, unknown> = { link };
  if (opts.caption) payload.caption = opts.caption;
  if (kind === 'document' && opts.filename) payload.filename = opts.filename;
  return graphSend(
    phoneNumberId,
    token,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/\D/g, ''),
      type: kind,
      [kind]: payload,
    },
    `media:${kind}`,
  );
}

export async function sendMedia(
  phoneNumberId: string,
  to: string,
  kind: MediaKind,
  link: string,
  opts: { caption?: string; filename?: string } = {},
  token: string,
): Promise<string | null> {
  const out = await sendMediaOutcome(phoneNumberId, to, kind, link, opts, token);
  return out.ok ? out.wamid : null;
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
 * ride on a short follow-up — two bubbles, nothing lost.
 *
 * Returns the body the interactive should carry, plus Graph's verdict on the
 * long text when one was sent. That verdict is the one that matters to the
 * caller: the ANSWER is the message Desk has a row for, so its wamid — not the
 * carrier's — is what a delivery receipt has to be filed under. Null when the
 * long text itself was refused.
 */
async function carrierBody(
  phoneNumberId: string,
  to: string,
  bodyText: string,
  token: string,
): Promise<{ body: string; answer?: SendOutcome } | null> {
  if (bodyText.length <= INTERACTIVE_BODY_MAX) return { body: bodyText };
  const answer = await sendTextOutcome(phoneNumberId, to, bodyText, token);
  return answer.ok ? { body: CARRIER_PROMPT, answer } : null;
}

/** WhatsApp allows max 3 reply buttons; titles max 20 chars. */
export async function sendInteractiveButtons(
  phoneNumberId: string,
  to: string,
  bodyText: string,
  rawButtons: readonly WhatsAppReplyButton[],
  token: string,
): Promise<SendOutcome> {
  const buttons = uniqueById(rawButtons);
  if (buttons.length === 0) return sendTextOutcome(phoneNumberId, to, bodyText, token);
  const carrier = await carrierBody(phoneNumberId, to, bodyText, token);
  if (carrier === null) {
    return { ok: false, wamid: null, error: 'the answer text was refused before the buttons' };
  }
  const out = await graphSend(
    phoneNumberId,
    token,
    {
      messaging_product: 'whatsapp',
      to: to.replace(/\D/g, ''),
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: carrier.body },
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
    },
    'interactive buttons',
  );
  return settleInteractive(phoneNumberId, to, bodyText, token, carrier, out);
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
): Promise<SendOutcome> {
  // Ids must be unique across the WHOLE message, not within a section.
  const deduped = uniqueById(rawSections.flatMap((s) => s.rows.map((r) => ({ ...r, _s: s.title }))));
  const sections: WhatsAppListSection[] = rawSections
    .map((s) => ({ title: s.title, rows: deduped.filter((r) => r._s === s.title) }))
    .filter((s) => s.rows.length > 0);
  const rows = sections.flatMap((s) => s.rows);
  if (rows.length === 0) return sendTextOutcome(phoneNumberId, to, bodyText, token);
  const carrier = await carrierBody(phoneNumberId, to, bodyText, token);
  if (carrier === null) {
    return { ok: false, wamid: null, error: 'the answer text was refused before the list' };
  }
  const out = await graphSend(
    phoneNumberId,
    token,
    {
      messaging_product: 'whatsapp',
      to: to.replace(/\D/g, ''),
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: carrier.body },
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
    },
    'interactive list',
  );
  return settleInteractive(phoneNumberId, to, bodyText, token, carrier, out);
}

/**
 * Chrome is the garnish; it must never take the reply with it.
 *
 * Three ways this ends, and the wamid differs in each: the interactive landed
 * whole (its own id, unless a carrier was used — then the ANSWER's id, because
 * that is the bubble Desk recorded); the interactive was refused but the long
 * answer had already gone as text (still a delivered turn); or nothing has gone
 * yet, so the text goes on its own.
 */
async function settleInteractive(
  phoneNumberId: string,
  to: string,
  bodyText: string,
  token: string,
  carrier: { body: string; answer?: SendOutcome },
  out: SendOutcome,
): Promise<SendOutcome> {
  if (out.ok) return { ok: true, wamid: carrier.answer?.wamid ?? out.wamid };
  if (carrier.answer) return { ok: true, wamid: carrier.answer.wamid };
  return sendTextOutcome(phoneNumberId, to, bodyText, token);
}

export function appendNumberedMenu(reply: string, labels: readonly string[]): string {
  if (!labels.length) return reply;
  const menu = labels.slice(0, 3).map((l, i) => `${i + 1}) ${l}`).join('\n');
  const combined = `${reply}\n\n${menu}`;
  return combined.slice(0, 4096);
}
