import { haversineKm } from './geo.js';

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

export type CoverageAnchor = {
  microMarket: string;
  lat: number;
  lng: number;
};

export type CoverageOrderOpts = {
  /** Asked place when Desk/geocode has coords — prefer nearest served markets. */
  ask?: { lat: number; lng: number } | null;
  /** Live project coords + micro_market — build market centroids / inventory hub. */
  anchors?: readonly CoverageAnchor[];
};

function primaryMarketKey(raw: string): string {
  return (raw.split(/\s*\/\s*/)[0] ?? raw).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Rank catalog micro-markets for cover-bit copy.
 * - With ask coords: nearest market centroid first.
 * - Else with project anchors: nearest to inventory hub (mean of project coords)
 *   so dense builder corridors beat far outliers in raw Set order.
 * - Else: preserve catalog order.
 * Does not change search filters or Desk geography authority.
 */
export function orderCoverageMarkets(
  markets: readonly string[],
  opts?: CoverageOrderOpts,
): string[] {
  if (!markets.length) return [];
  const anchors = opts?.anchors ?? [];
  if (!anchors.length && !opts?.ask) return [...markets];

  const centroids = new Map<string, { lat: number; lng: number; n: number }>();
  for (const a of anchors) {
    const key = primaryMarketKey(a.microMarket);
    if (!key) continue;
    const prev = centroids.get(key);
    if (prev) {
      prev.lat += a.lat;
      prev.lng += a.lng;
      prev.n += 1;
    } else {
      centroids.set(key, { lat: a.lat, lng: a.lng, n: 1 });
    }
  }
  for (const c of centroids.values()) {
    c.lat /= c.n;
    c.lng /= c.n;
  }

  let hub = opts?.ask ?? null;
  if (!hub && anchors.length) {
    let lat = 0;
    let lng = 0;
    for (const a of anchors) {
      lat += a.lat;
      lng += a.lng;
    }
    hub = { lat: lat / anchors.length, lng: lng / anchors.length };
  }
  if (!hub) return [...markets];

  return markets
    .map((raw, index) => {
      const c = centroids.get(primaryMarketKey(raw));
      const dist = c
        ? haversineKm(hub!.lat, hub!.lng, c.lat, c.lng)
        : Number.POSITIVE_INFINITY;
      return { raw, index, dist };
    })
    .sort((a, b) => a.dist - b.dist || a.index - b.index)
    .map((row) => row.raw);
}

export function coverageCoverBit(
  markets: readonly string[],
  opts?: CoverageOrderOpts,
): string {
  const coverage = collapseCoverageMarkets(orderCoverageMarkets(markets, opts));
  return coverage.length
    ? `I currently cover ${coverage.join(', ')}`
    : 'I can help with areas where I have projects on file';
}

/** Build ranking opts from optional ask geo + projectCoords rows. */
export function coverageOrderOptsFrom(input: {
  ask?: { lat: number; lng: number } | null;
  projectCoords?: ReadonlyArray<{ microMarket?: string; lat: number; lng: number }>;
}): CoverageOrderOpts | undefined {
  const anchors: CoverageAnchor[] = [];
  for (const row of input.projectCoords ?? []) {
    const mm = row.microMarket?.trim();
    if (!mm) continue;
    anchors.push({ microMarket: mm, lat: row.lat, lng: row.lng });
  }
  if (!input.ask && !anchors.length) return undefined;
  return {
    ...(input.ask ? { ask: input.ask } : {}),
    ...(anchors.length ? { anchors } : {}),
  };
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

/** Buyer-facing inventory noun from property type (BHK ⇒ apartments when type empty). */
export function inventoryNoun(
  propertyType?: string | null,
  bhk?: string | null,
): string {
  const t = (propertyType ?? '').toLowerCase();
  if (/\bapartment|flat\b/.test(t)) return 'apartments';
  if (/\bvilla\b/.test(t)) return 'villas';
  if (/\bplot|plotted\b/.test(t)) return 'plots';
  if (/plantation/.test(t)) return 'plantation options';
  if (bhk?.trim()) return 'apartments';
  return 'homes';
}

/** Join 1–n place labels for cover copy. */
export function joinPlaceLabels(names: readonly string[]): string {
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!clean.length) return '';
  if (clean.length === 1) return clean[0]!;
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')}, and ${clean[clean.length - 1]}`;
}

/**
 * Outside-served inventory bit — cities we sell in, not project names.
 * Null if no cities.
 */
export function coverageCityCoverBit(
  cities: readonly string[],
  propertyType?: string | null,
  bhk?: string | null,
): string | null {
  const joined = joinPlaceLabels(cities);
  if (!joined) return null;
  const noun = inventoryNoun(propertyType, bhk);
  return `I have ${noun} in ${joined}`;
}

export type OutsideServedOpts = CoverageOrderOpts & {
  /** Desk-derived served cities — preferred over corridor list. */
  servedCities?: readonly string[];
  /** Optional type so Delhi + apartment → "apartments in Bengaluru". */
  propertyType?: string | null;
  bhk?: string | null;
};

/**
 * Buyer-facing outside-served reply.
 * City inventory only — never a project list.
 */
export function outsideServedReply(
  asked: string,
  markets: readonly string[],
  opts?: OutsideServedOpts,
): string {
  const loc = asked.trim() || 'that area';
  const noun = inventoryNoun(opts?.propertyType, opts?.bhk);
  const cityBit = coverageCityCoverBit(
    opts?.servedCities ?? [],
    opts?.propertyType,
    opts?.bhk,
  );
  if (cityBit) {
    return `I don't have ${noun} in *${loc}* — ${cityBit}. Want to look there?`;
  }
  const coverBit = coverageCoverBit(markets, opts);
  return `I don't have ${noun} in *${loc}* — ${coverBit}. Want to adjust budget, area, or property type?`;
}
