import { describe, expect, it } from 'vitest';
import { hydrateProjectDetail, prefetchProjects } from '../src/engine/project-cache.js';
import type { ConversationState, ProjectDetail } from '../src/engine/types.js';

/**
 * The prefetch runs after compose but before the awaited store.save — the
 * buyer's reply is written, and the turn is still paying for hydration.
 * Serially that cost 400–990 ms per project against Desk, so a three-match
 * recommend turn held its own save hostage for ~2.7 s. Detail+units within a
 * hydrate, and the projects within a prefetch, are independent calls.
 *
 * These tests assert overlap directly (max calls in flight), not wall-clock:
 * with serial awaits the maximum is exactly 1 whatever the timing, so this
 * file is its own differential — red on the serial code, green here.
 */

const A = 'brigade-eldorado-naya-advisor';
const B = 'brigade-cornerstone-naya-advisor';
const C = 'brigade-sanctuary-naya-advisor';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeKv(): KVNamespace {
  const kv = new Map<string, string>();
  return {
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
}

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
        { projectId: A, name: 'Brigade Eldorado', microMarket: 'Devanahalli' },
        { projectId: B, name: 'Brigade Cornerstone', microMarket: 'Whitefield' },
        { projectId: C, name: 'Brigade Sanctuary', microMarket: 'Sarjapur' },
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

/**
 * Data port that counts how many calls are in flight at once. Every call
 * holds its slot across a real timer tick, so two calls overlap if and only
 * if the second was issued before the first was awaited.
 */
function trackedDeps(opts: { absent?: string[]; unitsThrow?: string[] } = {}) {
  let inFlight = 0;
  const track = { maxInFlight: 0, detailCalls: [] as string[], unitCalls: [] as string[] };
  const hold = async () => {
    inFlight += 1;
    track.maxInFlight = Math.max(track.maxInFlight, inFlight);
    await sleep(20);
    inFlight -= 1;
  };
  const deps = {
    turnCache: fakeKv(),
    data: {
      projectDetail: async (_b: string, _nd: string, pid: string) => {
        track.detailCalls.push(pid);
        await hold();
        if (opts.absent?.includes(pid)) {
          return { ok: false as const, reason: 'absent' as const, latency_ms: 20 };
        }
        return {
          ok: true as const,
          latency_ms: 20,
          value: {
            projectId: pid,
            name: `Name of ${pid}`,
            microMarket: 'Devanahalli',
            summary: `Summary of ${pid}.`,
            filesFetched: true,
          } as ProjectDetail,
        };
      },
      listUnits: async (pid: string) => {
        track.unitCalls.push(pid);
        await hold();
        if (opts.unitsThrow?.includes(pid)) throw new Error('units down');
        return [{ unitType: '2 BHK', priceDisplay: '₹57.5 L', priceMinInr: 5750000 }];
      },
    },
  } as never;
  return { deps, track };
}

describe('hydration is paid once, not in single file', () => {
  it('detail and units are fetched together within one hydrate', async () => {
    const { deps, track } = trackedDeps();
    const { detail } = await hydrateProjectDetail(deps, stateWith(), A);

    // Serial awaits make 1 the ceiling; the calls are independent, so 2.
    expect(track.maxInFlight).toBe(2);
    // The merged card is unchanged by the overlap.
    expect(detail!.summary).toBe(`Summary of ${A}.`);
    expect(detail!.configurations).toEqual([
      { unitType: '2 BHK', priceDisplay: '₹57.5 L', priceMinInr: 5750000 },
    ]);
  });

  it('three matches hydrate concurrently and land the same cards', async () => {
    const { deps, track } = trackedDeps();
    const out = await prefetchProjects(deps, stateWith(), [A, B, C]);

    // 3 hydrates × 2 calls all in flight together; ≥4 proves cross-project
    // overlap even under scheduler slop (observed: 6).
    expect(track.maxInFlight).toBeGreaterThanOrEqual(4);
    for (const pid of [A, B, C]) {
      expect(out.projectCache?.[pid]?.name).toBe(`Name of ${pid}`);
      expect(out.projectCache?.[pid]?.summary).toBe(`Summary of ${pid}.`);
      expect(out.projectCache?.[pid]?.configurations?.length).toBe(1);
    }
    expect(track.detailCalls.slice().sort()).toEqual([A, B, C].sort());
  });

  it('a duplicate match id costs one fetch, not two racing ones', async () => {
    const { deps, track } = trackedDeps();
    await prefetchProjects(deps, stateWith(), [A, A, B]);
    expect(track.detailCalls.filter((p) => p === A)).toHaveLength(1);
  });

  it('one project failing leaves the other two cached', async () => {
    const { deps } = trackedDeps({ absent: [B], unitsThrow: [B] });
    const out = await prefetchProjects(deps, stateWith(), [A, B, C]);

    expect(out.projectCache?.[A]?.summary).toBe(`Summary of ${A}.`);
    expect(out.projectCache?.[C]?.summary).toBe(`Summary of ${C}.`);
    // B had no detail and no units — nothing invented for it.
    expect(out.projectCache?.[B]).toBeUndefined();
  });

  it('an already-usable card is not refetched by the parallel path', async () => {
    const { deps, track } = trackedDeps();
    const cached: ProjectDetail = {
      projectId: A,
      name: 'Brigade Eldorado',
      microMarket: 'Devanahalli',
      summary: 'cached',
      filesFetched: true,
    };
    await prefetchProjects(deps, stateWith({ projectCache: { [A]: cached } }), [A, B]);
    expect(track.detailCalls).toEqual([B]);
  });
});
