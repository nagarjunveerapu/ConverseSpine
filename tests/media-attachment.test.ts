import { describe, expect, it } from 'vitest';
import {
  attachmentFromMediaEvidence,
  deliveryKindForMedia,
  humanizeMediaKind,
  mediaAttachmentLabel,
} from '../src/engine/media-attachment.js';

describe('media attachments', () => {
  it('humanizes kinds for buyer labels', () => {
    expect(humanizeMediaKind('price_sheet')).toBe('Price sheet');
    expect(humanizeMediaKind('site_image')).toBe('Site photo');
  });

  it('prefers clean kind over noisy dummy Desk titles', () => {
    expect(
      mediaAttachmentLabel({
        title: 'Brigade Eldorado — 2 BHK Unit View (dummy)',
        assetKind: 'site_image',
      }),
    ).toBe('Site photo');
  });

  it('maps mime/kind to WhatsApp delivery', () => {
    expect(deliveryKindForMedia({ assetKind: 'brochure', mimeType: 'application/pdf' })).toBe(
      'document',
    );
    expect(deliveryKindForMedia({ assetKind: 'site_image', mimeType: 'image/png' })).toBe('image');
  });

  it('builds attachment without requiring prose URL', () => {
    const a = attachmentFromMediaEvidence({
      projectName: 'Brigade Eldorado',
      allowed: true,
      assetKind: 'brochure',
      title: 'Brochure',
      cdnUrl: 'https://nayadesk-dev.example/api/media/signed/x?sig=abc',
      mimeType: 'application/pdf',
    });
    expect(a?.label).toBe('Brochure');
    expect(a?.delivery).toBe('document');
    expect(a?.filename).toMatch(/\.pdf$/);
    expect(a?.url).toContain('signed');
  });
});
