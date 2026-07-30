import { describe, expect, it } from 'vitest';
import { answerRequirements, withAnswerRequirements } from '../src/engine/answer-contract.js';
import { detectTopics } from '../src/engine/facts.js';
import { resolveFaqQuestionKeys } from '../src/engine/faq-keys.js';

describe('P2 residual — loan / banks extract', () => {
  it('Hinglish loan + availability → legal primary', () => {
    const t = 'project pe ispe loan mil jayega? plus availability? bata dena';
    expect(detectTopics(t)[0]).toBe('legal');
    expect(detectTopics(t)).toEqual(expect.arrayContaining(['legal', 'availability']));
    expect(resolveFaqQuestionKeys(t)).toContain('banks');
    expect(answerRequirements(t)).toContain('loan_eligibility');
  });

  it('is banks available + availability → legal', () => {
    const t = 'is banks available and availability? asap';
    expect(detectTopics(t)).toEqual(expect.arrayContaining(['legal', 'availability']));
    expect(detectTopics(t)[0]).toBe('legal');
    expect(resolveFaqQuestionKeys(t)).toContain('banks');
  });

  it('can I get banks / what about loan beat price+media', () => {
    const banks = 'also, can you share the how much plus can I get banks for this please';
    expect(answerRequirements(banks)).toContain('loan_eligibility');
    expect(
      withAnswerRequirements(
        { kind: 'answer', topic: 'price', topics: detectTopics(banks), projectId: 'p1' },
        banks,
      ).topic,
    ).toBe('legal');
    const loan = 'also, what about loan and brochure? asap';
    expect(answerRequirements(loan)).toContain('loan_eligibility');
    expect(
      withAnswerRequirements(
        { kind: 'answer', topic: 'media', topics: ['media'], projectId: 'p1' },
        loan,
      ).topic,
    ).toBe('legal');
  });

  it('bare approvals? with price → loan require + legal primary', () => {
    const t = 'also, need the total cost for this project, also approvals? please';
    expect(answerRequirements(t)).toContain('loan_eligibility');
    expect(
      withAnswerRequirements(
        { kind: 'answer', topic: 'price', topics: ['price', 'legal'], projectId: 'p1' },
        t,
      ).topic,
    ).toBe('legal');
  });
  it('bare loan? with media → legal primary', () => {
    const t = 'also, loan?; also share the photos please';
    expect(answerRequirements(t)).toContain('loan_eligibility');
    expect(
      withAnswerRequirements(
        { kind: 'answer', topic: 'media', topics: ['media'], projectId: 'p1' },
        t,
      ).topic,
    ).toBe('legal');
  });
});

describe('P2 residual — resale/appreciation with price', () => {
  it('resale value + how much → appreciation require + overview kept with price', () => {
    const t = 'also, resale value? plus can I get approvals for this plus how much? i';
    expect(answerRequirements(t)).toEqual(
      expect.arrayContaining(['appreciation', 'loan_eligibility', 'price']),
    );
    // loan wins primary topic via withAnswerRequirements
    const goal = withAnswerRequirements(
      { kind: 'answer', topic: 'price', topics: ['price', 'overview'], projectId: 'p1' },
      t,
    );
    expect(goal.topic).toBe('legal');
    expect(goal.topics).toEqual(expect.arrayContaining(['legal', 'price']));
  });

  it('appreciation + total cost keeps overview in multi topics', () => {
    const t = 'also, appreciation?, also can you share the total cost please';
    expect(answerRequirements(t)).toContain('appreciation');
    expect(detectTopics(t)).toEqual(expect.arrayContaining(['price', 'overview']));
    const goal = withAnswerRequirements(
      { kind: 'answer', topic: 'price', topics: ['price'], projectId: 'p1' },
      t,
    );
    expect(goal.requires).toContain('appreciation');
    expect(goal.topics).toEqual(expect.arrayContaining(['price', 'overview']));
  });

  it('Devanagari एप्रिसिएशन fires appreciation FactKey', () => {
    const t = 'इस पर एप्रिसिएशन?, इस प्रोजेक्ट का दर बताओ';
    expect(answerRequirements(t)).toContain('appreciation');
  });

  it('bare returns? with price → rental_yield + overview kept', () => {
    const t = 'hey, returns?; also tell me the price';
    expect(answerRequirements(t)).toContain('rental_yield');
    const goal = withAnswerRequirements(
      { kind: 'answer', topic: 'price', topics: ['price'], projectId: 'p1' },
      t,
    );
    expect(goal.requires).toContain('rental_yield');
    expect(goal.topics).toEqual(expect.arrayContaining(['price', 'overview']));
  });

  it('tell me about banks beats brochure', () => {
    const t = 'tell me about banks as well as brochure??';
    expect(answerRequirements(t)).toContain('loan_eligibility');
    expect(
      withAnswerRequirements(
        { kind: 'answer', topic: 'media', topics: ['media'], projectId: 'p1' },
        t,
      ).topic,
    ).toBe('legal');
  });
});
