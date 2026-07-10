import { describe, expect, it } from 'vitest';
import { buildAdvisorNba, mergeChipsWithRails } from '../src/advisor/nba.js';
import { initState } from '../src/engine/state.js';
import type { TurnDebug } from '../src/engine/types.js';

describe('mergeChipsWithRails', () => {
  it('keeps rails within cap of 6', () => {
    const out = mergeChipsWithRails(
      ['A', 'B', 'C', 'D', 'E'],
      ['Back to my matches', 'Refine my brief'],
    );
    expect(out).toEqual(['A', 'B', 'C', 'D', 'Back to my matches', 'Refine my brief']);
    expect(out).toHaveLength(6);
  });

  it('dedupes rails already in primary', () => {
    const out = mergeChipsWithRails(
      ['Starting prices', 'Back to my matches'],
      ['Back to my matches', 'Refine my brief'],
    );
    expect(out).toContain('Refine my brief');
    expect(out.filter((c) => /back to my matches/i.test(c))).toHaveLength(1);
  });
});

describe('buildAdvisorNba chip taxonomy', () => {
  it('matches recommend includes journey + refine rails', () => {
    const state = initState('advisor:nba-rec', 'naya-advisor');
    state.discover.lastOffered = [
      { projectId: 'a', name: 'Alpha', microMarket: 'X', startingPriceDisplay: '₹1' },
      { projectId: 'b', name: 'Beta', microMarket: 'Y', startingPriceDisplay: '₹2' },
    ];
    const debug: TurnDebug = {
      phase: 'discover',
      goal: { kind: 'recommend' },
      tools: ['search'],
      grounding: 'pass',
    };
    const nba = buildAdvisorNba(state, debug);
    expect(nba.board).toBe('matches');
    expect(nba.chips.some((c) => /compare all/i.test(c))).toBe(true);
    expect(nba.chips).toContain('Refine my brief');
    expect(nba.chips.length).toBeLessThanOrEqual(6);
  });

  it('focused overview offers sibling facets + escape rails', () => {
    const state = initState('advisor:nba-ov', 'naya-advisor');
    state.phase = 'focused';
    state.focus = { projectId: 'cs', projectName: 'Brigade Cornerstone' };
    state.discover.lastOffered = [
      { projectId: 'cs', name: 'Brigade Cornerstone', microMarket: 'D', startingPriceDisplay: '₹1' },
      { projectId: 'el', name: 'Brigade Eldorado', microMarket: 'D', startingPriceDisplay: '₹2' },
    ];
    const debug: TurnDebug = {
      phase: 'focused',
      goal: { kind: 'answer', topic: 'overview', projectId: 'cs' },
      tools: [],
      grounding: 'pass',
    };
    const nba = buildAdvisorNba(state, debug);
    expect(nba.board).toBe('project');
    expect(nba.chips).toContain('Starting prices');
    expect(nba.chips).toContain('Location & connectivity');
    expect(nba.chips).toContain('Back to my matches');
    expect(nba.chips).toContain('Refine my brief');
    expect(nba.chips.length).toBeLessThanOrEqual(6);
  });

  it('compare lenses + rails', () => {
    const state = initState('advisor:nba-cmp', 'naya-advisor');
    state.discover.lastOffered = [
      { projectId: 'a', name: 'Alpha', microMarket: 'X', startingPriceDisplay: '₹1' },
      { projectId: 'b', name: 'Beta', microMarket: 'Y', startingPriceDisplay: '₹2' },
    ];
    const debug: TurnDebug = {
      phase: 'discover',
      goal: { kind: 'answer', topic: 'compare' },
      tools: [],
      grounding: 'pass',
    };
    const nba = buildAdvisorNba(state, debug);
    expect(nba.board).toBe('compare');
    expect(nba.chips).toContain('Budget fit');
    expect(nba.chips).toContain('Back to my matches');
    expect(nba.chips).toContain('Refine my brief');
  });

  it('no_fit rails are the product', () => {
    const state = initState('advisor:nba-nf', 'naya-advisor');
    const debug: TurnDebug = {
      phase: 'discover',
      goal: { kind: 'no_fit' },
      tools: [],
      grounding: 'pass',
    };
    const nba = buildAdvisorNba(state, debug);
    expect(nba.chips).toEqual(
      expect.arrayContaining(['Widen my search', 'Change area', 'Adjust budget', 'Start over']),
    );
    expect(nba.chips.length).toBeLessThanOrEqual(6);
  });

  it('location topic maps board_tab to overview (no location tab yet)', () => {
    const state = initState('advisor:nba-loc', 'naya-advisor');
    state.phase = 'focused';
    state.focus = { projectId: 'cs', projectName: 'Cornerstone' };
    const debug: TurnDebug = {
      phase: 'focused',
      goal: { kind: 'answer', topic: 'location', projectId: 'cs' },
      tools: [],
      grounding: 'pass',
    };
    const nba = buildAdvisorNba(state, debug);
    expect(nba.board_tab).toBe('overview');
    expect(nba.chips).toContain('Back to my matches');
  });
});
