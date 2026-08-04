/**
 * Buyer-facing media attachments — structured payload separate from prose.
 * Compose never pastes signed URLs into reply text; channels render cards /
 * native WhatsApp media from this list.
 */
import type { MediaEvidence } from './types.js';

export type MediaDeliveryKind = 'image' | 'document' | 'video';

export interface MediaAttachment {
  /** Desk asset_kind (brochure, site_image, …). */
  asset_kind: string;
  /** Short buyer label: "Brochure", "2 BHK unit view". */
  label: string;
  url: string;
  mime_type?: string;
  /** WhatsApp Graph type. */
  delivery: MediaDeliveryKind;
  /** Suggested filename for document sends. */
  filename?: string;
  project_name?: string;
}

/** Prefer Desk title when short; else humanized kind. */
export function mediaAttachmentLabel(media: Pick<MediaEvidence, 'title' | 'assetKind'>): string {
  const title = (media.title ?? '').trim();
  // Desk dummy titles can be long ("Brigade Eldorado — 2 BHK Unit View (dummy)").
  // Prefer a clean kind label when title is noisy or too long for a chip.
  const kindLabel = humanizeMediaKind(media.assetKind);
  if (!title) return kindLabel;
  if (title.length > 48) return kindLabel;
  if (/\(dummy(?:\s+seed)?\)|test seed|seed ensure|dummy seed/i.test(title)) return kindLabel;
  // Title that already looks like a kind ("Price Sheet") — keep it.
  return title.replace(/^Brigade\s+Eldorado\s*[—–-]\s*/i, '').trim() || kindLabel;
}

export function humanizeMediaKind(kind?: string): string {
  if (!kind) return 'Document';
  const nice: Record<string, string> = {
    floor_plan: 'Floor plan',
    master_plan: 'Master plan',
    layout_plan: 'Layout plan',
    brochure: 'Brochure',
    price_sheet: 'Price sheet',
    cost_sheet: 'Cost sheet',
    payment_plan: 'Payment plan',
    site_image: 'Site photo',
    ownership_certificate: 'Ownership certificate',
    legal_agreement: 'Legal agreement',
    video: 'Video',
    location_map: 'Location map',
  };
  const k = kind.trim().toLowerCase();
  if (nice[k]) return nice[k];
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function deliveryKindForMedia(args: {
  assetKind?: string;
  mimeType?: string;
  url?: string;
}): MediaDeliveryKind {
  const mime = (args.mimeType ?? '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  const kind = (args.assetKind ?? '').toLowerCase();
  if (kind === 'site_image' || kind === 'location_map') return 'image';
  if (kind === 'video') return 'video';
  const url = (args.url ?? '').toLowerCase();
  if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)) return 'image';
  if (/\.(mp4|mov|webm)(\?|$)/i.test(url)) return 'video';
  return 'document';
}

export function filenameForMedia(args: {
  label: string;
  assetKind?: string;
  mimeType?: string;
  delivery: MediaDeliveryKind;
}): string {
  const base = args.label
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40) || (args.assetKind ?? 'document');
  if (args.delivery === 'image') {
    if (args.mimeType?.includes('png')) return `${base}.png`;
    return `${base}.jpg`;
  }
  if (args.delivery === 'video') return `${base}.mp4`;
  return `${base}.pdf`;
}

/** Build a single attachment from successful media evidence. */
export function attachmentFromMediaEvidence(
  media: MediaEvidence,
): MediaAttachment | undefined {
  if (!media.allowed || !media.cdnUrl) return undefined;
  const label = mediaAttachmentLabel(media);
  const delivery = deliveryKindForMedia({
    assetKind: media.assetKind,
    mimeType: media.mimeType,
    url: media.cdnUrl,
  });
  return {
    asset_kind: media.assetKind ?? 'document',
    label,
    url: media.cdnUrl,
    ...(media.mimeType ? { mime_type: media.mimeType } : {}),
    delivery,
    filename: filenameForMedia({
      label,
      assetKind: media.assetKind,
      mimeType: media.mimeType,
      delivery,
    }),
    ...(media.projectName ? { project_name: media.projectName } : {}),
  };
}
