import { describe, expect, it } from 'vitest';
import {
  advisorPrefsDelta,
  advisorPrefsSnapshot,
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

  it('skips open to suggestions property type', () => {
    const c = constraintsFromAdvisorPreferences({ property_type: 'Open to suggestions' });
    expect(c.propertyType).toBeUndefined();
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

describe('advisorPrefsDelta / advisorPrefsSnapshot (recovery delta-merge)', () => {
  it('first-ever brief: everything differs from the empty snapshot', () => {
    const delta = advisorPrefsDelta(undefined, { location: 'Devanahalli', budget: 'around 60' });
    expect(delta).toEqual({ location: 'Devanahalli', budget: 'around 60' });
  });

  it('stale re-sent brief in recovery: nothing changed → empty delta', () => {
    const snap = advisorPrefsSnapshot({ location: 'Devanahalli', budget: 'around 60' });
    const delta = advisorPrefsDelta(snap, { location: 'Devanahalli', budget: 'around 60' });
    expect(Object.keys(delta)).toHaveLength(0);
  });

  it('fresh edit mid-recovery: only the edited field flows through', () => {
    const snap = advisorPrefsSnapshot({ location: 'Devanahalli', budget: 'around 60' });
    const delta = advisorPrefsDelta(snap, { location: 'Devanahalli', budget: 'up to 75' });
    expect(delta).toEqual({ budget: 'up to 75' });
  });

  it('explicit clear (value emptied) counts as a change', () => {
    const snap = advisorPrefsSnapshot({ bhk: '3 BHK', location: 'Devanahalli' });
    const delta = advisorPrefsDelta(snap, { bhk: '', location: 'Devanahalli' });
    expect(delta).toEqual({ bhk: '' });
  });

  it('whitespace-only difference is not a change', () => {
    const snap = advisorPrefsSnapshot({ budget: 'around 60' });
    const delta = advisorPrefsDelta(snap, { budget: ' around 60 ' });
    expect(Object.keys(delta)).toHaveLength(0);
  });

  it('snapshot merges over the prior snapshot (fields absent this turn survive)', () => {
    const first = advisorPrefsSnapshot({ location: 'Devanahalli', budget: 'around 60' });
    const second = advisorPrefsSnapshot({ budget: 'up to 75' }, first);
    expect(second).toEqual({ location: 'Devanahalli', budget: 'up to 75' });
  });
});
