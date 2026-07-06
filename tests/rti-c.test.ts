import { describe, expect, it } from 'vitest';
import { extractRecoveryPatchFromText } from '../src/engine/turn-intent/extract-recovery-patch.js';
import {
  applyTurnIntentResult,
  buildTurnIntentInput,
  classifyTurnIntent,
} from '../src/engine/turn-intent/classify.js';
import { planSearchRecovery } from '../src/engine/recovery-planner.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { initState } from '../src/engine/state.js';
import { fakeDeps } from './fakes.js';
import type { Env } from '../src/env.js';

const noopEnv = {} as Env;

describe('RTI-C recovery patch extraction', () => {
  it('applies In bangalore as location patch', () => {
    const intent = extractRecoveryPatchFromText('In bangalore', 'search_recovery');
    expect(intent?.kind).toBe('apply_recovery_patch');
    expect(intent?.patch?.location?.toLowerCase()).toContain('bangalore');
  });

  it('applies broader Bangalore area from compound text', () => {
    const intent = extractRecoveryPatchFromText(
      'I want the area to be broader Bangalore area',
      'search_recovery',
    );
    expect(intent?.patch?.location).toBe('Bangalore');
  });

  it('switches property type to apartment', () => {
    const intent = extractRecoveryPatchFromText('switch to apartment', 'search_recovery');
    expect(intent?.patch?.propertyType).toBe('Apartment');
  });

  it('yes after location_broaden pending applies Bangalore patch', async () => {
    let state = initState('c1', 'lokations');
    state = {
      ...state,
      constraints: { location: 'Aerospace Park / Devanahalli Corridor', propertyType: 'Villa', budgetMaxInr: 5_000_000 },
      rti: {
        pendingPrompt: {
          kind: 'location_broaden',
          location_target: 'Bangalore',
          asked_at_turn: 2,
        },
        lastUiMode: 'search_recovery',
      },
    };
    const input = buildTurnIntentInput(state, 'yes', 'advisor_web', 'search_recovery');
    const intent = await classifyTurnIntent(noopEnv, input);
    expect(intent.kind).toBe('apply_recovery_patch');
    expect(intent.patch?.location).toBe('Bangalore');
  });
});

describe('RTI-C contextual recovery planner', () => {
  it('prioritizes property type switches when hint is property_type', async () => {
    const recovery = await planSearchRecovery({
      constraints: {
        location: 'Aerospace Park / Devanahalli Corridor',
        propertyType: 'Villa',
        budgetMaxInr: 5_000_000,
      },
      catalog: {
        priceMinInr: 3_000_000,
        priceMaxInr: 15_000_000,
        projectTypes: ['apartment', 'villa', 'plot'],
        microMarkets: ['North Bangalore', 'Whitefield'],
        total: 10,
        sample: [],
      },
      reason: 'No villa match',
      maxActions: 4,
      variant: 'zero_match',
      hint: 'property_type',
      searchCount: async (filters) => {
        const type = filters.projectTypes ?? '';
        if (type.toLowerCase().includes('apartment')) return 3;
        if (!filters.locations) return 2;
        return 0;
      },
    });

    expect(recovery.suggested_actions.length).toBeGreaterThan(0);
    const labels = recovery.suggested_actions.map((a) => a.label);
    expect(labels.some((l) => /Apartment|Switch/i.test(l))).toBe(true);
  });

  it('offers Search all Bangalore for corridor micro-markets', async () => {
    const recovery = await planSearchRecovery({
      constraints: {
        location: 'Aerospace Park / Devanahalli Corridor',
        propertyType: 'Villa',
        budgetMaxInr: 5_000_000,
      },
      catalog: {
        priceMinInr: 3_000_000,
        priceMaxInr: 15_000_000,
        projectTypes: ['villa', 'apartment'],
        microMarkets: ['North Bangalore'],
        total: 5,
        sample: [],
      },
      reason: 'No match',
      maxActions: 4,
      variant: 'zero_match',
      hint: 'location',
      searchCount: async (filters) => {
        if ((filters.locations ?? '').toLowerCase().includes('bangalore')) return 2;
        return 0;
      },
    });

    expect(recovery.suggested_actions.some((a) => a.label.includes('Bangalore'))).toBe(true);
  });
});

describe('RTI-C end-to-end', () => {
  it('minimum budget question returns recovery chips', async () => {
    const deps = fakeDeps();
    let state = initState('rti-c', 'lokations');
    state = {
      ...state,
      discover: { ...state.discover, oriented: true },
      constraints: {
        location: 'Aerospace Park / Devanahalli Corridor',
        propertyType: 'Villa',
        budgetMaxInr: 5_000_000,
      },
      rti: { lastUiMode: 'search_recovery', lastGoalKind: 'no_fit', lastEvidenceKind: 'property_type_gap' },
    };
    await deps.store.save(state);

    const out = await runEngineTurn(
      {
        convId: 'rti-c',
        builderId: 'lokations',
        text: 'what is the minimum budget I need to keep for villa in Bangalore?',
        buyerPhone: '+919988776655',
        channel: 'advisor_web',
      },
      deps,
    );

    expect(out.searchRecovery?.suggested_actions.length).toBeGreaterThan(0);
    expect(out.uiMode).toBe('search_recovery');
    expect(out.reply).toMatch(/start from/i);
  });

  it('In bangalore applies patch and re-searches', async () => {
    const deps = fakeDeps();
    let state = initState('rti-c2', 'lokations');
    state = {
      ...state,
      discover: { ...state.discover, oriented: true },
      constraints: {
        location: 'Aerospace Park / Devanahalli Corridor',
        propertyType: 'Villa',
        budgetMaxInr: 5_000_000,
      },
      rti: {
        lastUiMode: 'search_recovery',
        lastGoalKind: 'no_fit',
        lastSuggestedActions: [
          {
            id: 'relax_location:bangalore',
            label: 'Search all Bangalore',
            patch: { location: 'Bangalore' },
            user_line: 'Show me projects in Bangalore',
            expected_matches: 2,
          },
        ],
      },
    };
    await deps.store.save(state);

    const out = await runEngineTurn(
      {
        convId: 'rti-c2',
        builderId: 'lokations',
        text: 'In bangalore',
        buyerPhone: '+919988776655',
        channel: 'advisor_web',
      },
      deps,
    );

    expect(out.state.constraints.location?.toLowerCase()).toContain('bangalore');
    expect(out.searchRecovery?.suggested_actions.length).toBeGreaterThan(0);
  });
});
