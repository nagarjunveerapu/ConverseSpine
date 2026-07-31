/**
 * Founder feedback — reply quality without new architecture layers.
 * CTA variation, ask-first ordering, loan lead, config summary, budget≠discount.
 */
import { describe, expect, it } from 'vitest';
import { fallbackReply, summarizeUnitConfigs } from '../src/engine/compose.js';
import {
  looksLikeBudgetConstraintTurn,
  mapIntentToRouting,
} from '../src/engine/turn-routing/embedder-map.js';
import type { TurnRoutingInput } from '../src/engine/turn-routing/types.js';
import type { EvidenceSet, TurnGoal } from '../src/engine/types.js';

const PROJECT = 'eldorado';
const NAME = 'Brigade Eldorado';

function answer(
  topic: TurnGoal extends { kind: 'answer'; topic: infer T } ? T : never,
  evidence: EvidenceSet,
  buyerText: string,
  topics?: string[],
): string {
  return fallbackReply({
    goal: {
      kind: 'answer',
      topic,
      projectId: PROJECT,
      ...(topics?.length ? { topics: topics as never } : {}),
    },
    evidence,
    context: { focusProjectName: NAME, buyerText },
  });
}

describe('CTA variation', () => {
  it('does not always end with Want anything else / site visit', () => {
    const a = answer(
      'price',
      {
        tools: ['pricing'],
        pricing: {
          projectName: NAME,
          components: [{ label: 'Starting from', value: '₹65 L' }],
        },
      },
      "what's the price?",
    );
    const b = answer(
      'location',
      {
        tools: ['detail'],
        location: { projectName: NAME, microMarket: 'North Bangalore' },
      },
      'where is it located?',
    );
    expect(a).not.toMatch(/Want anything else on \*.*\*, or a visit\?$/);
    expect(b).not.toMatch(/Want the full breakdown or a site visit\?$/);
    // Two different asks should not share an identical closer.
    const closer = (s: string) => s.split(/(?<=\.)\s+/).pop() ?? s;
    expect(closer(a)).not.toBe(closer(b));
  });
});

describe('ask-first — possession before configs', () => {
  it('leads with possession, not the overview config dump', () => {
    const reply = answer(
      'overview',
      {
        tools: ['detail'],
        detail: {
          projectId: PROJECT,
          name: NAME,
          microMarket: 'North Bangalore',
          possession: 'Dec 2027',
          configurations: [
            { unitType: '2 BHK', priceDisplay: '₹65 L', priceMinInr: 6_500_000, sizeDisplay: '740-1043 sqft' },
            { unitType: '3 BHK', priceDisplay: '₹95 L', priceMinInr: 9_500_000, sizeDisplay: '1200-1400 sqft' },
          ],
          startingPriceDisplay: '₹65 L',
        },
      },
      'when is possession?',
    );
    expect(reply.toLowerCase()).toMatch(/^possession/);
    expect(reply).toMatch(/Dec 2027|2027/);
    expect(reply.indexOf('Possession')).toBeLessThan(reply.indexOf('2 BHK') === -1 ? Infinity : reply.indexOf('2 BHK'));
  });
});

describe('loan lead — not khata first', () => {
  it('opens with loan when the buyer asks loan eligibility', () => {
    const reply = answer(
      'legal',
      {
        tools: ['faqLookup', 'detail'],
        detail: {
          projectId: PROJECT,
          name: NAME,
          microMarket: 'North Bangalore',
          khata: 'A-Khata — BBMP-approved',
          loanEligibility: 'HDFC, SBI, ICICI — LTV up to 80%',
          faqs: [
            {
              questionKey: 'banks',
              question: 'Loan?',
              answer: 'Yes. Major banks including HDFC, SBI and ICICI finance this project.',
            },
          ],
        },
      },
      'is loan eligibility available?',
    );
    expect(reply.toLowerCase()).toMatch(/^(yes\.?\s*)?major banks|yes\.|hdfc|loan/);
    expect(reply.toLowerCase().indexOf('hdfc')).toBeGreaterThanOrEqual(0);
    // Must not open on khata.
    expect(reply.trim().toLowerCase().startsWith('a-khata')).toBe(false);
  });
});

describe('config summary density', () => {
  it('summarises families before listing every row', () => {
    const summary = summarizeUnitConfigs(
      [
        { unitType: '2 BHK', priceDisplay: '₹65 L', sizeDisplay: '740-1043 sqft' },
        { unitType: '2 BHK Comfort', priceDisplay: '₹72 L', sizeDisplay: '1050-1150 sqft' },
        { unitType: '3 BHK', priceDisplay: '₹95 L', sizeDisplay: '1200-1400 sqft' },
      ],
      NAME,
    );
    expect(summary).toMatch(/2 BHK|configuration families|variants/i);
    expect(summary).toMatch(/Exact availability depends on live inventory/);
    expect(summary).not.toMatch(/^For \*.*: 2 BHK — 740/);
  });
});

describe('budget refinement ≠ discount', () => {
  const focused: TurnRoutingInput = {
    text: 'actually budget 50L',
    builder_id: 'naya-advisor',
    phase: 'focused',
    focus: { project_id: PROJECT, project_name: NAME },
    ask_topic: 'price',
    named_project_ids: [PROJECT],
  };

  it('detects budget constraint turns', () => {
    expect(looksLikeBudgetConstraintTurn('actually budget 50L')).toBe(true);
    expect(looksLikeBudgetConstraintTurn('any discount on this?')).toBe(false);
  });

  it('does not route negotiate_price to unsupported discount', () => {
    expect(mapIntentToRouting('negotiate_price', 0.9, focused, 0.68, true)).toBeNull();
  });

  it('still routes bare discount asks to unsupported', () => {
    expect(
      mapIntentToRouting(
        'negotiate_price',
        0.9,
        {
          ...focused,
          text: 'any discount on this?',
          ask_topic: undefined,
          ask_topics: undefined,
        },
        0.68,
        true,
      ),
    ).toMatchObject({ routing: 'unsupported', subject: 'discount' });
  });
});
