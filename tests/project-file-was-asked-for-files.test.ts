import { describe, expect, it } from 'vitest';
import { hydrateProjectDetail, isUsableProjectCard } from '../src/engine/project-cache.js';
import type { ThreadState, ProjectDetail } from '../src/engine/types.js';

/**
 * The founder picked Brigade Eldorado on their own phone and walked the whole
 * file — Trust, the unit, back, Trust again — and asked:
 *
 *   "I couldn't find any where the brochure or anyting sort of media
 *    that i can download in the list?"
 *
 * Desk held sixteen public documents for that project, three of them
 * brochures. The console draws its shelf only when the record carries files,
 * and the record it was handed carried none — not because Eldorado has none,
 * but because nothing had ever asked. A card built by an older build sat in L2
 * with configurations, a RERA number and a location; every usability check
 * passed it; so `hydrateProjectDetail` returned it and the one fetch that
 * carries media never ran. For six hours, on that project, the shelf could not
 * exist.
 *
 * The distinction the cache could not draw is between an empty shelf and an
 * unasked question. `filesFetched` draws it, and nothing else can: an empty
 * `mediaAssets` means both things at once.
 */
const PID = 'brigade-eldorado';

function stateWith(over: Partial<ThreadState> = {}): ThreadState {
  return {
    threadId: 'c1',
    builderId: 'brigade-group',
    phase: 'discover',
    constraints: {},
    discover: {
      asked: [],
      rejectedProjectIds: [],
      lastOffered: [{ projectId: PID, name: 'Brigade Eldorado', microMarket: 'Devanahalli' }],
      oriented: true,
      ignoredProbes: 0,
      advancedOnce: false,
    },
    turnCount: 1,
    ndThreadId: 'nd-1',
    ...over,
  } as ThreadState;
}

/** Exactly the card the founder's conversation was served. */
const looksComplete: ProjectDetail = {
  projectId: PID,
  name: 'Brigade Eldorado',
  microMarket: 'Aerospace Park / Devanahalli Corridor',
  reraNumber: 'PRM/KA/RERA/1251/309/PR/190722/005089',
  startingPriceDisplay: '₹57.5 L',
  location: { microMarket: 'Aerospace Park / Devanahalli Corridor' },
  configurations: [{ unitType: '2 BHK', priceDisplay: '₹57.5 L', priceMinInr: 5750000 }],
};

describe('a card that was never asked for its files is not the project file', () => {
  it('refuses the card that looked complete and hid sixteen documents', () => {
    expect(isUsableProjectCard(looksComplete)).toBe(false);
    expect(isUsableProjectCard({ ...looksComplete, filesFetched: true })).toBe(true);
  });

  it('an empty shelf is an answer — a project with no documents still caches', () => {
    // The whole point of the flag: absence of files must not be confused with
    // absence of the question, or every fileless project re-fetches forever.
    expect(isUsableProjectCard({ ...looksComplete, filesFetched: true, mediaAssets: [] })).toBe(
      true,
    );
  });

  it('re-fetches rather than serving it, and the fetch is what carries the files', async () => {
    let fetched = 0;
    const withFiles: ProjectDetail = {
      ...looksComplete,
      filesFetched: true,
      mediaKinds: ['brochure', 'floor_plan'],
      mediaAssets: [{ assetId: 'a1', kind: 'brochure', title: 'Brigade Eldorado — Brochure' }],
    };
    const deps = {
      data: {
        projectDetail: async () => {
          fetched += 1;
          return { ok: true as const, value: withFiles, latency_ms: 1 };
        },
        listUnits: async () => [],
      },
    };

    const { detail } = await hydrateProjectDetail(
      deps as never,
      stateWith({ projectCache: { [PID]: looksComplete } }),
      PID,
    );

    expect(fetched).toBe(1);
    expect(detail?.mediaAssets?.length).toBe(1);
    expect(detail?.filesFetched).toBe(true);
  });

  it('serves the healed card without a second fetch', async () => {
    const deps = {
      data: {
        projectDetail: () => {
          throw new Error('refetched a card that had already asked for its files');
        },
        listUnits: async () => [],
      },
    };
    const healed: ProjectDetail = { ...looksComplete, filesFetched: true, summary: 'cached' };
    const { detail } = await hydrateProjectDetail(
      deps as never,
      stateWith({ projectCache: { [PID]: healed } }),
      PID,
    );
    expect(detail?.summary).toBe('cached');
  });
});
