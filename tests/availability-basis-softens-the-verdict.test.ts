/**
 * "Available" is a claim, and the bot may only put a verdict word in front of
 * a claim somebody stands behind.
 *
 * Desk's Hour Engine (wave 0, 4 Sep 2026) found 87 dev configurations saying
 * `available` with no units counted and no dated, signed statement. Desk keeps
 * the rows (hiding them would be the bigger lie) and marks each one's basis:
 *   counted     — live units tracked
 *   stated      — a person said so, dated and signed
 *   unsupported — nobody did; the owner is being asked
 * Spine reads the field off both Desk doors and, for a family whose every
 * layout is unsupported, says "listed" instead of "Yes — on file" and names
 * who has to confirm. Counted and stated rows, and rows from a Desk that does
 * not send the field, read exactly as before.
 */
import { describe, it, expect } from 'vitest';
import { summarizeUnitConfigs } from '../src/engine/compose.js';
import {
  asAvailabilityBasis,
  mapEnrichmentSummaryToUnitConfigs,
  mapLegacyUnitsToUnitConfigs,
} from '../src/engine/unit-config.js';

const claimsAFit = (s: string): boolean => /(^|[:.]\s*)yes\b/i.test(s.replace(/^For \*[^*]+\*:\s*/i, ''));

const UNSUPPORTED_2BHK = [
  { unitType: '2 BHK', priceDisplay: '₹65 L', sizeDisplay: '740 sqft', availabilityBasis: 'unsupported' as const },
  { unitType: '2 BHK Premium', priceDisplay: '₹72 L', sizeDisplay: '1043 sqft', availabilityBasis: 'unsupported' as const },
];
const COUNTED_2BHK = UNSUPPORTED_2BHK.map((u) => ({ ...u, availabilityBasis: 'counted' as const }));
const LEGACY_2BHK = UNSUPPORTED_2BHK.map(({ availabilityBasis: _drop, ...u }) => u);

describe('an unsupported "available" loses its verdict word', () => {
  it('one family, every layout unsupported: listed, and the team has to confirm', () => {
    const s = summarizeUnitConfigs(UNSUPPORTED_2BHK, 'Brigade Cornerstone');
    expect(claimsAFit(s)).toBe(false);
    expect(s).toContain('is listed');
    expect(s).toContain('confirmed');
    expect(s).toContain('740 sqft');
  });

  it('a single unsupported row is listed, not yet confirmed as open', () => {
    const s = summarizeUnitConfigs([UNSUPPORTED_2BHK[0]!]);
    expect(s).toBe('2 BHK — 740 sqft from ₹65 L — listed, not yet confirmed as open');
  });

  it('several families, all unsupported: "sizes listed", never "Yes"', () => {
    const rows = [
      ...UNSUPPORTED_2BHK,
      { unitType: '3 BHK', priceDisplay: '₹95 L', sizeDisplay: '1200 sqft', availabilityBasis: 'unsupported' as const },
    ];
    const s = summarizeUnitConfigs(rows, 'Brigade Cornerstone');
    expect(claimsAFit(s)).toBe(false);
    expect(s).toMatch(/2 sizes listed \(2 BHK, 3 BHK\)/);
    expect(s).toMatch(/Nobody has confirmed these are still open to book/);
  });

  it('a mix names only the unconfirmed family in the tail and keeps the Yes', () => {
    const rows = [
      ...COUNTED_2BHK,
      { unitType: '3 BHK', priceDisplay: '₹95 L', sizeDisplay: '1200 sqft', availabilityBasis: 'unsupported' as const },
    ];
    const s = summarizeUnitConfigs(rows);
    expect(claimsAFit(s)).toBe(true);
    expect(s).toMatch(/3 BHK not yet confirmed as open$/);
    expect(s).not.toMatch(/2 BHK not yet confirmed/);
  });
});

describe('counted rows and an older Desk read exactly as before', () => {
  it('counted: the verdict word stays', () => {
    const s = summarizeUnitConfigs(COUNTED_2BHK, 'Brigade Cornerstone');
    expect(s).toMatch(/^For \*Brigade Cornerstone\*: Yes — \*2 BHK\* is on file, in 2 layouts/);
    expect(s).toMatch(/Exact availability depends on live inventory$/);
  });

  it('no basis at all (Desk before wave 0): the verdict word stays', () => {
    expect(summarizeUnitConfigs(LEGACY_2BHK, 'Brigade Cornerstone'))
      .toBe(summarizeUnitConfigs(COUNTED_2BHK, 'Brigade Cornerstone'));
  });

  it('a family with one unsupported layout among counted ones is not softened', () => {
    const rows = [COUNTED_2BHK[0]!, UNSUPPORTED_2BHK[1]!];
    expect(claimsAFit(summarizeUnitConfigs(rows))).toBe(true);
  });
});

describe('both Desk doors carry the basis', () => {
  it('the units-enrichment summary door', () => {
    const [u] = mapEnrichmentSummaryToUnitConfigs({
      unit_types: [{
        type: '2 BHK',
        price_range: { min: 6500000000, max: 7200000000, display: '₹65 L – ₹72 L' },
        size_range: { min: 740, max: 1043, unit: 'sqft' },
        disclosure_tier: 'public',
        availability_basis: 'unsupported',
      }],
    });
    expect(u?.availabilityBasis).toBe('unsupported');
  });

  it('the /api/v1/configs door', () => {
    const [u] = mapLegacyUnitsToUnitConfigs([{
      unit_type: '3 BHK', price_display: '₹95 L', size_min_sqft: 1200, is_available: 1, availability_basis: 'counted',
    }]);
    expect(u?.availabilityBasis).toBe('counted');
  });

  it('a value Spine does not know is dropped, not carried as a string', () => {
    expect(asAvailabilityBasis('probably')).toBeUndefined();
    const [u] = mapLegacyUnitsToUnitConfigs([{ unit_type: '3 BHK', price_display: '₹95 L', availability_basis: 'probably' }]);
    expect(u).not.toHaveProperty('availabilityBasis');
  });
});
