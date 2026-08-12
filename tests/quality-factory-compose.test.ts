import { describe, expect, it } from 'vitest';
import {
  briefAckPrefix,
  firstMissingProbeSlot,
  priceAnswerHeader,
} from '../src/engine/compose.js';

describe('quality-factory compose helpers', () => {
  it('briefAckPrefix lists landed slots', () => {
    expect(
      briefAckPrefix({
        propertyType: 'apartment',
        location: 'Whitefield',
        budgetMaxInr: 15_000_000,
      }),
    ).toMatch(/Got it — apartment, Whitefield/);
  });

  it('firstMissingProbeSlot asks location then budget then bhk', () => {
    expect(firstMissingProbeSlot({ propertyType: 'apartment' })).toBe('location');
    expect(firstMissingProbeSlot({ location: 'Whitefield' })).toBe('budget');
    expect(
      firstMissingProbeSlot({ location: 'Whitefield', budgetMaxInr: 10_000_000 }),
    ).toBe('bhk');
    expect(
      firstMissingProbeSlot({
        location: 'Coorg',
        budgetMaxInr: 5_000_000,
        purpose: 'investment',
      }),
    ).toBeUndefined();
  });

  it('priceAnswerHeader distinguishes unit price vs charges-only', () => {
    expect(
      priceAnswerHeader('Earth Aroma', [{ label: 'Stamp Duty' }, { label: 'Registration Charges' }], ''),
    ).toBe('Charges on file — Earth Aroma');
    expect(
      priceAnswerHeader('Eldorado', [{ label: 'Base Selling Price' }], '₹57.5 L'),
    ).toBe('Pricing — Eldorado');
  });
});
