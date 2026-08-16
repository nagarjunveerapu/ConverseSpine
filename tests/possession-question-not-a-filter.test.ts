/**
 * A question is not a preference, and a possession ask is not a config ask.
 *
 * Brigade Buena Vista completes in March 2027. Asked "is it ready to move in?"
 * it answered:
 *
 *   "Yes — 5 sizes on file (1 BHK, 2 BHK, 5 BHK, 3 BHK, 4 BHK)… RERA-committed
 *    possession is March 2027."
 *
 * Three faults in one message: a config list answering a timeline question, a
 * verdict word in front of it, and the true fact at the end contradicting the
 * verdict. Brigade Meadows, genuinely ready, answered the identical sentence
 * correctly — the two differed by whether a FAQ row existed, not by the question.
 *
 * Measured 16 Aug 2026 on deployed dev.
 */
import { describe, expect, it } from 'vitest';
import { fallbackReply } from '../src/engine/compose.js';
import { detectSoftPrefs } from '../src/engine/facts.js';
import { looksLikeAQuestion, resolveFaqQuestionKeys } from '../src/engine/faq-keys.js';
import type { EvidenceSet } from '../src/engine/types.js';

const NAME = 'Brigade Buena Vista';

const UNITS = [
  { unitType: '1 BHK', priceDisplay: '₹52 L', sizeDisplay: '719-758 sqft' },
  { unitType: '2 BHK', priceDisplay: '₹78 L', sizeDisplay: '1148-1205 sqft' },
  { unitType: '3 BHK', priceDisplay: '₹1.1 Cr', sizeDisplay: '1499-1670 sqft' },
];

const evidence = (): EvidenceSet =>
  ({
    tools: ['listUnits', 'faqLookup'],
    units: UNITS,
    detail: {
      name: NAME,
      microMarket: 'Whitefield',
      possession: 'March 2027',
      faqs: [
        {
          questionKey: 'possession',
          question: 'When is possession?',
          answer: 'RERA-committed possession is March 2027',
        },
      ],
    },
  }) as unknown as EvidenceSet;

const ask = (buyerText: string, topics: string[] = ['availability']): string =>
  fallbackReply({
    goal: { kind: 'answer', topic: 'availability', projectId: 'bv', topics: topics as never },
    evidence: evidence(),
    context: { focusProjectName: NAME, buyerText },
  } as never);

describe('a possession question is answered by the timeline', () => {
  it('does not answer "is it ready to move in?" with a config list', () => {
    const reply = ask('is it ready to move in?');
    expect(reply).not.toMatch(/sizes on file/i);
    expect(reply).not.toMatch(/(^|[:.]\s*)yes\b/i);
    expect(reply).toMatch(/March 2027/);
  });

  it('does not contradict itself — no verdict word in front of the true date', () => {
    const reply = ask('is it ready to move in?');
    // The old reply said "Yes" and then gave a date 19 months out. Whatever the
    // copy, a reply carrying a future possession date may not open by agreeing.
    const beforeDate = reply.slice(0, reply.indexOf('March 2027'));
    expect(beforeDate).not.toMatch(/\byes\b/i);
  });

  it('offers the configurations rather than listing them, even on a combined ask', () => {
    // There is no `configurations` FAQ key — "what configurations deliver by
    // possession?" resolves to ['possession'] alone, so the list is suppressed
    // here too. The closer is the offer, which is the same trade the
    // single-topic guard has always made. Pinned so the behaviour is a decision
    // on the record, not an accident nobody noticed.
    const reply = ask('what configurations deliver by possession?');
    expect(reply).toMatch(/March 2027/);
    expect(reply).not.toMatch(/sizes on file/i);
    expect(reply).toMatch(/configurations/i);
  });

  it('a config ask is untouched — it still gets the configs', () => {
    const reply = ask('what configurations do you have');
    expect(reply).toMatch(/BHK/);
  });
});

describe('a question is not a standing preference', () => {
  it('"is it ready to move in?" does not record a ready-to-move filter', () => {
    expect(detectSoftPrefs('is it ready to move in?').readyToMove).toBeUndefined();
    expect(detectSoftPrefs('ready to move in?').readyToMove).toBeUndefined();
  });

  it('a buyer who STATES the preference still gets it recorded', () => {
    expect(detectSoftPrefs('i want something ready to move in').readyToMove).toBe(true);
    expect(detectSoftPrefs('preferably ready').readyToMove).toBe(true);
    expect(detectSoftPrefs('looking for ready to move inventory').readyToMove).toBe(true);
  });

  it('the other soft prefs are unaffected by the question guard', () => {
    // Only readyToMove is gated — a question naming the airport is still a
    // location signal, and narrowing more than the defect requires is its own bug.
    expect(detectSoftPrefs('is it near the airport?').nearAirport).toBe(true);
  });
});

/**
 * "Move in", "shift in", "check in" ask when the project is READY — the founder's
 * reading, 16 Aug. Before this, only "ready to move in" carried a possession key.
 * "can i move in right away?" carried none, fell past the possession lane, and the
 * loose locality capture read the verb particle as a preposition of place:
 *
 *   Ayana · "can i move in next month?"
 *   → "I don't have homes in *next* — I currently cover Whitefield, Sarjapur…"
 *
 * Measured on deployed dev, 16 Aug 2026.
 */
describe('a readiness ask in move-in words is a possession ask', () => {
  it('resolves every move-in phrasing to the possession key', () => {
    for (const t of [
      'can i move in right away?',
      'can i move in next month?',
      'when can i move in',
      'how soon can i move in',
      'can i move into it now',
      'moving in this year?',
      'can i shift in next month',
      'when can we shift',
      'can i check in immediately',
    ]) {
      expect.soft(resolveFaqQuestionKeys(t), t).toContain('possession');
    }
  });

  it('does not read an ordinary "in" as a readiness ask', () => {
    // The particle only counts when it follows the verb. A preposition of place,
    // a phase, a tower — and "check in WITH you", which is scheduling, not
    // possession — must all stay out of the possession lane.
    for (const t of [
      'show me projects in whitefield',
      'what is the price in phase 2',
      'is 3 BHK available in tower B',
      'schools in the area',
      'can i check in with you next week',
    ]) {
      expect.soft(resolveFaqQuestionKeys(t), t).not.toContain('possession');
    }
  });

  it('answers "can i move in right away?" with the timeline, not the config list', () => {
    const reply = ask('can i move in right away?');
    expect(reply).toContain('March 2027');
    expect(reply).not.toMatch(/\d+\s+sizes on file/i);
  });

  it('still refuses to record a filter from the question', () => {
    for (const t of ['can i move in right away?', 'when can i move in']) {
      expect.soft(detectSoftPrefs(t).readyToMove, t).not.toBe(true);
    }
  });
});

describe('looksLikeAQuestion, now shared', () => {
  it('reads questions as questions', () => {
    for (const t of ['is it ready?', 'what is the price', 'can i move in next month']) {
      expect.soft(looksLikeAQuestion(t), t).toBe(true);
    }
  });

  it('reads statements as statements', () => {
    for (const t of ['2027 is too late for me', 'i want something ready to move in']) {
      expect.soft(looksLikeAQuestion(t), t).toBe(false);
    }
  });
});
