import { describe, it, expect } from 'vitest';
import { decide } from '../src/engine/phases/discover.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';
import type { ConversationState, Extracted } from '../src/engine/types.js';

/**
 * Clarify-pick sinkhole (4q-fix3 scorecard kill #1): a facet/knowledge ask over
 * a multi-project shortlist collapsed to "Which one should I open — 1) 2) 3)?"
 * (s01 EMI, s02 cost ×3, s03 RERA-all-three, s09 khata/EC ×3). Facet asks now
 * answer across the shortlist; only a topicless "tell me more" earns the menu.
 */

const OFFERED = [
  { projectId: 'ayana', name: 'Ayana' },
  { projectId: 'krishnaja', name: 'Krishnaja Greens' },
  { projectId: 'coorg-estate', name: 'Coorg Hills Estate' },
];

function stateWithShortlist(): ConversationState {
  return {
    phase: 'discover',
    turnCount: 4,
    constraints: {},
    discover: {
      lastOffered: OFFERED.slice(),
      discussedProjects: [],
      asked: [],
      oriented: true,
      ignoredProbes: 0,
      recentMessages: [],
    },
  } as unknown as ConversationState;
}

const ex = (over: Partial<Extracted>): Extracted => ({ constraints: {}, ...over });

describe('decide — facet ask over shortlist routes to shortlist_answer', () => {
  it.each([['emi'], ['legal'], ['price'], ['availability']] as const)(
    '%s ask with no pick answers across the board',
    (topic) => {
      const g = decide(stateWithShortlist(), ex({ askTopics: [topic] }));
      expect(g).toEqual({
        kind: 'shortlist_answer',
        topic,
        projectIds: OFFERED.map((o) => o.projectId),
      });
    },
  );

  it('singular askTopic (no askTopics array) also answers across the board', () => {
    const g = decide(stateWithShortlist(), ex({ askTopic: 'emi' }));
    expect(g).toMatchObject({ kind: 'shortlist_answer', topic: 'emi' });
  });

  it('topicless want_details keeps the pick-menu', () => {
    const g = decide(stateWithShortlist(), ex({ transition: 'want_details' }));
    expect(g).toEqual({ kind: 'clarify_project_pick' });
  });

  it('media ask keeps the pick-menu (a brochure send targets one project)', () => {
    const s = stateWithShortlist();
    const g = decide(s, ex({ askTopics: ['media'] }));
    expect(g).toEqual({ kind: 'clarify_project_pick' });
  });

  it('a named pick with a facet still commits to that project (unchanged lane)', () => {
    const g = decide(stateWithShortlist(), ex({ askTopics: ['legal'], pickName: 'Ayana' }));
    expect(g).toMatchObject({ kind: 'commit', projectId: 'ayana', followUp: 'legal' });
  });

  it('constraint refine without a pick still re-searches (PIV-03 unchanged)', () => {
    const s = stateWithShortlist();
    s.constraints = { bhk: '2bhk', budgetMaxInr: 7_000_000 } as ConversationState['constraints'];
    const g = decide(s, ex({ askTopics: ['price'], speechAct: 'search' }));
    expect(g).toEqual({ kind: 'recommend' });
  });
});

function harness(convId: string) {
  const deps = fakeDeps();
  const turn = (text: string) =>
    runEngineTurn(
      { convId, builderId: 'lokations', text, buyerPhone: '+919999999994', channel: 'advisor_web' },
      deps,
    );
  return { deps, turn };
}

describe('shortlist facet answers end-to-end', () => {
  it('s01 shape: "emi will be how much" over a shortlist names every project with an EMI figure', async () => {
    const { turn } = harness('sla-emi');
    const board = await turn('plantation under 50 lakhs');
    expect(board.state.discover.lastOffered.length).toBeGreaterThanOrEqual(2);

    const r = await turn('ohh ok. emi will be how much');
    expect(r.reply).not.toMatch(/which one should i open/i);
    for (const o of board.state.discover.lastOffered) {
      expect(r.reply).toContain(o.name);
    }
    expect(r.reply).toMatch(/EMI/i);
    expect(r.reply).toMatch(/₹[\d,]+\/mo/);
  });

  it('s09 shape: khata/approvals ask answers legal per project, not a pick-menu', async () => {
    const { turn } = harness('sla-legal');
    const board = await turn('plantation under 50 lakhs');
    const r = await turn('which of these have proper khata and approvals?');
    expect(r.reply).not.toMatch(/which one should i open/i);
    for (const o of board.state.discover.lastOffered) {
      expect(r.reply).toContain(o.name);
    }
    expect(r.reply).toMatch(/RERA/);
  });

  it('s02 shape: a cost ask over the shortlist leads with per-project prices', async () => {
    const { turn } = harness('sla-price');
    const board = await turn('plantation under 50 lakhs');
    const r = await turn('what will be the approximate cost of these?');
    expect(r.reply).not.toMatch(/which one should i open/i);
    for (const o of board.state.discover.lastOffered) {
      expect(r.reply).toContain(o.name);
    }
    expect(r.reply).toMatch(/₹/);
  });

  it('a project missing the fact renders an honest "not on file", never an invented value', async () => {
    const { deps, turn } = harness('sla-missing');
    const original = deps.data.priceBasis.bind(deps.data);
    deps.data.priceBasis = async (b, nd, id, ut) =>
      id === 'ayana' ? null : original(b, nd, id, ut);
    await turn('plantation under 50 lakhs');
    const r = await turn('ohh ok. emi will be how much');
    expect(r.reply).toMatch(/\*Ayana\* — not on file yet/);
    expect(r.reply).toMatch(/₹[\d,]+\/mo/); // the others still answer
  });

  it('facet answer ends on a forward fork, and a follow-up name still picks', async () => {
    const { turn } = harness('sla-pick-after');
    await turn('plantation under 50 lakhs');
    const r = await turn('ohh ok. emi will be how much');
    expect(r.reply).toMatch(/full picture on any one|set up a visit/i);

    const picked = await turn('open ayana');
    expect(picked.state.focus?.projectName).toBe('Ayana');
  });
});
