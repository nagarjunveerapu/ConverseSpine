/**
 * Format + gate approved Desk market intel / project investment for ProjectDetail.
 * τ = 0.5 — below confidence → treat as absent (honest decline).
 */
import type { NdMarketIntel } from '../crm/nayadesk-client.js';
import type {
  FactKey,
  ProjectDetail,
  ProjectInvestment,
  ProjectMarketIntel,
  ProjectVisitLogistics,
} from './types.js';

export const MARKET_INTEL_MIN_CONFIDENCE = 0.5;

/** Local INR helper — avoid importing compose (compose imports this module). */
function formatInr(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(2).replace(/\.?0+$/, '')} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function provenanceLabel(source: string, asOf: string): string {
  const s = source.trim();
  const a = asOf.trim();
  if (s && a) return `(${s}, ${a})`;
  if (s) return `(${s})`;
  if (a) return `(as of ${a})`;
  return '(sourced market intel)';
}

export function gateMarketIntel(raw: NdMarketIntel | null | undefined): ProjectMarketIntel | undefined {
  if (!raw) return undefined;
  const confidence = Number(raw.provenance?.confidence ?? 0);
  if (!(confidence >= MARKET_INTEL_MIN_CONFIDENCE)) return undefined;
  const rentBands = (raw.rent_bands ?? [])
    .map((b) => {
      const min = Number((b as { rent_min_inr?: unknown }).rent_min_inr);
      const max = Number((b as { rent_max_inr?: unknown }).rent_max_inr);
      return {
        ...(b.unit_type ? { unitType: String(b.unit_type) } : {}),
        ...(Number.isFinite(min) && min > 0 ? { rentMinInr: min } : {}),
        ...(Number.isFinite(max) && max > 0 ? { rentMaxInr: max } : {}),
      };
    })
    .filter((b) => b.rentMinInr !== undefined || b.rentMaxInr !== undefined || b.unitType);
  const drivers = (raw.drivers ?? [])
    .map((d) => ({
      event: String((d as { event?: string }).event ?? '').trim(),
      ...((d as { date?: string }).date ? { date: String((d as { date?: string }).date) } : {}),
      ...((d as { note?: string }).note ? { note: String((d as { note?: string }).note) } : {}),
    }))
    .filter((d) => d.event);
  const a3 = raw.appreciation?.three_yr_pct;
  const a5 = raw.appreciation?.five_yr_pct;
  const hasAppr = typeof a3 === 'number' || typeof a5 === 'number';
  if (!hasAppr && !rentBands.length && !drivers.length) return undefined;
  const source = raw.provenance?.source ?? '';
  const asOf = raw.provenance?.as_of ?? '';
  return {
    displayName: raw.display_name || raw.micro_market_id,
    ...(typeof a3 === 'number' ? { appreciation3yrPct: a3 } : {}),
    ...(typeof a5 === 'number' ? { appreciation5yrPct: a5 } : {}),
    ...(raw.appreciation?.corridor_maturity
      ? { corridorMaturity: raw.appreciation.corridor_maturity }
      : {}),
    rentBands,
    drivers,
    provenance: { source, asOf, confidence },
    provenanceLabel: provenanceLabel(source, asOf),
  };
}

export function mapInvestmentFromProject(p: {
  expected_roi?: string | null;
  revenue_model?: string | null;
  operator_brand?: string | null;
  guaranteed_payment?: string | null;
  maintenance_model?: string | null;
  target_buyer_profiles?: string | null;
  category_tags?: string | null;
  land_classification?: string | null;
  build_coverage?: string | null;
  launch_stage?: string | null;
}): ProjectInvestment | undefined {
  const profiles = parseJsonStringArray(p.target_buyer_profiles);
  const tags = parseJsonStringArray(p.category_tags);
  const inv: ProjectInvestment = {
    ...(trim(p.expected_roi) ? { expectedRoi: trim(p.expected_roi)! } : {}),
    ...(trim(p.revenue_model) ? { revenueModel: trim(p.revenue_model)! } : {}),
    ...(trim(p.operator_brand) ? { operatorBrand: trim(p.operator_brand)! } : {}),
    ...(trim(p.guaranteed_payment) ? { guaranteedPayment: trim(p.guaranteed_payment)! } : {}),
    ...(trim(p.maintenance_model) ? { maintenanceModel: trim(p.maintenance_model)! } : {}),
    ...(profiles.length ? { targetBuyerProfiles: profiles } : {}),
    ...(tags.length ? { categoryTags: tags } : {}),
    ...(trim(p.land_classification) ? { landClassification: trim(p.land_classification)! } : {}),
    ...(trim(p.build_coverage) ? { buildCoverage: trim(p.build_coverage)! } : {}),
    ...(trim(p.launch_stage) ? { launchStage: trim(p.launch_stage)! } : {}),
  };
  return Object.keys(inv).length ? inv : undefined;
}

export function mapVisitLogisticsFromProject(p: {
  pickup_mode?: string | null;
  pickup_origin_cities?: string | null;
  pickup_radius_km?: number | null;
  pickup_cost_note?: string | null;
  // 0/1 INTEGER columns on Desk, not prose — see offeredFlag.
  parking_on_site?: string | number | boolean | null;
  food_offered?: string | number | boolean | null;
  accommodation_offered?: string | number | boolean | null;
  visit_duration_note?: string | null;
  site_visit_hours?: string | null;
}): ProjectVisitLogistics | undefined {
  const parking = offeredFlag(p.parking_on_site, 'available');
  const food = offeredFlag(p.food_offered, 'provided');
  const stay = offeredFlag(p.accommodation_offered, 'provided');
  const v: ProjectVisitLogistics = {
    ...(trim(p.pickup_mode) ? { pickupMode: trim(p.pickup_mode)! } : {}),
    ...(trim(p.pickup_origin_cities) ? { pickupOriginCities: trim(p.pickup_origin_cities)! } : {}),
    ...(typeof p.pickup_radius_km === 'number' ? { pickupRadiusKm: p.pickup_radius_km } : {}),
    ...(trim(p.pickup_cost_note) ? { pickupCostNote: trim(p.pickup_cost_note)! } : {}),
    ...(parking ? { parkingOnSite: parking } : {}),
    ...(food ? { foodOffered: food } : {}),
    ...(stay ? { accommodationOffered: stay } : {}),
    ...(trim(p.visit_duration_note) ? { visitDurationNote: trim(p.visit_duration_note)! } : {}),
    ...(trim(p.site_visit_hours) ? { siteVisitHours: trim(p.site_visit_hours)! } : {}),
  };
  return Object.keys(v).length ? v : undefined;
}

export function mapAmenitiesFromSpec(specJson: string | null | undefined): string[] | undefined {
  if (!specJson?.trim()) return undefined;
  try {
    const v = JSON.parse(specJson) as unknown;
    if (Array.isArray(v)) {
      const list = v.map((x) => String(x).trim()).filter(Boolean);
      return list.length ? list : undefined;
    }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const raw = o.amenities ?? o.Amenities ?? o.features;
      if (Array.isArray(raw)) {
        const list = raw.map((x) => String(x).trim()).filter(Boolean);
        return list.length ? list : undefined;
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

export function hasRentBands(mi?: ProjectMarketIntel): boolean {
  return (mi?.rentBands.length ?? 0) > 0;
}

export function hasAppreciation(mi?: ProjectMarketIntel): boolean {
  return (
    typeof mi?.appreciation3yrPct === 'number' || typeof mi?.appreciation5yrPct === 'number'
  );
}

export function hasInvestmentRoi(inv?: ProjectInvestment): boolean {
  return Boolean(inv?.expectedRoi?.trim());
}

/** Buyer-facing lines for required advisory atoms (provenance mandatory). */
export function advisoryFactLines(
  detail: ProjectDetail,
  requires: readonly FactKey[] | undefined,
  buyerText = '',
): string[] {
  const lines: string[] = [];
  const mi = detail.marketIntel;
  const inv = detail.investment;
  const wantYield =
    requires?.includes('rental_yield') ||
    (!requires?.length &&
      /\b(?:rental\s+yield|yield|roi|return\s+on\s+investment|rental\s+returns?|rental\s+income)\b/i.test(
        buyerText,
      ));
  const wantAppr =
    requires?.includes('appreciation') ||
    (!requires?.length && /\b(?:appreciat\w*|grown|growth\s+in\s+(?:this\s+)?(?:area|corridor))\b/i.test(buyerText));

  if (wantYield) {
    const parts: string[] = [];
    if (mi && hasRentBands(mi)) {
      const bands = mi.rentBands
        .slice(0, 3)
        .map((b) => {
          const type = b.unitType ? `${b.unitType} ` : '';
          if (b.rentMinInr !== undefined && b.rentMaxInr !== undefined) {
            return `${type}${formatInr(b.rentMinInr)}–${formatInr(b.rentMaxInr)}/mo`;
          }
          if (b.rentMinInr !== undefined) return `${type}from ${formatInr(b.rentMinInr)}/mo`;
          if (b.rentMaxInr !== undefined) return `${type}up to ${formatInr(b.rentMaxInr)}/mo`;
          return type.trim();
        })
        .filter(Boolean)
        .join('; ');
      if (bands) {
        const project = detail.name?.trim();
        const where = project
          ? `*${project}* (${mi.displayName})`
          : `*${mi.displayName}*`;
        parts.push(`Typical rents near ${where} run about ${bands} ${mi.provenanceLabel}`);
      }
    }
    if (inv?.expectedRoi?.trim()) {
      parts.push(
        `The project states expected ROI as ${inv.expectedRoi.trim()} — that is the builder's stated figure, not a guaranteed return`,
      );
    }
    if (parts.length) lines.push(parts.join('. '));
  }

  if (wantAppr && mi && hasAppreciation(mi)) {
    const bits: string[] = [];
    if (typeof mi.appreciation3yrPct === 'number') {
      bits.push(`~${mi.appreciation3yrPct}% over 3 years`);
    }
    if (typeof mi.appreciation5yrPct === 'number') {
      bits.push(`~${mi.appreciation5yrPct}% over 5 years`);
    }
    if (bits.length) {
      lines.push(
        `Corridor appreciation for *${mi.displayName}*: ${bits.join(', ')} ${mi.provenanceLabel}`,
      );
    }
  }

  const wantDrivers =
    requires?.includes('growth_drivers') ||
    (!requires?.length &&
      /\b(?:what(?:'s|\s+is)\s+driving|growth\s+drivers?|why\s+is\s+(?:this\s+)?(?:area|corridor)\s+growing|infra(?:structure)?\s+(?:pipeline|coming)|upcoming\s+(?:metro|airport|ring\s*road))\b/i.test(
        buyerText,
      ));
  if (wantDrivers && mi && mi.drivers.length) {
    const events = mi.drivers
      .slice(0, 4)
      .map((d) => {
        const when = d.date ? ` (${d.date})` : '';
        return `${d.event}${when}`;
      })
      .join('; ');
    const maturity = mi.corridorMaturity?.trim()
      ? ` Corridor maturity on file: ${mi.corridorMaturity.trim()}.`
      : '';
    lines.push(
      `Growth drivers on file for *${mi.displayName}*: ${events}.${maturity} ${mi.provenanceLabel}`.trim(),
    );
  }

  const wantOperator =
    requires?.includes('operator_model') ||
    (!requires?.length &&
      /\b(?:operator|who\s+operates|revenue\s+model|maintenance\s+model|managed)\b/i.test(buyerText));
  if (wantOperator && inv) {
    const bits: string[] = [];
    if (inv.operatorBrand) bits.push(`operated by ${inv.operatorBrand}`);
    if (inv.revenueModel) bits.push(`revenue model: ${inv.revenueModel}`);
    if (inv.maintenanceModel) bits.push(`maintenance: ${inv.maintenanceModel}`);
    if (inv.guaranteedPayment) {
      bits.push(`stated payout note: ${inv.guaranteedPayment} (not a personal return promise)`);
    }
    if (bits.length) lines.push(bits.join('; '));
  }

  if (
    (/\bamenities?\b/i.test(buyerText) || requires === undefined) &&
    detail.amenities?.length &&
    /\bamenities?\b/i.test(buyerText)
  ) {
    lines.push(`Amenities on file: ${detail.amenities.slice(0, 8).join(', ')}`);
  }

  const wantVisit =
    requires?.includes('visit_logistics') ||
    (!requires?.length &&
      /\b(?:pickup|parking|site\s+visit|food\s+on\s+(?:site|visit)|accommodation)\b/i.test(buyerText));
  if (wantVisit && detail.visitLogistics) {
    const v = detail.visitLogistics;
    const bits: string[] = [];
    if (v.pickupMode) bits.push(`pickup: ${v.pickupMode}`);
    if (v.parkingOnSite) bits.push(`parking: ${v.parkingOnSite}`);
    if (v.foodOffered) bits.push(`food: ${v.foodOffered}`);
    if (v.accommodationOffered) bits.push(`stay: ${v.accommodationOffered}`);
    if (v.siteVisitHours) bits.push(`visit hours: ${v.siteVisitHours}`);
    if (bits.length) lines.push(bits.join('; '));
  }

  return lines;
}

/**
 * Catalog columns are typed by hand on this side and by SQLite on Desk's, and
 * the two drifted: `parking_on_site` is an INTEGER 0/1 flag, not prose. The
 * `.trim()` on that number threw inside catalogExtras, the throw was read as a
 * data failure, and the ENTIRE project file — RERA, khata, possession, media —
 * went missing on every turn of every conversation. Decoration must never be
 * able to take the file down: anything that is not a string has no text to give.
 */
function trim(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined;
  const t = s.trim();
  return t || undefined;
}

/**
 * Desk stores "is this laid on for a visit" as an INTEGER 0/1. A 1 is a promise
 * the builder made; a 0 is the column's default and says nothing — so it is
 * omitted, never spoken as a No we cannot stand behind.
 */
function offeredFlag(v: unknown, word: string): string | undefined {
  if (typeof v === 'number') return v > 0 ? word : undefined;
  if (typeof v === 'boolean') return v ? word : undefined;
  return trim(v);
}

function parseJsonStringArray(s: unknown): string[] {
  const text = trim(s);
  if (!text) return [];
  try {
    const v = JSON.parse(text) as unknown;
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    /* csv fallback */
  }
  return text
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}
