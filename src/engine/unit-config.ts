import type { UnitConfig } from './ports.js';

/** Format a size band for buyer-facing copy. */
export function formatSizeDisplay(
  minSqft: number | null | undefined,
  maxSqft: number | null | undefined,
): string | undefined {
  if (minSqft == null && maxSqft == null) return undefined;
  if (minSqft != null && maxSqft != null && minSqft !== maxSqft) {
    return `${minSqft}-${maxSqft} sqft`;
  }
  const v = minSqft ?? maxSqft;
  return v != null ? `${v} sqft` : undefined;
}

export function mapEnrichmentSummaryToUnitConfigs(summary: {
  unit_types: Array<{
    type: string;
    price_range: { min: number; max: number; display: string };
    size_range: { min: number | null; max: number | null; unit: string };
    disclosure_tier?: string;
  }>;
}): UnitConfig[] {
  return summary.unit_types
    .filter((u) => u.type && u.disclosure_tier !== 'admin_only')
    .map((u) => {
      const sizeDisplay = formatSizeDisplay(u.size_range.min, u.size_range.max);
      const priceMinInr =
        Number.isFinite(u.price_range.min) && u.price_range.min > 0
          ? Math.round(u.price_range.min / 100)
          : 0;
      return {
        unitType: u.type,
        priceDisplay: u.price_range.display || '',
        priceMinInr,
        ...(sizeDisplay ? { sizeDisplay } : {}),
        ...(u.size_range.min != null ? { sizeMinSqft: u.size_range.min } : {}),
        ...(u.size_range.max != null ? { sizeMaxSqft: u.size_range.max } : {}),
      };
    });
}

export function mapLegacyUnitsToUnitConfigs(
  units: Array<{
    unit_type: string;
    price_display: string;
    size_min_sqft?: number;
    size_max_sqft?: number;
    is_available?: number;
    disclosure_tier?: string;
    price_min_paise?: number;
  }>,
): UnitConfig[] {
  return units
    .filter((u) => u.is_available !== 0 && u.disclosure_tier !== 'admin_only' && u.unit_type)
    .map((u) => {
      const sizeDisplay = formatSizeDisplay(u.size_min_sqft, u.size_max_sqft);
      const priceMinInr =
        u.price_min_paise && u.price_min_paise > 0 ? Math.round(u.price_min_paise / 100) : 0;
      return {
        unitType: u.unit_type,
        priceDisplay: u.price_display ?? '',
        priceMinInr,
        ...(sizeDisplay ? { sizeDisplay } : {}),
        ...(u.size_min_sqft != null ? { sizeMinSqft: u.size_min_sqft } : {}),
        ...(u.size_max_sqft != null ? { sizeMaxSqft: u.size_max_sqft } : {}),
      };
    });
}

/** Compact line for availability compose: "1 BHK (Ivory) — 595-624 sqft from ₹41L–₹55L". */
export function formatUnitConfigLine(u: {
  unitType: string;
  priceDisplay: string;
  sizeDisplay?: string;
}): string {
  const size = u.sizeDisplay ? ` — ${u.sizeDisplay}` : '';
  const price = u.priceDisplay ? ` from ${u.priceDisplay}` : '';
  return `${u.unitType}${size}${price}`;
}

/**
 * Match buyer BHK preference against a unit_type label.
 * Mirrors NayaDesk unitTypeMatches — keep in sync for chat-side filtering.
 */
export function unitTypeMatchesBhk(buyerBhk: string, unitType: string): boolean {
  const want = buyerBhk.toLowerCase().replace(/\s+/g, ' ').trim();
  const have = unitType.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!want) return false;
  if (/^4\+?\s*bhk\b/.test(want) || want.includes('4 bhk or more')) {
    const n = have.match(/^(\d+(?:\.\d+)?)\s*bhk\b/);
    return n !== null && parseFloat(n[1]!) >= 4;
  }
  if (have === want) return true;
  if (!have.startsWith(want)) return false;
  const next = have.charAt(want.length);
  return next === '' || /[\s(+\-]/.test(next);
}

/** Pull explicit "2 BHK" / "2bhk" asks from the turn text. */
export function extractBhkAskFromText(text: string): string | undefined {
  const m = /\b(\d(?:\.\d)?)\s*bhk\b/i.exec(text);
  if (!m?.[1]) return undefined;
  return `${m[1]} BHK`;
}

/**
 * Prefer turn-local BHK ask ("give me 2BHK configurations"), else constraint.
 * Returns undefined when buyer wants the full list.
 */
export function resolveAvailabilityBhkFilter(args: {
  buyerText?: string;
  constraintBhk?: string;
}): string | undefined {
  const fromText = args.buyerText ? extractBhkAskFromText(args.buyerText) : undefined;
  if (fromText) return fromText;
  const c = args.constraintBhk?.trim();
  if (!c) return undefined;
  // Multi-select "2 BHK · 3 BHK" — don't silently pick one; show full list.
  if (/[·,]/.test(c) || /\bor\b/i.test(c)) return undefined;
  if (/\d\s*bhk/i.test(c)) return c.replace(/\s+/g, ' ').replace(/\bbhk\b/i, 'BHK');
  return undefined;
}

/** Filter unit evidence to the buyer's BHK when scoped; else return all. */
export function filterUnitsByBhk<T extends { unitType: string }>(
  units: readonly T[],
  bhkFilter: string | undefined,
): T[] {
  if (!bhkFilter || units.length === 0) return [...units];
  const matched = units.filter((u) => unitTypeMatchesBhk(bhkFilter, u.unitType));
  // If nothing matches (e.g. plot estate with no BHK labels), keep full list.
  return matched.length > 0 ? matched : [...units];
}
