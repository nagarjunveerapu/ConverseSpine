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

export type ServedMarketMatch = {
  name: string;
  /** 3 exact · 2 containment · 1 token/typo — weak matches stay releasable. */
  score: 1 | 2 | 3;
  authority: 'declared' | 'inferred';
};

function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/**
 * Match a buyer locality against live served micro-markets (catalog).
 * No metro hardcoding. Substring over-match is gated; weak hits are inferred
 * so Phase-3 relaxation can still release them.
 */
export function matchServedMarket(
  candidate: string,
  markets: readonly string[],
): ServedMarketMatch | undefined {
  const needle = candidate.toLowerCase().trim().replace(/\s+/g, ' ');
  if (needle.length < 3 || !markets.length) return undefined;

  let best: ServedMarketMatch | undefined;
  const consider = (name: string, score: 1 | 2 | 3) => {
    const authority = score >= 2 ? 'declared' : 'inferred';
    if (!best || score > best.score) best = { name, score, authority };
  };

  for (const raw of markets) {
    const primary = (raw.split(/\s*\/\s*/)[0] ?? raw).trim();
    if (!primary) continue;
    const key = primary.toLowerCase().replace(/\s+/g, ' ');
    if (key === needle) {
      consider(primary, 3);
      continue;
    }
    // Containment: needle inside key is safe at ≥4 chars. Reverse only when the
    // market token is long enough that it isn't a trivial substring of the ask.
    if (needle.length >= 4 && key.includes(needle)) {
      consider(primary, 2);
      continue;
    }
    if (key.length >= 5 && needle.includes(key)) {
      consider(primary, 2);
      continue;
    }
    const tokens = needle.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
    if (tokens.some((t) => key.includes(t))) {
      consider(primary, 1);
      continue;
    }
    // Light typo pass against primary label tokens (not the full "X Road" string).
    // Longer tokens allow distance 3 (e.g. stubborn Sarjapur misspellings).
    if (needle.length >= 5) {
      const keyTokens = key.split(/[^a-z0-9]+/).filter((t) => t.length >= 5);
      if (
        keyTokens.some((t) => {
          const max = t.length >= 8 ? 3 : 2;
          return editDistance(needle, t, max) <= max;
        })
      ) {
        consider(primary, 1);
      }
    }
  }
  return best;
}

/** Buyer-facing outside-served reply — cover bit is always from live catalog. */
export function outsideServedReply(asked: string, markets: readonly string[]): string {
  const loc = asked.trim() || 'that area';
  const coverBit = coverageCoverBit(markets);
  return `I don't have anything in *${loc}* — ${coverBit}. Want to adjust budget, area, or property type?`;
}
