import { describe, expect, it } from 'vitest';
import {
  constraintsFromAdvisorPreferences,
  mergeAdvisorPreferences,
} from '../src/advisor/apply-preferences.js';
import type { Constraints } from '../src/engine/types.js';

describe('constraintsFromAdvisorPreferences', () => {
  it('maps full micro_market location and budget range', () => {
    const c = constraintsFromAdvisorPreferences({
      location: 'Aerospace Park / Devanahalli Corridor',
      budget: '₹40–50L',
      property_type: 'Apartment',
      bhk: '3 BHK',
      purpose: 'self_use',
    });
    expect(c.location).toBe('Aerospace Park / Devanahalli Corridor');
    expect(c.budgetMinInr).toBe(4_000_000);
    expect(c.budgetMaxInr).toBe(5_000_000);
    expect(c.propertyType).toBe('Apartment');
    expect(c.bhk).toBe('3 BHK');
    expect(c.purpose).toBe('self_use');
  });

  it('skips open to suggestions location', () => {
    const c = constraintsFromAdvisorPreferences({ location: 'Open to suggestions' });
    expect(c.location).toBeUndefined();
  });
});

describe('mergeAdvisorPreferences', () => {
  const base: Constraints = {
    location: 'Whitefield',
    bhk: '3 BHK',
    propertyType: 'Villa',
    budgetMaxInr: 10_000_000,
    purpose: 'self_use',
  };

  it('clears bhk when patch sends empty string', () => {
    const merged = mergeAdvisorPreferences(base, {
      bhk: '',
      budget: '₹1 Cr+',
      property_type: 'Villa',
    });
    expect(merged.bhk).toBeUndefined();
    expect(merged.propertyType).toBe('Villa');
    expect(merged.budgetMaxInr).toBe(10_000_000);
  });

  it('clears location for open to suggestions', () => {
    const merged = mergeAdvisorPreferences(base, { location: 'Open to suggestions' });
    expect(merged.location).toBeUndefined();
    expect(merged.bhk).toBe('3 BHK');
  });

  it('updates property type without leaving stale bhk when cleared in same patch', () => {
    const merged = mergeAdvisorPreferences(base, {
      property_type: 'Apartment',
      bhk: '',
      budget: '₹1 Cr+',
    });
    expect(merged.propertyType).toBe('Apartment');
    expect(merged.bhk).toBeUndefined();
  });
});
