/**
 * Catalog vs asked end-use — inventory honesty, not intent classification.
 * Used by WhatsApp no_fit copy and the empty-cut packer so a plantation ask
 * on an apartment book is a handoff, not "change bedrooms".
 */

/** Does this builder's book carry the asked end-use? */
export function catalogSellsPropertyType(
  catalogTypes: readonly string[] | undefined,
  asked: string | undefined,
): boolean | 'unknown' {
  if (!asked?.trim()) return 'unknown';
  if (!catalogTypes?.length) return 'unknown';
  const blob = catalogTypes.join(' ').toLowerCase();
  const s = asked.toLowerCase();
  const hit = (re: RegExp) => re.test(blob);
  // Plantation first — "apartment,plantation" is still a farmland ask.
  if (/plantation|planted|farm/.test(s)) return hit(/plantation|planted|estate|farm/);
  if (/villa/.test(s)) return hit(/villa/);
  if (/\bplot|plotted/.test(s)) return hit(/plot/);
  if (/apartment|flat/.test(s)) return hit(/apartment|flat/);
  return catalogTypes.some((t) => {
    const pt = t.toLowerCase();
    return pt.includes(s) || s.includes(pt);
  });
}

/** Catalog-wide type miss — stamp on no_fit evidence and session latch. */
export function unsupportedProductStamp(
  catalogTypes: readonly string[] | undefined,
  asked: string | undefined,
): { unsupportedProduct: { requestedType: string } } | undefined {
  const t = asked?.trim();
  if (!t) return undefined;
  if (catalogSellsPropertyType(catalogTypes, t) !== false) return undefined;
  return { unsupportedProduct: { requestedType: t } };
}

/** Bedroom/budget levers only make sense for an apartment miss. */
export function emptyCutUsesApartmentLevers(propertyType: string | undefined): boolean {
  const s = (propertyType ?? '').toLowerCase();
  if (!s) return true;
  if (/plantation|planted|farm|villa|plot/.test(s)) return false;
  return /apartment|flat/.test(s) || !s;
}
