import { describe, expect, it } from 'vitest';
import { fallbackReply } from '../src/engine/compose.js';
import type { ComposeRequest, ProjectDetail } from '../src/engine/types.js';

/**
 * AB-8 — a multi-intent ask must answer the top atoms, not drop all but the first.
 * "RERA and possession?" was answering only the possession FAQ and swallowing the
 * legal (RERA) snapshot, because the single-owner guard skipped the legal chunk
 * whenever any FAQ was present. In a multi-topic ask both must render.
 */
const OASIS: ProjectDetail = {
  projectId: 'oasis',
  name: 'Brigade Oasis',
  microMarket: 'Devanahalli',
  reraNumber: 'PRM/KA/RERA/1250/303/PR/041122/005401',
  khata: 'E-Khata',
  possession: 'Ready for registration',
  projectType: 'plotted',
  faqs: [{ questionKey: 'possession', question: 'possession?', answer: 'Plots are ready for registration now.' }],
};

function multiReq(topics: string[]): ComposeRequest {
  return {
    goal: { kind: 'answer', topic: topics[0] as never, projectId: 'oasis', topics: topics as never },
    evidence: { tools: ['detail'], detail: OASIS },
    context: {
      constraints: {},
      alreadyShownSameSet: false,
      builderName: 'Naya',
      buyerText: 'RERA and possession?',
      focusProjectName: 'Brigade Oasis',
    },
  };
}

describe('AB-8 — multi-topic keeps the legal snapshot AND the other atom', () => {
  it('RERA + possession renders BOTH (legal snapshot not swallowed by the possession FAQ)', () => {
    const reply = fallbackReply(multiReq(['legal', 'availability']));
    expect(reply).toMatch(/RERA|E-Khata/i);          // legal snapshot survived
    expect(reply).toMatch(/ready for registration/i); // possession FAQ still there
  });

  it('does not double-render a legal-family FAQ against the legal snapshot', () => {
    const req = multiReq(['legal', 'price']);
    req.evidence.detail = {
      ...OASIS,
      faqs: [{ questionKey: 'rera_status', question: 'rera?', answer: 'RERA registered: PRM/KA/RERA/1250/303/PR/041122/005401.' }],
    };
    const reply = fallbackReply(req);
    // the RERA number appears once (snapshot), the legal-family FAQ was dropped
    const count = (reply.match(/PRM\/KA\/RERA/g) ?? []).length;
    expect(count).toBeLessThanOrEqual(1);
  });

  it('single-topic legal is unchanged — the FAQ still owns the answer', () => {
    const reply = fallbackReply(multiReq(['legal']));
    // single topic: possession FAQ owns it (no forced snapshot duplication)
    expect(reply).toMatch(/ready for registration/i);
  });

  it('keeps the LOAN FAQ in a multi-topic ask — only RERA/khata are the snapshot (review AB-8)', () => {
    const req = multiReq(['legal', 'availability']);
    req.context.buyerText = 'RERA and home loan eligibility?';
    req.evidence.detail = {
      ...OASIS,
      faqs: [
        { questionKey: 'rera_status', question: 'rera?', answer: 'RERA registered.' },
        { questionKey: 'loan_eligibility', question: 'loan?', answer: 'HDFC, SBI and ICICI fund this project.' },
      ],
    };
    const reply = fallbackReply(req);
    expect(reply).toMatch(/HDFC|SBI|ICICI/); // loan atom survived (not filtered out)
  });
});

/**
 * AB-8b — a co-fetched FAQ must not SHADOW the second atom the buyer explicitly
 * named. These are the I-family drops the strict grader over-credited: only one
 * atom rendered, yet it scored ANSWERED. Each case asserts BOTH atoms survive.
 */
describe('AB-8b — a co-fetched FAQ does not shadow the named structural atom', () => {
  it('I.5 — "configs and possession?" renders the CONFIGS and the possession FAQ', () => {
    const reply = fallbackReply({
      goal: { kind: 'answer', topic: 'availability' as never, projectId: 'oasis', topics: ['availability'] as never },
      evidence: {
        tools: ['detail'],
        detail: {
          ...OASIS,
          faqs: [{ questionKey: 'possession', question: 'possession?', answer: 'Plots are ready for registration now.' }],
        },
        units: [
          { unitType: '30x40 Plot', priceDisplay: '₹71 L', sizeDisplay: '1200 sqft' },
          { unitType: '40x60 Plot', priceDisplay: '₹1.55 Cr', sizeDisplay: '2400 sqft' },
        ],
      },
      context: {
        constraints: {},
        alreadyShownSameSet: false,
        builderName: 'Naya',
        buyerText: 'what configs do you have and what is the possession timeline?',
        focusProjectName: 'Brigade Oasis',
      },
    });
    expect(reply).toMatch(/30x40|40x60|configuration/i);   // configs atom (was dropped)
    expect(reply).toMatch(/ready for registration/i);      // possession FAQ atom
  });

  it('I.4 — "2 BHK price and the EMI" renders the EMI, not just the loan FAQ', () => {
    const reply = fallbackReply({
      goal: { kind: 'answer', topic: 'price' as never, projectId: 'oasis', topics: ['price', 'emi'] as never },
      evidence: {
        tools: ['detail'],
        detail: {
          ...OASIS,
          faqs: [{ questionKey: 'loan_eligibility', question: 'loan?', answer: 'Approved by SBI, HDFC and ICICI.' }],
        },
        pricing: {
          projectName: 'Brigade Oasis',
          components: [{ label: 'Base Selling Price', value: '₹9,000/sqft' }],
        },
        emi: {
          emiFormatted: '₹65,000',
          principalFormatted: '₹50 L',
          basisFormatted: '2 BHK',
          ratePercent: 8.5,
          tenureYears: 20,
        },
      },
      context: {
        constraints: {},
        alreadyShownSameSet: false,
        builderName: 'Naya',
        buyerText: 'give me the 2 bhk price and the emi',
        focusProjectName: 'Brigade Oasis',
      },
    });
    expect(reply).toMatch(/Base Selling Price|9,000/);     // price atom
    expect(reply).toMatch(/Indicative EMI|65,000/);        // EMI atom (was shadowed by the loan FAQ)
  });

  it('I.6 — "is it RERA approved and can I get a bank loan?" renders RERA AND loan (topics collapse to one legal)', () => {
    const reply = fallbackReply({
      goal: { kind: 'answer', topic: 'legal' as never, projectId: 'oasis', topics: ['legal'] as never },
      evidence: {
        tools: ['detail'],
        detail: {
          ...OASIS,
          reraNumber: 'PRM/KA/RERA/1250/303/PR/041122/005401',
          faqs: [{ questionKey: 'loan_eligibility', question: 'loan?', answer: 'Approved by SBI, HDFC and ICICI.' }],
        },
      },
      context: {
        constraints: {},
        alreadyShownSameSet: false,
        builderName: 'Naya',
        buyerText: 'is it RERA approved and can I get a bank loan?',
        focusProjectName: 'Brigade Oasis',
      },
    });
    expect(reply).toMatch(/PRM\/KA\/RERA|RERA:/);          // RERA snapshot atom (was dropped)
    expect(reply).toMatch(/SBI|HDFC|ICICI/);               // loan FAQ atom
  });

  it('I.10 — "plot sizes and the approval status?" renders the khata/RERA snapshot, not a deflection', () => {
    const reply = fallbackReply({
      goal: { kind: 'answer', topic: 'legal' as never, projectId: 'oasis', topics: ['legal', 'availability'] as never },
      evidence: {
        tools: ['detail'],
        // Detail hydrated with the title atoms (turn.ts legalSnapshotNeeded); a plot-sizes FAQ rides along.
        detail: {
          ...OASIS,
          reraNumber: 'PRM/KA/RERA/1250/303/PR/041122/005401',
          khata: 'E-Khata',
          faqs: [{ questionKey: 'plot_sizes', question: 'sizes?', answer: 'Plots are 30x40, 30x50 and 40x60.' }],
        },
        units: [{ unitType: '30x40 Plot', priceDisplay: '₹71 L', sizeDisplay: '1200 sqft' }],
      },
      context: {
        constraints: {},
        alreadyShownSameSet: false,
        builderName: 'Naya',
        buyerText: 'plot sizes and the approval status?',
        focusProjectName: 'Brigade Oasis',
      },
    });
    expect(reply).toMatch(/PRM\/KA\/RERA|E-Khata|RERA:/);  // approval atom (was "on file with our team")
    expect(reply).toMatch(/30x40|Plots are 30x40/);        // plot-sizes atom
  });

  it('negative — a PURE loan ask does not force an unasked RERA snapshot', () => {
    const reply = fallbackReply({
      goal: { kind: 'answer', topic: 'legal' as never, projectId: 'oasis', topics: ['legal'] as never },
      evidence: {
        tools: ['detail'],
        detail: {
          ...OASIS,
          reraNumber: 'PRM/KA/RERA/1250/303/PR/041122/005401',
          faqs: [{ questionKey: 'loan_eligibility', question: 'loan?', answer: 'Approved by SBI, HDFC and ICICI.' }],
        },
      },
      context: {
        constraints: {},
        alreadyShownSameSet: false,
        builderName: 'Naya',
        buyerText: 'can I get a home loan here?',
        focusProjectName: 'Brigade Oasis',
      },
    });
    expect(reply).toMatch(/SBI|HDFC|ICICI/);               // loan answer served
    expect(reply).not.toMatch(/PRM\/KA\/RERA/);            // no unasked RERA number forced in
  });
});
