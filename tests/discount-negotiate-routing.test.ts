import { describe, expect, it } from 'vitest';
import { looksLikeDiscountNegotiateAsk } from '../src/engine/turn-routing/embedder-map.js';

describe('looksLikeDiscountNegotiateAsk', () => {
  it('matches tight-budget discount ask', () => {
    expect(looksLikeDiscountNegotiateAsk('my budget is tight — any discount?')).toBe(true);
    expect(looksLikeDiscountNegotiateAsk('any discount?')).toBe(true);
    expect(looksLikeDiscountNegotiateAsk('best price on this?')).toBe(true);
  });

  it('does not steal plain budget refine without discount words', () => {
    expect(looksLikeDiscountNegotiateAsk('actually budget under 50 lakh')).toBe(false);
    expect(looksLikeDiscountNegotiateAsk('pricing?')).toBe(false);
  });
});
