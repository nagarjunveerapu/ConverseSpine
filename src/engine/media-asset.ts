/**
 * Desk AssetKind normalization + focused-project media inventory checks.
 * Buyer phrasings ("photos", "cost sheet") must map to Desk enum values before
 * /api/media/share — invalid kinds 400 and used to drop media evidence entirely,
 * letting legal/FAQ bleed into the reply.
 */

/** Desk `AssetKind` values the bot may request via media/share. */
export const DESK_MEDIA_KINDS = [
  'brochure',
  'floor_plan',
  'master_plan',
  'site_image',
  'price_sheet',
  'revenue_sharing_model',
  'payment_plan',
  'legal_agreement',
  'ownership_certificate',
  'allotment_letter',
  'kmz_layout',
  'soil_report',
  'crop_yield_report',
  'location_map',
] as const;

export type DeskMediaKind = (typeof DESK_MEDIA_KINDS)[number];

const ALIASES: Record<string, DeskMediaKind> = {
  photo: 'site_image',
  photos: 'site_image',
  image: 'site_image',
  images: 'site_image',
  gallery: 'site_image',
  site_photo: 'site_image',
  site_photos: 'site_image',
  cost_sheet: 'price_sheet',
  costsheet: 'price_sheet',
  price_list: 'price_sheet',
  pricing_sheet: 'price_sheet',
  rera_certificate: 'ownership_certificate',
  rera_cert: 'ownership_certificate',
  ownership: 'ownership_certificate',
  layout: 'floor_plan',
  unit_plan: 'floor_plan',
};

/** Map extractor / buyer kind → Desk asset_kind (or undefined if unknown). */
export function normalizeMediaAssetKind(raw: string | undefined | null): DeskMediaKind | undefined {
  const k = (raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!k) return undefined;
  if ((DESK_MEDIA_KINDS as readonly string[]).includes(k)) return k as DeskMediaKind;
  return ALIASES[k];
}

/** True when inventory is known and does not list the requested kind. */
export function mediaKindMissingFromInventory(
  kind: string | undefined,
  inventory: readonly string[] | undefined,
): boolean {
  if (!kind || !inventory?.length) return false;
  const want = normalizeMediaAssetKind(kind) ?? kind.trim().toLowerCase();
  const have = new Set(inventory.map((x) => x.trim().toLowerCase()).filter(Boolean));
  return !have.has(want);
}

export function uniqueMediaKinds(
  rows: ReadonlyArray<{ asset_kind?: string | null }> | null | undefined,
): string[] | undefined {
  if (!rows?.length) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const k = (r.asset_kind ?? '').trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out.length ? out : undefined;
}
