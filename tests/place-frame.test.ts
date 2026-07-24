import { describe, expect, it } from 'vitest';
import { looksLikePlaceFramedAsk } from '../src/engine/place-frame.js';

describe('looksLikePlaceFramedAsk', () => {
  it('detects in/near place framing', () => {
    expect(looksLikePlaceFramedAsk('2 BHK in Gurgaon')).toBe(true);
    expect(looksLikePlaceFramedAsk('apartments near Whitefield')).toBe(true);
  });

  it('rejects brief comma-lead noise like Buy, 70 lakh', () => {
    expect(looksLikePlaceFramedAsk('Buy, 70 lakh, 2 BHK')).toBe(false);
  });
});
