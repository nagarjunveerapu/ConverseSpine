import { describe, expect, it } from 'vitest';
import { resolveDurableLocation } from '../src/engine/geography-authority.js';
import { searchWithAuthorityRelaxation } from '../src/engine/search-outcome.js';
import { runEngineTurn } from '../src/engine/turn.js';
import type { EngineDeps } from '../src/engine/ports.js';
import type { Match, SearchFilters } from '../src/engine/types.js';
import { fakeDeps } from './fakes.js';

const MATCH: Match = {
  projectId: 'nearest',
  name: 'Nearest Project',
  microMarket: 'Whitefield',
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

  it('prefers locality budget-nearest over silent area release', async () => {
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
        // Locality inventory only when budget is cleared; never invent off-area hits.
        if (filters.locations && filters.budgetMaxInr === undefined) {
          return { matches: [MATCH] };
        }
        return { matches: [] };
      },
    });

    expect(calls.some((c) => c.locations && c.budgetMaxInr === undefined)).toBe(true);
    expect(calls.every((c) => c.locations !== undefined || !('locations' in c))).toBe(true);
    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: 'no_match',
        subject: 'budget',
        nearest: { name: 'Nearest Project', display: '₹80 L' },
      },
    });
    expect(constraints).toEqual(base.constraints);
  });

  it('returns empty-locality no_match instead of dumping other corridors', async () => {
    const result = await searchWithAuthorityRelaxation({
      constraints: {
        bhk: '2 BHK',
        location: 'Jayanagar',
      },
      rejectedProjectIds: [],
      filters: {
        bhks: '2 BHK',
        locations: 'Jayanagar',
      },
      search: async () => ({ matches: [] }),
    });
    expect(result).toMatchObject({
      ok: false,
      failure: { kind: 'no_match', subject: 'area' },
    });
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
  function withIntent(kind: string, score: number): EngineDeps {
    const deps = fakeDeps();
    deps.failureSearch = true;
    deps.failureRouting = true;
    deps.failureTools = true;
    deps.routingEnv = {
      SIL_EMBED_FIRST: 'true',
      SIL_ROUTING_TAU: '0.83',
      FAILURE_ROUTING: 'true',
      AI: { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) },
      INTENT_VECTORS: {
        query: async () => ({
          matches: [
            {
              id: `fixture-${kind}`,
              score,
              metadata: { intent_kind: kind },
            },
          ],
        }),
      },
    } as unknown as NonNullable<EngineDeps['routingEnv']>;
    return deps;
  }

  it('drops a rejected speculative locality and lets unknown recovery speak', async () => {
    const result = await runEngineTurn(
      {
        convId: 'fv3-joke-not-place',
        builderId: 'lokations',
        text: 'tell me a joke',
        channel: 'advisor_web',
      },
      withIntent('get_brochure', 0.78),
    );
    expect(result.reply).toMatch(/not sure what you'd like help with/i);
    expect(result.reply).not.toMatch(/identify that location/i);
    expect(result.state.constraints.location).toBeUndefined();
  });

  it('lets current-turn opt-out ownership beat speculative geography', async () => {
    const result = await runEngineTurn(
      {
        convId: 'fv3-current-optout',
        builderId: 'lokations',
        text: 'I do not want any calls, only chat',
        channel: 'advisor_web',
      },
      withIntent('opt_out', 0.84),
    );
    expect(result.reply).toMatch(/stop calling|stop all contact/i);
    expect(result.reply).not.toMatch(/identify that location/i);
    expect(result.state.constraints.location).toBeUndefined();
  });

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

  it('keeps relaxed search constraints durable and discloses locality budget nearest', async () => {
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
    expect(result.debug.goal).toMatchObject({ kind: 'no_fit' });
    expect(result.reply).toMatch(/Nothing in \*Whitefield\* starts within/i);
    expect(result.reply).toMatch(/Cornerstone Utopia|₹1\.05 Cr/i);
    expect(result.reply).not.toMatch(/here's what we do have/i);
    expect(result.reply).not.toMatch(/Sakleshpur|Ayana/i);
  });

  it('speaks empty-locality coverage instead of dumping other corridors', async () => {
    const deps = fakeDeps();
    deps.failureSearch = true;
    const result = await runEngineTurn(
      {
        convId: 'fv3-jayanagar',
        builderId: 'lokations',
        text: '2 BHK in Jayanagar',
        channel: 'advisor_web',
      },
      deps,
    );
    expect(result.state.constraints.location).toBe('Jayanagar');
    expect(result.debug.goal).toMatchObject({ kind: 'no_fit' });
    expect(result.reply).toMatch(/don't have anything in \*Jayanagar\*/i);
    expect(result.reply).toMatch(/currently cover/i);
    expect(result.reply).not.toMatch(/\//);
    expect(result.reply).not.toMatch(/here's what we do have/i);
    expect(result.reply).not.toMatch(/couldn't match that (property type|size|area)/i);
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
