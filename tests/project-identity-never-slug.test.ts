import { describe, expect, it } from 'vitest';
import { hydrateProjectDetail } from '../src/engine/project-cache.js';
import { fallbackReply } from '../src/engine/compose.js';
import type {
  ConversationState,
  EvidenceSet,
  ProjectDetail,
  TurnGoal,
} from '../src/engine/types.js';

const PID = 'brigade-eldorado-naya-advisor';

function stateWith(over: Partial<ConversationState> = {}): ConversationState {
  return {
    convId: 'c1',
    builderId: 'naya-advisor',
    phase: 'discover',
    constraints: {},
    discover: {
      asked: [],
      rejectedProjectIds: [],
      lastOffered: [
        {
          projectId: PID,
          name: 'Brigade Eldorado',
          microMarket: 'Aerospace Park / Devanahalli Corridor',
        },
      ],
      oriented: true,
      ignoredProbes: 0,
      advancedOnce: false,
    },
    turnCount: 1,
    ndConversationId: 'nd-1',
    ...over,
  } as ConversationState;
}

/** Desk's conversationContext is focus-scoped: it answers for ONE project. */
function depsWith(detailFor: string | null) {
  return {
    data: {
      projectDetail: async (_b: string, _nd: string, pid: string) =>
        pid === detailFor
          ? ({
              projectId: pid,
              name: 'Brigade Eldorado',
              microMarket: 'Aerospace Park / Devanahalli Corridor',
              summary: '50-acre integrated township.',
            } as ProjectDetail)
          : null,
      listUnits: async () => [
        { unitType: '2 BHK', priceDisplay: '₹57.5 L', priceMinInr: 5750000 },
      ],
    },
  } as never;
}

describe('a project is never named after its id', () => {
  it('uses the search result identity when Desk is focused elsewhere', async () => {
    // The exact live shape: prefetching a match while Desk's focus is another
    // project. Previously this cached { name: projectId, microMarket: '' }.
    const detail = await hydrateProjectDetail(depsWith('some-other-project'), stateWith(), PID);

    expect(detail).not.toBeNull();
    expect(detail!.name).toBe('Brigade Eldorado');
    expect(detail!.name).not.toBe(PID);
    expect(detail!.microMarket).toBe('Aerospace Park / Devanahalli Corridor');
    expect(detail!.identityOnly).toBe(true);
    expect(detail!.configurations?.length).toBe(1);
  });

  it('holds nothing rather than invent a name it has never seen', async () => {
    const blank = stateWith({
      discover: { ...stateWith().discover, lastOffered: [] },
    });
    expect(await hydrateProjectDetail(depsWith(null), blank, PID)).toBeNull();
  });

  it('re-hydrates an identity-only card once the project becomes the focus', async () => {
    const cached: ProjectDetail = {
      projectId: PID,
      name: 'Brigade Eldorado',
      microMarket: 'Aerospace Park / Devanahalli Corridor',
      identityOnly: true,
    };
    const detail = await hydrateProjectDetail(
      depsWith(PID),
      stateWith({ projectCache: { [PID]: cached } }),
      PID,
    );
    // The full record replaces the thin card — summary is back.
    expect(detail!.summary).toBe('50-acre integrated township.');
    expect(detail!.identityOnly).toBeUndefined();
  });

  it('serves a complete cached card without refetching', async () => {
    const full: ProjectDetail = {
      projectId: PID,
      name: 'Brigade Eldorado',
      microMarket: 'Aerospace Park / Devanahalli Corridor',
      summary: 'cached',
    };
    const detail = await hydrateProjectDetail(
      // projectDetail would throw if called — it must not be.
      { data: { projectDetail: () => { throw new Error('refetched'); }, listUnits: async () => [] } } as never,
      stateWith({ projectCache: { [PID]: full } }),
      PID,
    );
    expect(detail!.summary).toBe('cached');
  });
});

describe("a previous question's FAQ answer never speaks for a new ask", () => {
  const goal: Extract<TurnGoal, { kind: 'answer' }> = {
    kind: 'answer',
    topic: 'compare',
    projectId: PID,
  };
  const compare = {
    tableText: '*Side-by-side comparison*\n*Brigade Eldorado vs Brigade Cornerstone*',
    projects: [
      { project_id: 'a', name: 'Brigade Eldorado' },
      { project_id: 'b', name: 'Brigade Cornerstone' },
    ],
  } as unknown as EvidenceSet['compare'];

  it('renders the comparison, not a stale legal answer', () => {
    // Regression: the legal turn cached detail.faqs, so the compare turn
    // re-spoke "A-Khata — BBMP-approved…" verbatim. With faqs stripped at the
    // cache write, compose reaches its compare branch.
    const reply = fallbackReply({
      goal,
      evidence: {
        tools: ['compare'],
        compare,
        detail: {
          projectId: PID,
          name: 'Brigade Eldorado',
          microMarket: 'Aerospace Park / Devanahalli Corridor',
        },
      },
      context: { buyerText: 'compare both cornerstone and also eldorado' },
    } as never);

    expect(reply).toContain('Side-by-side comparison');
    expect(reply).not.toContain('A-Khata');
  });
});
