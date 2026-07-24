/**
 * Collapse catalog micro-market labels into short, distinct coverage names
 * for empty-locality recovery copy.
 *
 * Catalog rows often look like "Devanahalli / Airport Corridor" alongside
 * "Devanahalli" and "Aerospace Park / Devanahalli Corridor" — dumping the
 * first five raw strings reads as a wall. This is presentation only; it does
 * not change search filters or Desk geography authority.
 */
export function collapseCoverageMarkets(
  markets: readonly string[],
  max = 4,
): string[] {
  const out: string[] = [];
  const keys: string[] = [];

  for (const raw of markets) {
    const short = (raw.split(/\s*\/\s*/)[0] ?? '').trim();
    if (!short) continue;
    const key = short.toLowerCase().replace(/\s+/g, ' ');
    if (keys.some((k) => k === key || k.includes(key) || key.includes(k))) continue;
    keys.push(key);
    out.push(short);
    if (out.length >= max) break;
  }

  return out;
}

export function coverageCoverBit(markets: readonly string[]): string {
  const coverage = collapseCoverageMarkets(markets);
  return coverage.length
    ? `I currently cover ${coverage.join(', ')}`
    : 'I can help with areas where I have projects on file';
}
