/**
 * After the text reply, deliver structured media as native WhatsApp
 * image/document messages (filename/caption human, URL off-screen).
 */
import { sendMedia, type MediaKind } from './whatsapp-client.js';
import type { MediaAttachmentDto } from '../types.js';

export async function deliverWhatsAppMediaAttachments(
  phoneNumberId: string,
  to: string,
  attachments: readonly MediaAttachmentDto[] | undefined,
  token: string,
): Promise<void> {
  if (!attachments?.length || !token) return;
  for (const a of attachments.slice(0, 3)) {
    const kind = a.delivery as MediaKind;
    const caption =
      a.project_name && a.label
        ? `${a.label} · ${a.project_name}`.slice(0, 1024)
        : a.label.slice(0, 1024);
    await sendMedia(
      phoneNumberId,
      to,
      kind,
      a.url,
      {
        caption,
        ...(kind === 'document' && a.filename ? { filename: a.filename } : {}),
      },
      token,
    );
  }
}
