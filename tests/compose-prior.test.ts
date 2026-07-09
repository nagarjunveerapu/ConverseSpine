import { describe, expect, it } from 'vitest';
import {
  extractDisclosedFacts,
  hasDisclosedRera,
  mergeDisclosedFacts,
} from '../src/engine/disclosed-facts.js';
import { fallbackReply, renderComposePrompt } from '../src/engine/compose.js';
import type { ComposeRequest, ProjectDetail } from '../src/engine/types.js';

const ayana: ProjectDetail = {
  projectId: 'ayana',
  name: 'Ayana',
  microMarket: 'Sakleshpur',
  reraNumber: 'PRM/KA/RERA/1251/446/2024',
  ecStatus: 'Clear',
  loanEligibility: 'HDFC, SBI, ICICI, Axis — subject to buyer credit.',
  possession: 'Dec 2027',
};

describe('extractDisclosedFacts', () => {
  it('records legal RERA/loan from answer evidence', () => {
    const facts = extractDisclosedFacts({
      goal: { kind: 'answer', topic: 'legal', projectId: 'ayana' },
      evidence: { tools: ['detail'], detail: ayana },
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]!.kind).toBe('legal');
    expect(facts[0]!.statement).toMatch(/RERA/i);
    expect(hasDisclosedRera(facts, 'ayana')).toBe(true);
  });
});

describe('compose P2c — prior + skip RERA', () => {
  const priorLegal = extractDisclosedFacts({
    goal: { kind: 'answer', topic: 'legal', projectId: 'ayana' },
    evidence: { tools: ['detail'], detail: ayana },
  });

  it('banks follow-up uses loan facet, not full RERA dump', () => {
    const req: ComposeRequest = {
      goal: { kind: 'answer', topic: 'legal', projectId: 'ayana' },
      evidence: { tools: ['detail'], detail: ayana },
      context: {
        constraints: {},
        alreadyShownSameSet: false,
        builderName: 'Lokations',
        buyerText: 'what banks approved?',
        focusProjectName: 'Ayana',
        priorTopics: ['legal'],
        disclosedFacts: priorLegal,
      },
    };
    const reply = fallbackReply(req);
    expect(reply).toMatch(/home loan|HDFC|SBI/i);
    expect(reply).not.toMatch(/RERA:/);
    expect(reply).not.toMatch(/from 25-50L/i);
  });

  it('renderComposePrompt includes PRIOR CONTEXT and skip-RERA rule', () => {
    const prompt = renderComposePrompt({
      goal: { kind: 'answer', topic: 'legal', projectId: 'ayana' },
      evidence: { tools: ['detail'], detail: ayana },
      context: {
        constraints: {},
        alreadyShownSameSet: false,
        builderName: 'Lokations',
        buyerText: 'what banks approved?',
        priorTopics: ['legal'],
        priorReplyExcerpt: 'Regulatory snapshot for Ayana…',
        disclosedFacts: priorLegal,
      },
    });
    expect(prompt).toContain('PRIOR CONTEXT');
    expect(prompt).toContain('Already disclosed');
    expect(prompt).toMatch(/RERA was already shared/i);
  });
});

describe('mergeDisclosedFacts', () => {
  it('dedupes by statement', () => {
    const a = [{ kind: 'legal' as const, project_id: 'ayana', statement: 'RERA: X', source_tool: 'detail' }];
    const b = [
      { kind: 'legal' as const, project_id: 'ayana', statement: 'RERA: X', source_tool: 'detail' },
      { kind: 'price' as const, project_id: 'ayana', statement: 'from 25L', source_tool: 'pricing' },
    ];
    expect(mergeDisclosedFacts(a, b)).toHaveLength(2);
  });
});
