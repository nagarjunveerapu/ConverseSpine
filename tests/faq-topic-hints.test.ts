/**
 * P1 — availability/price must not fan out topic-hint FAQs (possession essay
 * on a config ask) unless the buyer text binds a FAQ key.
 */
import { describe, expect, it } from 'vitest';
import { resolveFaqQuestionKeys } from '../src/engine/faq-keys.js';

describe('resolveFaqQuestionKeys — topic hints vs text bind', () => {
  it('availability topic alone hints possession (legacy fan-out)', () => {
    expect(resolveFaqQuestionKeys('', ['availability'])).toEqual(
      expect.arrayContaining(['possession']),
    );
  });

  it('config ask text does not bind possession by itself', () => {
    expect(resolveFaqQuestionKeys('give me 2BHK configurations')).toEqual([]);
    expect(resolveFaqQuestionKeys('2 BHK configs')).toEqual([]);
  });

  it('payment plan / possession text binds without needing topic hints', () => {
    expect(resolveFaqQuestionKeys('what is the payment plan?')).toContain('payment_plan');
    expect(resolveFaqQuestionKeys('when is possession?')).toContain('possession');
  });
});
