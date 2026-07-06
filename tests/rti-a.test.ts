import { describe, expect, it } from 'vitest';
import { fallbackReply, buildComposeRequest } from '../src/engine/compose.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { initState } from '../src/engine/state.js';
import { buildPendingPrompt, buildRtiStateUpdate } from '../src/engine/turn-intent/pending-prompt.js';
import { fakeDeps } from './fakes.js';
import type { SuggestedAction } from '../src/engine/recovery-planner.js';

const chipActions: SuggestedAction[] = [
  {
    id: 'clear_bhk',
    label: 'Any configuration',
    patch: { bhk: '' },
    user_line: 'Show projects with any BHK configuration',
    expected_matches: 2,
  },
];

describe('RTI-A pending probing', () => {
  it('builds offer_project pending for budget gap with closest id', () => {
    const pending = buildPendingPrompt(
      { kind: 'no_fit' },
      {
        tools: ['search'],
        budgetGap: {
          budgetDisplay: '₹20 L',
          closestName: 'Brigade Eldorado',
          closestDisplay: '₹31 L',
          closestProjectId: 'eldorado',
        },
      },
      undefined,
      3,
    );
    expect(pending).toMatchObject({
      kind: 'offer_project',
      project_id: 'eldorado',
      project_name: 'Brigade Eldorado',
    });
  });

  it('single-fork budget gap compose copy', () => {
    const req = buildComposeRequest(
      { kind: 'no_fit' },
      {
        tools: ['search'],
        budgetGap: {
          budgetDisplay: '₹20 L',
          location: 'Devanahalli',
          closestName: 'Brigade Eldorado',
          closestDisplay: '₹31 L',
          closestProjectId: 'eldorado',
        },
      },
      { constraints: { budgetMaxInr: 2_000_000 }, alreadyShownSameSet: false, builderName: 'Brigade' },
    );
    const reply = fallbackReply(req);
    expect(reply).toMatch(/Want me to open \*Brigade Eldorado\*\?/);
    expect(reply).not.toMatch(/raise budget or try another area/i);
  });

  it('clears pending on successful recommend', () => {
    const rti = buildRtiStateUpdate({
      goal: { kind: 'recommend' },
      evidence: {
        tools: ['search'],
        matches: [
          {
            projectId: 'a',
            name: 'Ayana',
            microMarket: 'Sakleshpur',
            startingPriceInr: 1,
            startingPriceDisplay: '₹1',
          },
        ],
      },
      reply: 'Here are matches',
      uiMode: 'matches_hub',
      turnCount: 4,
      previousRti: {
        pendingPrompt: { kind: 'chip_menu', chip_ids: ['clear_bhk'], asked_at_turn: 3 },
        lastSuggestedActions: chipActions,
        lastUiMode: 'search_recovery',
      },
    });
    expect(rti.pendingPrompt).toBeUndefined();
    expect(rti.lastSuggestedActions).toEqual(chipActions);
  });

  it('yes after offer_project focuses project without no_fit loop', async () => {
    const deps = fakeDeps();
    let state = initState('rti-yes', 'lokations');
    state = {
      ...state,
      discover: {
        ...state.discover,
        oriented: true,
        lastOffered: [{ projectId: 'ayana', name: 'Ayana' }],
      },
      rti: {
        lastUiMode: 'search_recovery',
        lastGoalKind: 'no_fit',
        pendingPrompt: {
          kind: 'offer_project',
          project_id: 'ayana',
          project_name: 'Ayana',
          asked_at_turn: 1,
        },
      },
    };
    await deps.store.save(state);

    const out = await runEngineTurn(
      {
        convId: 'rti-yes',
        builderId: 'lokations',
        text: 'yes',
        buyerPhone: '+919988776655',
        channel: 'advisor_web',
      },
      deps,
    );

    expect(out.state.phase).toBe('focused');
    expect(out.state.focus?.projectId).toBe('ayana');
    expect(out.debug.goal.kind).toBe('commit');
    expect(out.reply).toMatch(/Ayana/i);
    expect(out.state.rti?.pendingPrompt).toBeUndefined();
  });

  it('chip action_id clears BHK and re-searches', async () => {
    const deps = fakeDeps();
    let state = initState('rti-chip', 'lokations');
    state = {
      ...state,
      constraints: { bhk: '4+ BHK', budgetMaxInr: 10_000_000, propertyType: 'Apartment', location: 'Coorg' },
      discover: { ...state.discover, oriented: true },
      rti: {
        lastUiMode: 'search_recovery',
        lastGoalKind: 'no_fit',
        lastSuggestedActions: chipActions,
        pendingPrompt: { kind: 'chip_menu', chip_ids: ['clear_bhk'], asked_at_turn: 2 },
      },
    };
    await deps.store.save(state);

    const out = await runEngineTurn(
      {
        convId: 'rti-chip',
        builderId: 'lokations',
        text: 'Any configuration',
        buyerPhone: '+919988776644',
        channel: 'advisor_web',
        action_id: 'clear_bhk',
      },
      deps,
    );

    expect(out.state.constraints.bhk).toBeUndefined();
    expect(['recommend', 'advance', 'no_fit']).toContain(out.debug.goal.kind);
    if (out.debug.goal.kind === 'no_fit') {
      expect(out.searchRecovery?.suggested_actions.length).toBeGreaterThan(0);
    }
  });
});
