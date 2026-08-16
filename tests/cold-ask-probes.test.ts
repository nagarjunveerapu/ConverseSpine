import { describe, expect, it } from 'vitest';
import { decide } from '../src/engine/phases/discover.js';
import { fallbackReply } from '../src/engine/compose.js';
import { initState } from '../src/engine/state.js';
import type { ComposeRequest, EvidenceSet, TurnGoal } from '../src/engine/types.js';

/**
 * A buyer asks a real question with nothing attached to it — no project, no
 * shortlist, no brief. "What's the RERA number?" on turn one.
 *
 * The engine could not answer that, which is correct, and then discarded the
 * question, which is not. `orient` and `probe` took no topic, so the reply to
 * "what's the RERA number?" was byte-identical to the reply to "hi" — and that
 * reply opened by reading out the `project_type` column.
 *
 * The honest shape was already built and already live: `bookLevelAnswer` says
 * where a fact lives when the book cannot state it. It sat behind
 * `opts.skipBrief` — the WhatsApp project-first channel — so advisor_web never
 * reached it. These tests pin the lift, and each one fails on the old code.
 */

const CATALOG: EvidenceSet['catalog'] = {
  total: 21,
  priceMinInr: 4_500_000,
  priceMaxInr: 95_000_000,
  // The raw `project_type` column, exactly as the adapter carries it.
  projectTypes: ['apartment', 'villa', 'managed_plantation_estate'],
  microMarkets: ['Whitefield', 'Sarjapur'],
  sample: [],
};

function reply(goal: TurnGoal, constraints = {}): string {
  const req: ComposeRequest = {
    goal,
    evidence: { tools: [], catalog: CATALOG },
    context: {
      channel: 'advisor_web',
      constraints,
      alreadyShownSameSet: false,
      builderName: 'Naya Advisor',
      priorTopics: [],
    },
  };
  return fallbackReply(req);
}

describe('a subject-less ask is probed, never dumped on', () => {
  it('orient never reads out the project_type column', () => {
    const line = reply({ kind: 'orient' });
    // The specific leak: 447 dev replies opened "apartment, villa,
    // managed_plantation_estate". Assert the shape, not just the one value —
    // any snake_case enum reaching a buyer is the same defect.
    expect(line).not.toContain('managed_plantation_estate');
    expect(line).not.toMatch(/[a-z]+_[a-z]+/);
  });

  it('orient still asks its one question', () => {
    expect(reply({ kind: 'orient' })).toMatch(/\?\s*$/);
  });

  it('a cold legal ask says where the fact lives, then asks', () => {
    const line = reply({ kind: 'orient', askedTopic: 'legal', probeSlot: 'location' });
    // Both halves, in order: the answer the book can honestly give, and the
    // one question that makes a real answer possible next turn.
    expect(line).toMatch(/registered per project/i);
    expect(line).toMatch(/which area/i);
    expect(line.indexOf('per project')).toBeLessThan(line.indexOf('Which area'));
  });

  it('the legal line does not promise every project has a RERA number', () => {
    // Four managed plantation properties sit outside RERA entirely. The older
    // copy — "Each project carries its own RERA registration" — is false on
    // them, and a bot that says it cannot be trusted on the ones it is true of.
    const line = reply({ kind: 'orient', askedTopic: 'legal', probeSlot: 'location' });
    expect(line).not.toMatch(/each project carries its own RERA/i);
  });

  it('a probe that follows a real question answers it first', () => {
    const line = reply({ kind: 'probe', slot: 'location', askedTopic: 'media' });
    expect(line).toMatch(/held per project/i);
    expect(line).toMatch(/which area/i);
  });

  it('education is answerable without a project, so it gets no "pick one" lead', () => {
    // "What is khata?" has a real answer that needs no project. Telling that
    // buyer the fact lives per project would be a dodge, and a false one.
    const line = reply({ kind: 'probe', slot: 'location', askedTopic: 'education' });
    expect(line).not.toMatch(/per project|pick one|name one/i);
  });
});

describe('the ask reaches the goal instead of dying in the router', () => {
  it('decide attaches the asked topic to orient', () => {
    const s = { ...initState('c', 'naya-advisor'), turnCount: 1 };
    const g = decide(
      s,
      { constraints: {}, askTopic: 'legal', isQuestion: true },
      'what is the rera number',
    );
    expect(g.kind).toBe('orient');
    expect(g.kind === 'orient' && g.askedTopic).toBe('legal');
  });

  it('two topics carry none — a lead would pick a winner and assert it', () => {
    const s = { ...initState('c', 'naya-advisor'), turnCount: 1 };
    const g = decide(
      s,
      { constraints: {}, askTopics: ['legal', 'price'], isQuestion: true },
      'rera and price',
    );
    expect(g.kind === 'orient' && g.askedTopic).toBeUndefined();
  });
});

describe('one probe ladder, one authority', () => {
  it('orient does not re-ask a budget the buyer already declined', () => {
    // discover.firstMissingSlot knows `asked`; compose's constraints-only copy
    // never did, so it looped back to budget forever. The authority now travels
    // on the goal.
    const base = initState('c', 'naya-advisor');
    const s = {
      ...base,
      turnCount: 2,
      // Area + size, not area alone: an area on its own is now the whole brief
      // and goes straight to a list (see "an area alone lists" below). This
      // buyer is mid-ladder, which is where the re-ask loop lived.
      constraints: { location: 'Whitefield', bhk: '3 BHK' },
      discover: { ...base.discover, asked: ['location', 'budget'] as const },
    };
    const g = decide(s, { constraints: {}, isQuestion: true, askTopic: 'legal' }, 'rera number?');
    expect(g.kind).toBe('orient');
    const slot = g.kind === 'orient' ? g.probeSlot : undefined;
    expect(slot).toBe('purpose');
    expect(reply(g, s.constraints)).toMatch(/live in, or as an investment/i);
  });
});
