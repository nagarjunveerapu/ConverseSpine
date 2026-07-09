import { describe, expect, it } from 'vitest';
import {
  filterUnitsByBhk,
  formatSizeDisplay,
  formatUnitConfigLine,
  mapEnrichmentSummaryToUnitConfigs,
  mapLegacyUnitsToUnitConfigs,
  resolveAvailabilityBhkFilter,
  unitTypeMatchesBhk,
} from '../src/engine/unit-config.js';

describe('unit-config mapping', () => {
  it('formats size bands', () => {
    expect(formatSizeDisplay(595, 624)).toBe('595-624 sqft');
    expect(formatSizeDisplay(1200, 1200)).toBe('1200 sqft');
    expect(formatSizeDisplay(null, 900)).toBe('900 sqft');
    expect(formatSizeDisplay(undefined, undefined)).toBeUndefined();
  });

  it('maps enrichment summary with size + price display', () => {
    const mapped = mapEnrichmentSummaryToUnitConfigs({
      unit_types: [
        {
          type: '1 BHK (Ivory)',
          price_range: { min: 410_000_000, max: 550_000_000, display: '₹41.0L—₹55.0L' },
          size_range: { min: 595, max: 624, unit: 'sqft' },
          disclosure_tier: 'public',
        },
        {
          type: 'Admin only',
          price_range: { min: 1, max: 1, display: '₹0.0L' },
          size_range: { min: 100, max: 100, unit: 'sqft' },
          disclosure_tier: 'admin_only',
        },
      ],
    });
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({
      unitType: '1 BHK (Ivory)',
      priceDisplay: '₹41.0L—₹55.0L',
      priceMinInr: 4_100_000,
      sizeDisplay: '595-624 sqft',
      sizeMinSqft: 595,
      sizeMaxSqft: 624,
    });
  });

  it('maps legacy /units rows including size (dev fallback)', () => {
    const mapped = mapLegacyUnitsToUnitConfigs([
      {
        unit_type: '2 BHK',
        price_display: '₹65L–₹80L',
        size_min_sqft: 1050,
        size_max_sqft: 1180,
        is_available: 1,
        disclosure_tier: 'public',
        price_min_paise: 650_000_000,
      },
      {
        unit_type: 'Sold out',
        price_display: '₹90L',
        size_min_sqft: 1400,
        size_max_sqft: 1400,
        is_available: 0,
        disclosure_tier: 'public',
      },
    ]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.sizeDisplay).toBe('1050-1180 sqft');
    expect(mapped[0]?.priceMinInr).toBe(6_500_000);
  });

  it('formats availability line with size', () => {
    expect(
      formatUnitConfigLine({
        unitType: '1 BHK (Ivory)',
        priceDisplay: '₹41L–₹55L',
        sizeDisplay: '595-624 sqft',
      }),
    ).toBe('1 BHK (Ivory) — 595-624 sqft from ₹41L–₹55L');
  });

  it('unitTypeMatchesBhk mirrors NayaDesk prefix rules', () => {
    expect(unitTypeMatchesBhk('2 BHK', '2 BHK Comfort')).toBe(true);
    expect(unitTypeMatchesBhk('2 BHK', '2.5 BHK')).toBe(false);
    expect(unitTypeMatchesBhk('2 BHK', '1 BHK')).toBe(false);
  });

  it('resolveAvailabilityBhkFilter prefers turn text over constraint', () => {
    expect(
      resolveAvailabilityBhkFilter({
        buyerText: 'give me 2BHK configurations',
        constraintBhk: '3 BHK',
      }),
    ).toBe('2 BHK');
    expect(resolveAvailabilityBhkFilter({ constraintBhk: '2 BHK' })).toBe('2 BHK');
    expect(resolveAvailabilityBhkFilter({ constraintBhk: '2 BHK · 3 BHK' })).toBeUndefined();
  });

  it('filterUnitsByBhk scopes evidence; falls back when no match', () => {
    const units = [
      { unitType: '1 BHK', priceDisplay: '₹31L' },
      { unitType: '2 BHK', priceDisplay: '₹57.5L' },
      { unitType: '2 BHK Comfort', priceDisplay: '₹95L' },
      { unitType: '3 BHK', priceDisplay: '₹89L' },
    ];
    const filtered = filterUnitsByBhk(units, '2 BHK');
    expect(filtered.map((u) => u.unitType)).toEqual(['2 BHK', '2 BHK Comfort']);
    expect(filterUnitsByBhk(units, undefined)).toHaveLength(4);
    expect(filterUnitsByBhk([{ unitType: 'Quarter acre', priceDisplay: '₹25L' }], '2 BHK')).toHaveLength(
      1,
    );
  });
});
