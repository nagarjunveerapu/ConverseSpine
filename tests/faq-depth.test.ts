import { describe, expect, it } from 'vitest';
import { isFaqShapedAsk, resolveFaqQuestionKeys } from '../src/engine/faq-keys.js';
import { fallbackReply, renderComposePrompt } from '../src/engine/compose.js';
import type { ComposeRequest } from '../src/engine/types.js';

describe('resolveFaqQuestionKeys', () => {
  it('maps rental yield asks to rental_yield', () => {
    expect(resolveFaqQuestionKeys('what is the rental yield?')).toEqual(['rental_yield']);
    expect(resolveFaqQuestionKeys('ROI on this villa?')).toContain('rental_yield');
    expect(isFaqShapedAsk('what is the rental yield on this?')).toBe(true);
  });

  it('maps possession / payment / amenities', () => {
    expect(resolveFaqQuestionKeys('when is possession?')).toContain('possession');
    expect(resolveFaqQuestionKeys('payment plan?')).toContain('payment_plan');
    expect(resolveFaqQuestionKeys('what amenities?')).toContain('amenities');
  });

  it('falls back to topic hints when text is bare amenity chip', () => {
    expect(resolveFaqQuestionKeys('', ['amenities'])).toContain('amenities');
  });
});

describe('compose FAQ-first answer', () => {
  const baseCtx: ComposeRequest['context'] = {
    builderName: 'Brigade',
    constraints: {},
    focusProjectName: 'Brigade Eldorado',
  };

  it('fallback prefers FAQ answer over overview dump', () => {
    const reply = fallbackReply({
      goal: { kind: 'answer', topic: 'overview', projectId: 'brigade-eldorado' },
      evidence: {
        tools: ['faqLookup'],
        detail: {
          projectId: 'brigade-eldorado',
          name: 'Brigade Eldorado',
          microMarket: 'Devanahalli',
          startingPriceDisplay: '₹57L',
          possession: '2028',
          faqs: [
            {
              questionKey: 'rental_yield',
              question: 'What rental yield can I expect?',
              answer: 'Estimated 3–4% net rental yield — estimate only, not a guarantee.',
            },
          ],
        },
      },
      context: baseCtx,
    });
    expect(reply.toLowerCase()).toMatch(/rental yield|3/);
    expect(reply.toLowerCase()).not.toMatch(/want pricing, legal details/);
  });

  it('compose prompt instructs FAQ-first when faqs present', () => {
    const prompt = renderComposePrompt({
      goal: { kind: 'answer', topic: 'overview', projectId: 'brigade-eldorado' },
      evidence: {
        tools: ['faqLookup'],
        detail: {
          projectId: 'brigade-eldorado',
          name: 'Brigade Eldorado',
          microMarket: 'Devanahalli',
          faqs: [
            {
              questionKey: 'rental_yield',
              question: 'What rental yield?',
              answer: 'About 3% net.',
            },
          ],
        },
      },
      context: baseCtx,
    });
    expect(prompt).toMatch(/faqs \(use these/i);
    expect(prompt).toMatch(/specific FAQ/i);
  });
});
