import { describe, expect, it } from 'vitest';
import { extractFactsSync } from '../src/engine/facts.js';
import { initState } from '../src/engine/state.js';
import * as visit from '../src/engine/phases/visit.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { shouldRunTurnIntent } from '../src/engine/turn-intent/classify.js';
import { fakeDeps } from './fakes.js';

const offered = [
  { projectId: 'p1', name: 'Project Alpha', microMarket: 'North', startingPriceDisplay: '₹30 L' },
  { projectId: 'p2', name: 'Project Beta', microMarket: 'East', startingPriceDisplay: '₹35 L' },
  { projectId: 'p3', name: 'Project Gamma', microMarket: 'West', startingPriceDisplay: '₹40 L' },
];

describe('RTI visit gate', () => {
  it('does not run RTI during visit phase', () => {
    const state = {
      ...initState('v', 'builder'),
      phase: 'visit' as const,
      visit: { projectId: 'p1', projectName: 'Project Alpha', queued: [{ projectId: 'p2', projectName: 'Project Beta' }] },
      discover: { ...initState('v', 'builder').discover, lastOffered: offered },
    };
    expect(shouldRunTurnIntent(state, undefined, 'what about Project Beta?')).toBe(false);
    expect(shouldRunTurnIntent(state, undefined, 'yes')).toBe(false);
    expect(shouldRunTurnIntent(state, undefined, 'Saturday')).toBe(false);
    expect(shouldRunTurnIntent(state, 'clear_bhk', 'yes')).toBe(true);
  });

  it('does not exit visit on what-about follow-up', () => {
    expect(
      visit.shouldExitVisitForIntent({ constraints: {}, pickName: 'Beta' }, 'what about Project Beta?'),
    ).toBe(false);
  });
});

describe('RTI visit gate end-to-end', () => {
  it('books first stop, prompts next, continues visit on what-about', async () => {
    const deps = fakeDeps();
    let state = {
      ...initState('vg', 'lokations'),
      phase: 'discover' as const,
      turnCount: 4,
      discover: {
        ...initState('vg', 'lokations').discover,
        oriented: true,
        lastOffered: [
          { projectId: 'ayana', name: 'Ayana' },
          { projectId: 'krishnaja', name: 'Krishnaja Greens' },
        ],
      },
      constraints: { budgetMaxInr: 5_000_000, location: 'Sakleshpur' },
    };
    await deps.store.save(state);

    let r = await runEngineTurn(
      { convId: state.convId, builderId: state.builderId, text: 'visit ayana and krishnaja', channel: 'advisor_web' },
      deps,
    );
    expect(r.state.phase).toBe('visit');

    r = await runEngineTurn(
      { convId: state.convId, builderId: state.builderId, text: 'Saturday morning', channel: 'advisor_web' },
      deps,
    );
    expect(r.debug.goal.kind).toBe('visit_propose');

    r = await runEngineTurn(
      { convId: state.convId, builderId: state.builderId, text: 'yes', channel: 'advisor_web' },
      deps,
    );
    expect(r.debug.goal.kind).toBe('visit_booked');
    expect(r.reply).toMatch(/Next up/i);
    expect(r.reply).toMatch(/Krishnaja/i);
    expect(r.state.phase).toBe('visit');

    r = await runEngineTurn(
      {
        convId: state.convId,
        builderId: state.builderId,
        text: 'what about Krishnaja Greens?',
        channel: 'advisor_web',
      },
      deps,
    );
    expect(r.debug.goal.kind).not.toBe('commit');
    expect(r.state.phase).toBe('visit');
    expect(r.reply.toLowerCase()).toMatch(/which day|day works/);

    r = await runEngineTurn(
      { convId: state.convId, builderId: state.builderId, text: 'Compare all 3', channel: 'advisor_web' },
      deps,
    );
    expect(r.debug.goal.kind).toBe('answer');
    if (r.debug.goal.kind === 'answer') expect(r.debug.goal.topic).toBe('compare');
  });

  it('visit_booked goal carries nextQueuedStop from prior queue', () => {
    const s = {
      ...initState('t', 'builder'),
      phase: 'visit' as const,
      visit: {
        projectId: 'p1',
        projectName: 'Project Alpha',
        queued: [{ projectId: 'p2', projectName: 'Project Beta' }],
        awaitingConfirm: true,
        proposedIso: new Date(Date.now() + 86400000).toISOString(),
        proposedLabel: 'Saturday at 11:00 AM',
      },
    };
    const ex = extractFactsSync('yes', s);
    const goal = visit.decide(s, ex, { text: 'yes', now: new Date() });
    expect(goal.kind).toBe('visit_booked');
    if (goal.kind === 'visit_booked') {
      expect(goal.nextQueuedStop?.projectId).toBe('p2');
    }
  });
});
