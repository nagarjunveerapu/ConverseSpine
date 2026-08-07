import { describe, expect, it } from 'vitest';
import {
  isCompareAmongOfferedTurn,
  prepareCompareExtracted,
  shouldAllowBudgetGapNoFit,
} from '../src/engine/turn-intent/compare-intent.js';
import { shouldRunTurnIntent } from '../src/engine/turn-intent/classify.js';
import { extractFactsSync } from '../src/engine/facts.js';
import { initState } from '../src/engine/state.js';
import * as visit from '../src/engine/phases/visit.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';
import { currentShortlist } from '../src/engine/entity-store.js';

const shortlist = [
  { projectId: 'p1', name: 'Project Alpha', microMarket: 'North', startingPriceDisplay: '₹30 L' },
  { projectId: 'p2', name: 'Project Beta', microMarket: 'East', startingPriceDisplay: '₹35 L' },
  { projectId: 'p3', name: 'Project Gamma', microMarket: 'West', startingPriceDisplay: '₹40 L' },
];

describe('RTI-E compare intent (project-agnostic)', () => {
  it('detects compare all N and typo comparision', () => {
    expect(isCompareAmongOfferedTurn('Compare all 3')).toBe(true);
    expect(isCompareAmongOfferedTurn('add Orchards to comparision')).toBe(true);
    expect(isCompareAmongOfferedTurn('compare project alpha and beta')).toBe(true);
    expect(isCompareAmongOfferedTurn('project se kaun better please')).toBe(true);
    expect(isCompareAmongOfferedTurn('inmein se kaun better')).toBe(true);
    expect(isCompareAmongOfferedTurn('vs these please')).toBe(true);
    expect(isCompareAmongOfferedTurn('tradeoff the top ones please')).toBe(true);
    expect(isCompareAmongOfferedTurn('also, need a difference for this one')).toBe(true);
    expect(isCompareAmongOfferedTurn('which is better the top ones')).toBe(true);
    // Location-hub open phrasing must not grow regex — SIL teach stamps compare:
    expect(isCompareAmongOfferedTurn('which location is better?')).toBe(false);
    expect(isCompareAmongOfferedTurn('तुलना करो बताओ')).toBe(true);
    expect(isCompareAmongOfferedTurn('इस पर तुलना करो?')).toBe(true);
    expect(isCompareAmongOfferedTurn('ஒரு கேள்வி: எது better?')).toBe(true);
  });

  it('does not run RTI on compare turns', () => {
    const state = {
      ...initState('c', 'builder'),
      rti: { lastGoalKind: 'no_fit', lastUiMode: 'search_recovery' },
    };
    expect(shouldRunTurnIntent(state, undefined, 'Compare all 3')).toBe(false);
  });

  it('prepareCompareExtracted pins compareProjectIds to lastOffered', () => {
    const state = {
      ...initState('c', 'builder'),
      discover: { ...initState('c', 'builder').discover, lastOffered: shortlist },
    };
    const ex = prepareCompareExtracted('Compare all 3', state, extractFactsSync('Compare all 3', state));
    expect(ex.askTopic).toBe('compare');
    expect(ex.compareProjectIds).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('RTI-G no_fit guard with shortlist', () => {
  it('blocks budget-gap no_fit when shortlist exists on compare turn', () => {
    const state = {
      ...initState('c', 'builder'),
      discover: { ...initState('c', 'builder').discover, lastOffered: shortlist },
    };
    expect(shouldAllowBudgetGapNoFit(state, 'Compare all 3')).toBe(false);
    expect(shouldAllowBudgetGapNoFit(state, 'show me villas')).toBe(true);
  });
});

describe('RTI-D+ visit follow-up', () => {
  it('what about names next queued stop in visit phase', () => {
    const s = {
      ...initState('t', 'builder'),
      phase: 'visit' as const,
      visit: {
        projectId: 'p2',
        projectName: 'Project Beta',
        queued: [],
      },
      discover: {
        ...initState('t', 'builder').discover,
        lastOffered: shortlist,
      },
    };
    const ex = extractFactsSync('what about Project Beta?', s);
    const goal = visit.decide(s, ex, {
      text: 'what about Project Beta?',
      now: new Date('2026-07-10T10:00:00+05:30'),
    });
    expect(goal.kind).toBe('visit_ask');
    if (goal.kind === 'visit_ask') {
      expect(goal.copy.toLowerCase()).toMatch(/which day|day works/);
    }
  });

  it('visit_booked reply includes next stop when queue remains', async () => {
    const deps = fakeDeps();
    let state = {
      ...initState('v', 'lokations'),
      phase: 'visit' as const,
      discover: {
        ...initState('v', 'lokations').discover,
        oriented: true,
        lastOffered: [
          { projectId: 'ayana', name: 'Ayana' },
          { projectId: 'krishnaja', name: 'Krishnaja Greens' },
        ],
      },
      visit: {
        projectId: 'ayana',
        projectName: 'Ayana',
        queued: [{ projectId: 'krishnaja', projectName: 'Krishnaja Greens' }],
        awaitingConfirm: true,
        proposedIso: new Date(Date.now() + 86400000).toISOString(),
        proposedLabel: 'Monday at 11:00 AM',
      },
    };
    await deps.store.save(state);
    const r = await runEngineTurn(
      {
        convId: state.convId,
        builderId: state.builderId,
        text: 'yes',
        channel: 'advisor_web',
      },
      deps,
    );
    expect(r.debug.goal.kind).toBe('visit_booked');
    expect(r.reply).toMatch(/Next up/i);
    expect(r.reply).toMatch(/Krishnaja/i);
    expect(r.state.phase).toBe('visit');
    expect(r.state.visit?.projectId).toBe('krishnaja');
  });
});

describe('RTI-F first shortlist deterministic copy', () => {
  it('uses list template not LLM on first recommend', async () => {
    const deps = fakeDeps();
    const state = {
      ...initState('f', 'lokations'),
      turnCount: 2,
      discover: { ...initState('f', 'lokations').discover, oriented: true },
      constraints: { budgetMaxInr: 5_000_000, location: 'Sakleshpur' },
    };
    await deps.store.save(state);
    const r = await runEngineTurn(
      {
        convId: state.convId,
        builderId: state.builderId,
        text: 'Show me options',
        channel: 'advisor_web',
      },
      deps,
    );
    if (r.debug.goal.kind === 'recommend') {
      expect(r.reply).toMatch(/these look strongest|Here's what fits/i);
      expect(currentShortlist(r.state).length).toBeGreaterThanOrEqual(1);
    }
  });
});
