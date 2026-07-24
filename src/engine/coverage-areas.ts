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

/** Match a buyer locality against live served micro-markets (catalog / area registry). */
export function matchServedMarket(
  candidate: string,
  markets: readonly string[],
): string | undefined {
  const needle = candidate.toLowerCase().trim().replace(/\s+/g, ' ');
  if (needle.length < 3 || !markets.length) return undefined;

  let best: { name: string; score: number } | undefined;
  for (const raw of markets) {
    const primary = (raw.split(/\s*\/\s*/)[0] ?? raw).trim();
    if (!primary) continue;
    const key = primary.toLowerCase().replace(/\s+/g, ' ');
    let score = 0;
    if (key === needle) score = 3;
    else if (key.includes(needle) || needle.includes(key)) score = 2;
    else {
      const tokens = needle.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
      if (tokens.some((t) => key.includes(t))) score = 1;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { name: primary, score };
    }
  }
  return best?.name;
}

/** Buyer-facing outside-served reply — cover bit is always from live catalog. */
export function outsideServedReply(asked: string, markets: readonly string[]): string {
  const loc = asked.trim() || 'that area';
  const coverBit = coverageCoverBit(markets);
  return `I don't have anything in *${loc}* — ${coverBit}. Want to adjust budget, area, or property type?`;
}
