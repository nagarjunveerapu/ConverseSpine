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
});
