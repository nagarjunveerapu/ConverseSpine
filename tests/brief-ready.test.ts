import { describe, expect, it } from 'vitest';
import { decide, hasNarrowingConstraint, isBriefReady, mergeConstraints } from '../src/engine/phases/discover.js';
import { initState } from '../src/engine/state.js';
import type { Extracted } from '../src/engine/types.js';

function ex(partial: Partial<Extracted> = {}): Extracted {
  return { constraints: {}, ...partial };
}

describe('isBriefReady', () => {
  it('propertyType alone is not ready', () => {
    expect(isBriefReady({ propertyType: 'apartment' })).toBe(false);
    expect(hasNarrowingConstraint({ propertyType: 'apartment' })).toBe(true);
  });

  it('bhk alone is not ready', () => {
    expect(isBriefReady({ bhk: '2 BHK' })).toBe(false);
  });

  it('location + budget + bhk is ready', () => {
    expect(
      isBriefReady({
        location: 'Whitefield',
        budgetMaxInr: 15_000_000,
        bhk: '2 BHK',
      }),
    ).toBe(true);
  });

  it('investment skips bhk', () => {
    expect(
      isBriefReady({
        location: 'Coorg',
        budgetMaxInr: 5_000_000,
        purpose: 'investment',
      }),
    ).toBe(true);
  });

  it('plantation type alone is ready (no BHK ladder)', () => {
    expect(isBriefReady({ propertyType: 'plantation' })).toBe(true);
    expect(isBriefReady({ propertyType: 'villa' })).toBe(true);
  });

  it('plantation location without type or budget is not ready', () => {
    expect(isBriefReady({ location: 'Sakleshpur' })).toBe(false);
  });

  it('plantation / villa with location + budget skip bhk', () => {
    expect(
      isBriefReady({
        location: 'Sakleshpur',
        budgetMaxInr: 5_000_000,
        propertyType: 'plantation',
      }),
    ).toBe(true);
  });

  it('apartment still requires bhk', () => {
    expect(
      isBriefReady({
        location: 'Whitefield',
        budgetMaxInr: 15_000_000,
        propertyType: 'apartment',
      }),
    ).toBe(false);
  });

  it('asked bhk waives size for apartment recovery', () => {
    expect(
      isBriefReady(
        {
          location: 'Coorg',
          budgetMaxInr: 10_000_000,
          propertyType: 'Apartment',
        },
        { asked: ['bhk'] },
      ),
    ).toBe(true);
  });

  it('mergeConstraints unions extract onto state', () => {
    expect(
      isBriefReady(
        mergeConstraints(
          { location: 'Whitefield', propertyType: 'apartment' },
          { budgetMaxInr: 10_000_000, bhk: '3 BHK' },
        ),
      ),
    ).toBe(true);
  });
});

describe('discover.decide brief-ready gate', () => {
  it('bare apartment → probe location, not recommend', () => {
    const s = {
      ...initState('c1', 'brigade-group'),
      turnCount: 1,
      discover: { ...initState('c1', 'brigade-group').discover, oriented: true },
      constraints: { propertyType: 'apartment' },
    };
    expect(decide(s, ex({ constraints: { propertyType: 'apartment' } }))).toMatchObject({
      kind: 'probe',
      slot: 'location',
    });
  });

  it('bare 2 BHK → probe location, not recommend', () => {
    const s = {
      ...initState('c1', 'brigade-group'),
      turnCount: 1,
      discover: { ...initState('c1', 'brigade-group').discover, oriented: true },
      constraints: { bhk: '2 BHK' },
    };
    expect(decide(s, ex({ constraints: { bhk: '2 BHK' } }))).toMatchObject({
      kind: 'probe',
      slot: 'location',
    });
  });

  it('location + budget without bhk → probe bhk (end-use)', () => {
    const s = {
      ...initState('c1', 'brigade-group'),
      turnCount: 1,
      discover: { ...initState('c1', 'brigade-group').discover, oriented: true },
      constraints: { location: 'Whitefield', budgetMaxInr: 15_000_000 },
    };
    // firstMissingSlot: location+budget filled → purpose then bhk; purpose skipped when budget set
    // with budget set, purpose probe is skipped; bhk still asked when purpose !== investment
    const goal = decide(s, ex({ constraints: s.constraints }));
    expect(goal.kind).toBe('probe');
    expect(goal).toMatchObject({ slot: 'bhk' });
  });

  it('full brief → recommend', () => {
    const s = {
      ...initState('c1', 'brigade-group'),
      turnCount: 1,
      discover: { ...initState('c1', 'brigade-group').discover, oriented: true },
      constraints: {
        location: 'Devanahalli',
        budgetMaxInr: 8_000_000,
        bhk: '2 BHK',
        propertyType: 'apartment',
      },
    };
    expect(decide(s, ex({ constraints: s.constraints, speechAct: 'search' }))).toMatchObject({
      kind: 'recommend',
    });
  });
});
