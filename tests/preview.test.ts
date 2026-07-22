import { describe, expect, it, vi } from 'vitest';
import { runPreview } from '../src/engine/preview.js';
import type { EngineDeps } from '../src/engine/ports.js';
import type { Constraints, SearchFilters } from '../src/engine/types.js';

/** A fake Desk search port that returns N rows and records the filters it saw. */
function fakeData(rows: number, seen: SearchFilters[] = []): Pick<EngineDeps, 'data'> {
  const matches = Array.from({ length: rows }, (_, i) => ({
    project_id: `p${i}`,
    name: `Project ${i}`,
    micro_market: 'Devanahalli',
    starting_price_inr: 6_000_000,
    starting_price_display: '₹60L',
    project_type: 'apartment',
  }));
  return {
    data: {
      search: vi.fn(async (_builder: string, filters: SearchFilters) => {
        seen.push(filters);
        return { matches };
      }),
    } as unknown as EngineDeps['data'],
  };
}

describe('runPreview', () => {
  it('returns no narrowing before any hard constraint is set', async () => {
    const deps = fakeData(9);
    const result = await runPreview(deps, 'naya-advisor', {} as Constraints);
    expect(result.narrowing).toBe(false);
    expect(result.count).toBe(0);
    expect(result.matches).toEqual([]);
    // no wasted Desk round-trip when there is nothing to search
    expect(deps.data.search).not.toHaveBeenCalled();
  });

  it('counts the catalog and returns up to 3 reveal cards once narrowing', async () => {
    const deps = fakeData(12);
    const result = await runPreview(deps, 'naya-advisor', {
      bhk: '4 BHK',
      budgetMaxInr: 6_000_000,
      location: 'Devanahalli',
    } as Constraints);
    expect(result.narrowing).toBe(true);
    expect(result.count).toBe(12);
    expect(result.capped).toBe(false);
    expect(result.matches).toHaveLength(3);
    expect(result.matches[0]).toMatchObject({ project_id: 'p0', starting_price_display: '₹60L' });
  });

  it('raises maxResults above the display cap so the count is a true count, not 3', async () => {
    const seen: SearchFilters[] = [];
    const deps = fakeData(12, seen);
    await runPreview(deps, 'naya-advisor', { budgetMaxInr: 6_000_000 } as Constraints);
    // searchFilters bakes in maxResults:3 for shortlist display; the preview
    // must override it or every count would clamp to 3.
    expect(seen[0]?.maxResults).toBeGreaterThan(3);
  });

  it('flags capped when the catalog fills the search cap (render "50+")', async () => {
    const deps = fakeData(50);
    const result = await runPreview(deps, 'naya-advisor', { location: 'Bangalore' } as Constraints);
    expect(result.count).toBe(50);
    expect(result.capped).toBe(true);
  });

  it('never throws — a Desk failure reads as "no narrowing yet"', async () => {
    const deps: Pick<EngineDeps, 'data'> = {
      data: {
        search: vi.fn(async () => {
          throw new Error('desk down');
        }),
      } as unknown as EngineDeps['data'],
    };
    const result = await runPreview(deps, 'naya-advisor', { budgetMaxInr: 5_000_000 } as Constraints);
    expect(result.count).toBe(0);
    expect(result.matches).toEqual([]);
  });
});
