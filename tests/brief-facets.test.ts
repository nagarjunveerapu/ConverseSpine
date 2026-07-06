import { describe, expect, it } from 'vitest';
import { briefPropertyTypeLabel, normalizeBhkLabel, normalizePlotSizeLabel } from '../src/advisor/brief-facets.js';
import { extractConfigurationFilters, extractFactsSync } from '../src/engine/facts.js';
import { mapProjectTypesForSearch, searchFilters } from '../src/engine/phases/discover.js';
import { initState } from '../src/engine/state.js';

describe('brief facets normalization', () => {
  it('normalizes unit types to BHK chips', () => {
    expect(normalizeBhkLabel('2 BHK')).toBe('2 BHK');
    expect(normalizeBhkLabel('3bhk')).toBe('3 BHK');
    expect(normalizeBhkLabel('4 BHK')).toBe('4+ BHK');
    expect(normalizeBhkLabel('5 BHK')).toBe('4+ BHK');
    expect(normalizeBhkLabel('Studio')).toBeNull();
  });

  it('maps project_type slugs to brief property labels', () => {
    expect(briefPropertyTypeLabel('apartment')).toBe('Apartment');
    expect(briefPropertyTypeLabel('managed_plantation_estate')).toBe('Planted estate');
    expect(briefPropertyTypeLabel('plotted')).toBe('Plot / land');
    expect(briefPropertyTypeLabel('managed_villa_resort')).toBe('Villa');
  });

  it('normalizes plot and estate unit labels', () => {
    expect(normalizePlotSizeLabel('1200 sqft plot')).toBe('1200 sqft plot');
    expect(normalizePlotSizeLabel('Quarter acre')).toBe('Quarter acre');
    expect(normalizePlotSizeLabel('2 BHK')).toBeNull();
  });
});

describe('brief constraint parsing', () => {
  it('extracts multiple property types and BHK configs from advisor brief', () => {
    const text =
      'self-use home, budget ₹70L–1 Cr, looking for Villa or Apartment, 2 BHK or 3 BHK, in Whitefield';
    const ex = extractFactsSync(text, initState('t', 'naya-advisor'));
    expect(ex.constraints.propertyType).toBe('villa,apartment');
    expect(ex.constraints.bhk).toBe('2 BHK,3 BHK');
  });

  it('maps UI property labels to NayaDesk slugs for search', () => {
    expect(mapProjectTypesForSearch('Villa or Apartment')).toBe(
      'villa,managed_villa_resort,apartment',
    );
    expect(mapProjectTypesForSearch('Planted estate')).toBe('managed_plantation_estate');
  });

  it('keeps strict project type filters in search', () => {
    const filters = searchFilters({
      propertyType: 'villa,apartment',
      bhk: '2 BHK',
      budgetMaxInr: 10_000_000,
    });
    expect(filters.projectTypes).toBe('villa,managed_villa_resort,apartment');
    expect(filters.bhks).toBe('2 BHK');
  });
});
