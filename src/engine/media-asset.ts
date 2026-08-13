/**
 * Desk AssetKind normalization + focused-project media inventory checks.
 * Buyer phrasings ("photos", "cost sheet") must map to Desk enum values before
 * /api/media/share — invalid kinds 400 and used to drop media evidence entirely,
 * letting legal/FAQ bleed into the reply.
 */

/**
 * Desk `AssetKind` values the bot may request via media/share.
 * Keep in sync with NayaDesk `src/types.ts` (`export type AssetKind` — ~line 402).
 * Drift degrades to an honest miss (share 400), never fabrication.
 */
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

/**
 * Every asset kind the buyer named in one message.
 *
 * "send brochure floor plan price list and rera" is four asks; the share port
 * takes one kind, so the reply delivered the floor plan and said nothing about
 * the brochure. A buyer reads that silence as "sent". Reading the buyer's own
 * words against the closed Desk enum is how the reply knows what it left out.
 */
const KIND_PHRASES: ReadonlyArray<readonly [DeskMediaKind, RegExp]> = [
  ['brochure', /\b(?:e[- ]?)?brochures?\b/i],
  ['floor_plan', /\b(?:floor|unit|layout)\s*plans?\b/i],
  ['master_plan', /\b(?:master|site)\s*plans?\b/i],
  ['price_sheet', /\bprice\s*(?:list|sheet)\b|\bcost\s*sheet\b|\brate\s*card\b/i],
  ['site_image', /\b(?:photos?|pictures?|pics?|images?|gallery)\b/i],
  ['payment_plan', /\bpayment\s*(?:plan|schedule)\b|\bclp\b/i],
  ['location_map', /\blocation\s*map\b|\bgoogle\s*(?:map|pin)\b/i],
];

/** Buyer-facing name for an asset kind — never an underscored key like `floor_plan`. */
export function humanizeMediaKind(kind?: string): string {
  if (!kind) return 'document';
  const nice: Record<string, string> = {
    floor_plan: 'floor plan',
    master_plan: 'master plan',
    layout_plan: 'layout plan',
    brochure: 'brochure',
    price_sheet: 'price sheet',
    cost_sheet: 'cost sheet',
    payment_plan: 'payment plan',
    site_image: 'site photos',
    site_plan: 'site plan',
    location_map: 'location map',
    video: 'walkthrough video',
    photo: 'photos',
  };
  return nice[kind] ?? kind.replace(/_/g, ' ');
}

export function requestedMediaKinds(text: string): DeskMediaKind[] {
  const t = (text ?? '').trim();
  if (!t) return [];
  return KIND_PHRASES.filter(([, re]) => re.test(t)).map(([k]) => k);
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
