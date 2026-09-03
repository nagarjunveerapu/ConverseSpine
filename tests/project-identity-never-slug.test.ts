import { describe, expect, it } from 'vitest';
import {
  hydrateProjectDetail,
  promoteDurableProjectDetail,
  seedProjectCacheFromL2,
  writeProjectCardFromDetail,
} from '../src/engine/project-cache.js';
import { getProjectCard, putProjectCard } from '../src/cache/turn-cache.js';
import { fallbackReply } from '../src/engine/compose.js';
import type {
  ThreadState,
  EvidenceSet,
  ProjectDetail,
  TurnGoal,
} from '../src/engine/types.js';

const PID = 'brigade-eldorado-naya-advisor';

function stateWith(over: Partial<ThreadState> = {}): ThreadState {
  return {
    threadId: 'c1',
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
    ndThreadId: 'nd-1',
    ...over,
  } as ThreadState;
}

/** Desk's threadContext is focus-scoped: it answers for ONE project. */
function depsWith(detailFor: string | null) {
  return {
    data: {
      projectDetail: async (_b: string, _nd: string, pid: string) =>
        pid === detailFor
          ? {
              ok: true as const,
              latency_ms: 1,
              value: {
                projectId: pid,
                name: 'Brigade Eldorado',
                microMarket: 'Aerospace Park / Devanahalli Corridor',
                summary: '50-acre integrated township.',
              } as ProjectDetail,
            }
          : { ok: false as const, reason: 'absent' as const, latency_ms: 1 },
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
    const { detail } = await hydrateProjectDetail(depsWith('some-other-project'), stateWith(), PID);

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
    expect((await hydrateProjectDetail(depsWith(null), blank, PID)).detail).toBeNull();
  });

  it('re-hydrates an identity-only card once the project becomes the focus', async () => {
    const cached: ProjectDetail = {
      projectId: PID,
      name: 'Brigade Eldorado',
      microMarket: 'Aerospace Park / Devanahalli Corridor',
      identityOnly: true,
    };
    const { detail } = await hydrateProjectDetail(
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
      // Complete now includes having been asked what documents exist — a card
      // that never was is re-fetched, however much else it carries.
      filesFetched: true,
    };
    const { detail } = await hydrateProjectDetail(
      // projectDetail would throw if called — it must not be.
      { data: { projectDetail: () => { throw new Error('refetched'); }, listUnits: async () => [] } } as never,
      stateWith({ projectCache: { [PID]: full } }),
      PID,
    );
    expect(detail!.summary).toBe('cached');
  });

  it('promotes enriched identity-only shells so L2 can learn them', () => {
    const thin: ProjectDetail = {
      projectId: PID,
      name: 'Brigade Eldorado',
      microMarket: '',
      identityOnly: true,
      configurations: [{ unitType: '2 BHK', priceDisplay: '₹57.5 L', priceMinInr: 5750000 }],
      reraNumber: 'PRM/KA/RERA/1251/309/PR/190722/005089',
    };
    const promoted = promoteDurableProjectDetail(thin);
    expect(promoted.identityOnly).toBeUndefined();
    expect(promoted.reraNumber).toContain('RERA');
  });

  it('seeds L2 over a poisoned identity-only projectCache entry', async () => {
    const kv = new Map<string, string>();
    const fakeKv = {
      get: async (key: string, type?: string) => {
        const raw = kv.get(key);
        if (raw == null) return null;
        return type === 'json' ? JSON.parse(raw) : raw;
      },
      put: async (key: string, value: string) => {
        kv.set(key, value);
      },
      delete: async (key: string) => {
        kv.delete(key);
      },
    } as unknown as KVNamespace;

    await putProjectCard(fakeKv, PID, 'etag-1', {
      projectId: PID,
      name: 'Brigade Eldorado',
      microMarket: 'Devanahalli',
      summary: 'from L2',
      filesFetched: true,
    });

    const poisoned = stateWith({
      focus: { projectId: PID, projectName: 'Brigade Eldorado' },
      projectCache: {
        [PID]: {
          projectId: PID,
          name: 'Brigade Eldorado',
          microMarket: '',
          identityOnly: true,
          configurations: [{ unitType: '2 BHK', priceDisplay: '₹57.5 L', priceMinInr: 5750000 }],
        },
      },
    });

    const seeded = await seedProjectCacheFromL2({ turnCache: fakeKv } as never, poisoned);
    expect(seeded.projectCache?.[PID]?.summary).toBe('from L2');
    expect(seeded.projectCache?.[PID]?.identityOnly).toBeUndefined();
    expect((await getProjectCard(fakeKv, PID))?.detail.summary).toBe('from L2');
  });

  it('a promoted shell is not taught to L2 — it was never asked for its files', async () => {
    const kv = new Map<string, string>();
    const fakeKv = {
      get: async (key: string, type?: string) => {
        const raw = kv.get(key);
        if (raw == null) return null;
        return type === 'json' ? JSON.parse(raw) : raw;
      },
      put: async (key: string, value: string) => {
        kv.set(key, value);
      },
      delete: async (key: string) => {
        kv.delete(key);
      },
    } as unknown as KVNamespace;

    await writeProjectCardFromDetail({ turnCache: fakeKv, projectCardMemo: new Map() } as never, PID, {
      projectId: PID,
      name: 'Brigade Eldorado',
      microMarket: '',
      identityOnly: true,
      configurations: [{ unitType: '2 BHK', priceDisplay: '₹57.5 L', priceMinInr: 5750000 }],
      reraNumber: 'PRM/KA/RERA/x',
    });

    // This shell is Eldorado's: configs, a RERA number, and no idea whether the
    // project has documents. Teaching it to L2 is what served a project file
    // with its sixteen files invisible for six hours. Refusing costs one fetch
    // on the next turn; it does NOT restore the original block, because that
    // came from a poisoned entry being served, not from an absent one.
    expect(await getProjectCard(fakeKv, PID)).toBeNull();

    // Asked and answered — that card is worth keeping, even if the answer was
    // that the project has nothing to send.
    await writeProjectCardFromDetail({ turnCache: fakeKv, projectCardMemo: new Map() } as never, PID, {
      projectId: PID,
      name: 'Brigade Eldorado',
      microMarket: '',
      identityOnly: true,
      configurations: [{ unitType: '2 BHK', priceDisplay: '₹57.5 L', priceMinInr: 5750000 }],
      reraNumber: 'PRM/KA/RERA/x',
      filesFetched: true,
    });
    const card = await getProjectCard(fakeKv, PID);
    expect(card?.detail.identityOnly).toBeUndefined();
    expect(card?.detail.reraNumber).toBe('PRM/KA/RERA/x');
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
