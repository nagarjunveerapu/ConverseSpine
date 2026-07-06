import { describe, expect, it } from 'vitest';
import { planSearchRecovery } from '../src/engine/recovery-planner.js';
import type { CatalogEnvelope, Constraints } from '../src/engine/types.js';

const catalog: CatalogEnvelope = {
  priceMinInr: 3_000_000,
  priceMaxInr: 12_000_000,
  projectTypes: ['apartment', 'managed_plantation_estate'],
  microMarkets: ['Sakleshpur', 'North Bangalore', 'Whitefield'],
  total: 8,
  sample: [],
};

describe('planSearchRecovery', () => {
  it('offers location pivot when apartment has no matches in Sakleshpur', async () => {
    const constraints: Constraints = {
      location: 'Sakleshpur',
      propertyType: 'Apartment',
      budgetMaxInr: 10_000_000,
      bhk: '3 BHK',
    };

    const counts = new Map<string, number>([
      ['Sakleshpur|Apartment', 0],
      ['Sakleshpur|Planted estate', 2],
      ['North Bangalore|Apartment', 3],
    ]);

    const recovery = await planSearchRecovery({
      constraints,
      catalog,
      reason: 'No exact match for Sakleshpur apartment',
      maxActions: 6,
      variant: 'zero_match',
      searchCount: async (filters) => {
        const key = `${filters.locations ?? ''}|${filters.projectTypes ?? 'any'}`;
        if (key.includes('managed_plantation') || key.includes('Planted')) {
          return counts.get('Sakleshpur|Planted estate') ?? 0;
        }
        if ((filters.locations ?? '').includes('North Bangalore')) {
          return counts.get('North Bangalore|Apartment') ?? 0;
        }
        return counts.get('Sakleshpur|Apartment') ?? 0;
      },
    });

    expect(recovery.mode).toBe('search_recovery');
    expect(recovery.suggested_actions.length).toBeGreaterThan(0);
    expect(recovery.suggested_actions.every((a) => a.expected_matches > 0)).toBe(true);
    const labels = recovery.suggested_actions.map((a) => a.label);
    expect(labels.some((l) => /Planted|estate|Sakleshpur|Bangalore|Open/i.test(l))).toBe(true);
  });

  it('caps actions at maxActions', async () => {
    const recovery = await planSearchRecovery({
      constraints: { location: 'Sakleshpur', propertyType: 'Apartment', budgetMaxInr: 5_000_000 },
      catalog,
      reason: 'No match',
      maxActions: 2,
      variant: 'zero_match',
      searchCount: async () => 2,
    });
    expect(recovery.suggested_actions.length).toBeLessThanOrEqual(2);
  });

  it('widen variant skips property-type pivot', async () => {
    const recovery = await planSearchRecovery({
      constraints: { location: 'Whitefield', propertyType: 'Apartment', budgetMaxInr: 7_000_000 },
      catalog,
      reason: 'Adjust search?',
      maxActions: 4,
      variant: 'widen',
      searchCount: async () => 1,
    });
    expect(recovery.mode).toBe('preference_refine');
    expect(recovery.suggested_actions.every((a) => !a.id.startsWith('relax_type:'))).toBe(true);
  });
});
