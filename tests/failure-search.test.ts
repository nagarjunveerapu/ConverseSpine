import { describe, expect, it } from 'vitest';
import { resolveDurableLocation } from '../src/engine/geography-authority.js';
import { searchWithAuthorityRelaxation } from '../src/engine/search-outcome.js';
import { runEngineTurn } from '../src/engine/turn.js';
import type { Match, SearchFilters } from '../src/engine/types.js';
import { fakeDeps } from './fakes.js';

const MATCH: Match = {
  projectId: 'nearest',
  name: 'Nearest Project',
  microMarket: 'Nearby',
  startingPriceInr: 8_000_000,
  startingPriceDisplay: '₹80 L',
  matchReasons: [],
};

describe('Desk-owned geography authority', () => {
  it('canonicalizes resolved candidates and rejects known-invalid candidates', async () => {
    const resolved = await resolveDurableLocation('blr east', {
      resolveLocation: async () => ({
        status: 'resolved',
        canonical: 'East Bangalore',
        lat: 12.9,
        lng: 77.7,
      }),
    });
    expect(resolved).toMatchObject({
      ok: true,
      value: { value: 'East Bangalore', authority: 'resolved' },
    });

    const invalid = await resolveDurableLocation('Buy', {
      resolveLocation: async () => ({ status: 'unresolved' }),
    });
    expect(invalid).toMatchObject({
      ok: false,
      failure: { kind: 'unresolvable', stage: 'extract', subject: 'locality' },
    });
  });

  it('does not call a transport outage proof that the buyer named a bad place', async () => {
    const result = await resolveDurableLocation('Whitefield', {
      resolveLocation: async () => ({ status: 'unavailable' }),
    });
    expect(result).toMatchObject({
      ok: true,
      value: { value: 'Whitefield', authority: 'unavailable' },
    });
  });
});

describe('authority-aware zero-match relaxation', () => {
  const base = {
    constraints: {
      propertyType: 'villa',
      bhk: '3 BHK',
      location: 'Whitefield',
      budgetMaxInr: 7_000_000,
    },
    rejectedProjectIds: [],
  };

  it('releases inferred type, then size, then area; durable constraints stay untouched', async () => {
    const calls: SearchFilters[] = [];
    const constraints = { ...base.constraints };
    const result = await searchWithAuthorityRelaxation({
      ...base,
      constraints,
      authority: { propertyType: 'inferred' },
      filters: {
        projectTypes: 'villa',
        bhks: '3 BHK',
        locations: 'Whitefield',
        budgetMaxInr: 7_000_000,
      },
      search: async (filters) => {
        calls.push({ ...filters });
        return {
          matches: filters.locations
            ? []
            : [{ ...MATCH, startingPriceInr: 6_000_000, startingPriceDisplay: '₹60 L' }],
        };
      },
    });

    expect(calls).toHaveLength(3);
    expect(calls[0]).not.toHaveProperty('projectTypes');
    expect(calls[0]).toHaveProperty('bhks');
    expect(calls[1]).not.toHaveProperty('bhks');
    expect(calls[1]).toHaveProperty('locations');
    expect(calls[2]).not.toHaveProperty('locations');
    expect(result).toMatchObject({
      ok: true,
      value: { relaxed: ['type', 'size', 'area'] },
    });
    expect(constraints).toEqual(base.constraints);
  });

  it('never releases a declared property type', async () => {
    const calls: SearchFilters[] = [];
    await searchWithAuthorityRelaxation({
      constraints: { propertyType: 'plotted' },
      authority: { propertyType: 'declared' },
      rejectedProjectIds: [],
      filters: { projectTypes: 'plotted' },
      search: async (filters) => {
        calls.push(filters);
        return { matches: [MATCH] };
      },
    });
    expect(calls).toEqual([]);
  });

  it('uses an over-budget project as nearest evidence, never as a fit', async () => {
    const result = await searchWithAuthorityRelaxation({
      constraints: { budgetMaxInr: 7_000_000 },
      authority: { budget: 'declared' },
      rejectedProjectIds: [],
      filters: { budgetMaxInr: 7_000_000 },
      search: async () => ({ matches: [MATCH] }),
    });
    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: 'no_match',
        subject: 'budget',
        nearest: { name: 'Nearest Project', display: '₹80 L' },
      },
    });
  });
});

describe('Phase 3 turn behavior', () => {
  it('lets a catalog project name reach project ownership before geography validation', async () => {
    const deps = fakeDeps();
    deps.failureSearch = true;
    const result = await runEngineTurn(
      {
        convId: 'fv3-project-not-place',
        builderId: 'lokations',
        text: 'Ayana',
        channel: 'advisor_web',
      },
      deps,
    );
    expect(result.reply).toMatch(/Ayana/i);
    expect(result.state.phase).toBe('focused');
    expect(result.state.constraints.location).toBeUndefined();
  });

  it('lets pending destructive-scope resolution run before geography validation', async () => {
    const deps = fakeDeps();
    deps.failureTools = true;
    deps.failureSearch = true;
    const turn = (text: string) =>
      runEngineTurn(
        {
          convId: 'fv3-stop-scope',
          builderId: 'lokations',
          text,
          channel: 'advisor_web',
        },
        deps,
      );
    await turn("don't call me, only chat here");
    const kept = await turn('keep the chat');
    expect(kept.reply).toMatch(/keep your property search/i);
    expect(kept.reply).not.toMatch(/identify that location/i);
  });

  it('rejects an unresolved locality before any extracted value reaches state', async () => {
    const deps = fakeDeps();
    deps.failureSearch = true;
    let actionPlan: Record<string, unknown> | undefined;
    deps.crm.appendTurnLedger = async (entry) => {
      actionPlan = entry.actionPlan;
    };
    const result = await runEngineTurn(
      {
        convId: 'fv3-invalid-locality',
        builderId: 'lokations',
        text: 'Buy, 70 lakh, 2 BHK',
        channel: 'advisor_web',
      },
      deps,
    );
    expect(result.reply).toMatch(/couldn't identify that location/i);
    expect(result.state.constraints).toEqual({});
    expect(actionPlan).toMatchObject({
      failures: [
        { kind: 'unresolvable', stage: 'extract', subject: 'locality' },
      ],
    });
  });

  it('keeps relaxed search constraints durable and discloses the broader result', async () => {
    const deps = fakeDeps();
    deps.failureSearch = true;
    const result = await runEngineTurn(
      {
        convId: 'fv3-durable',
        builderId: 'lokations',
        text: 'Whitefield, 70 lakh, 2 BHK',
        channel: 'advisor_web',
      },
      deps,
    );
    expect(result.state.constraints).toMatchObject({
      location: 'Whitefield',
      budgetMaxInr: 7_000_000,
      bhk: '2 BHK',
    });
    expect(result.reply).toMatch(/couldn't match/i);
    expect(result.reply).not.toMatch(/here's what fits/i);
  });

  it('does not release a buyer-declared property type', async () => {
    const deps = fakeDeps();
    deps.failureSearch = true;
    const result = await runEngineTurn(
      {
        convId: 'fv3-hard-type',
        builderId: 'lokations',
        text: 'show me plotted projects in North Bangalore under 70 lakh',
        channel: 'advisor_web',
      },
      deps,
    );
    expect(result.state.constraintAuthority?.propertyType).toBe('declared');
    expect(result.reply).not.toMatch(/Eldorado|Cornerstone/i);
  });
});
