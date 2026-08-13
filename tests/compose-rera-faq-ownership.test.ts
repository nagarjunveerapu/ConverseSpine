/**
 * Owning the topic is not delivering the fact. Brigade's `legal_status` FAQ is
 * the khata blurb — keyed legal, silent on RERA — and it was treated as owning
 * the RERA atom, so "is Brigade Eldorado rera approved?" came back "A-Khata —
 * BBMP-approved…" while the registration number sat unspoken in evidence.
 */
import { describe, expect, it } from 'vitest';
import { fallbackReply } from '../src/engine/compose.js';
import type { ComposeRequest, ProjectDetail } from '../src/engine/types.js';

const RERA = 'PRM/KA/RERA/1251/309/PR/190722/005089';

function detail(faqAnswer: string): ProjectDetail {
  return {
    projectId: 'brigade-eldorado',
    name: 'Brigade Eldorado',
    microMarket: 'Aerospace Park / Devanahalli Corridor',
    reraNumber: RERA,
    khata: 'A-Khata',
    faqs: [{ questionKey: 'legal_status', question: 'Is it legally clear?', answer: faqAnswer }],
  };
}

function ask(d: ProjectDetail): ComposeRequest {
  return {
    goal: { kind: 'answer', topic: 'legal', projectId: 'brigade-eldorado' },
    evidence: { tools: ['detail'], detail: d },
    context: {
      constraints: {},
      alreadyShownSameSet: false,
      builderName: 'Brigade Group',
      buyerText: 'is Brigade Eldorado rera approved?',
      focusProjectName: 'Brigade Eldorado',
    },
  };
}

describe('a legal FAQ owns RERA only when it states one', () => {
  it('speaks the registration number when the FAQ does not', () => {
    const reply = fallbackReply(ask(detail('A-Khata — BBMP-approved. Legal documents on file.')));

    expect(reply).toContain(RERA);
  });

  it('leaves the FAQ to answer when it carries the number itself', () => {
    const reply = fallbackReply(
      ask(detail(`Registered under RERA ${RERA}; all approvals on file.`)),
    );

    expect(reply).toContain(RERA);
    expect(reply).not.toMatch(/Regulatory snapshot/i);
  });
});
