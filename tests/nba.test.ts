import { describe, expect, it } from 'vitest';
import { buildAdvisorNba, mergeChipsWithRails } from '../src/advisor/nba.js';
import { chipActionId } from '../src/chips/catalogue.js';
import { catalogEntryByActionId } from '../src/engine/speech-act/catalog.js';
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

// ADR-005: the ranker orders the CONTENT chips but must never displace the
// escape rails. Regression for the live bug where enabling the ranker replaced
// the whole nba chip list with the top-3 answer chips, dropping navigation so
// "Back to my matches" / "Refine my brief" only appeared occasionally.
describe('buildAdvisorNba with chip ranker live (ADR-005)', () => {
  it('recommend keeps a refine rail when the ranker orders content', () => {
    const state = initState('advisor:nba-rank-rec', 'naya-advisor');
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
    const nba = buildAdvisorNba(state, debug, true);
    expect(nba.chips).toContain('Refine my brief');
    expect(nba.chips.length).toBeLessThanOrEqual(6);
  });

  it('focused answer keeps BOTH escape rails with the ranker on', () => {
    const state = initState('advisor:nba-rank-ans', 'naya-advisor');
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
    const nba = buildAdvisorNba(state, debug, true);
    expect(nba.chips).toContain('Back to my matches');
    expect(nba.chips).toContain('Refine my brief');
    expect(nba.chips.length).toBeLessThanOrEqual(6);
  });

  it('no_fit stays rails-only — the ranker does not touch it', () => {
    const state = initState('advisor:nba-rank-nf', 'naya-advisor');
    const debug: TurnDebug = {
      phase: 'discover',
      goal: { kind: 'no_fit' },
      tools: [],
      grounding: 'pass',
    };
    const nba = buildAdvisorNba(state, debug, true);
    expect(nba.chips).toEqual(
      expect.arrayContaining(['Widen my search', 'Change area', 'Adjust budget', 'Start over']),
    );
  });

  it('clarify_project_pick still offers the project NAMES, not ranked next-states', () => {
    const state = initState('advisor:nba-rank-clar', 'naya-advisor');
    state.discover.lastOffered = [
      { projectId: 'a', name: 'Alpha Heights', microMarket: 'X', startingPriceDisplay: '₹1' },
      { projectId: 'b', name: 'Beta Gardens', microMarket: 'Y', startingPriceDisplay: '₹2' },
    ];
    const debug: TurnDebug = {
      phase: 'discover',
      goal: { kind: 'clarify_project_pick' },
      tools: [],
      grounding: 'pass',
    };
    const nba = buildAdvisorNba(state, debug, true);
    expect(nba.chips).toContain('Alpha Heights');
    expect(nba.chips).toContain('Beta Gardens');
  });
});

// ADR-006: content chips carry a deterministic action_id so a tap skips the LLM
// extract; rails do not. Every action_id the ranker emits must be resolvable by
// the speech-act catalog, or the door falls back to a slow free-text extract.
describe('deterministic chip action_ids (ADR-006)', () => {
  it('maps ranker states to catalog action_ids that resolve', () => {
    const cases: Array<[string, string]> = [
      ['answer/price', 'answer_price'],
      ['answer/availability', 'answer_availability'],
      ['answer/legal', 'answer_legal'],
      ['answer/overview', 'answer_overview'],
      ['answer/compare', 'compare_projects'],
      ['shortlist_answer/price', 'answer_price'],
      ['recommend', 'search'],
      ['visit_ask', 'visit_book'],
    ];
    for (const [state, actionId] of cases) {
      expect(chipActionId(state)).toBe(actionId);
      // The id must be a real catalog entry — else resolveActionIdToChipPath
      // returns unknown and the fast path silently degrades.
      expect(catalogEntryByActionId(actionId)).toBeDefined();
    }
    // Interaction-specific / unknown states stay undefined (send as text).
    expect(chipActionId('clarify_project_pick')).toBeUndefined();
    expect(chipActionId('probe')).toBeUndefined();
  });

  it('focused answer turn attaches chip_actions aligned to chips; rails are empty', () => {
    const state = initState('advisor:nba-actions', 'naya-advisor');
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
    const nba = buildAdvisorNba(state, debug, true);
    expect(nba.chip_actions).toBeDefined();
    expect(nba.chip_actions).toHaveLength(nba.chips.length);
    // Rails carry no action_id.
    const railIdx = nba.chips.indexOf('Back to my matches');
    expect(railIdx).toBeGreaterThanOrEqual(0);
    expect(nba.chip_actions![railIdx]).toBe('');
    // At least one content chip is deterministic, and every non-empty id resolves.
    expect(nba.chip_actions!.some((a) => a)).toBe(true);
    for (const a of nba.chip_actions!) {
      if (a) expect(catalogEntryByActionId(a)).toBeDefined();
    }
  });

  it('omits chip_actions when the ranker is off (no deterministic chips)', () => {
    const state = initState('advisor:nba-noactions', 'naya-advisor');
    state.phase = 'focused';
    state.focus = { projectId: 'cs', projectName: 'Cornerstone' };
    const debug: TurnDebug = {
      phase: 'focused',
      goal: { kind: 'answer', topic: 'overview', projectId: 'cs' },
      tools: [],
      grounding: 'pass',
    };
    const nba = buildAdvisorNba(state, debug, false);
    expect(nba.chip_actions).toBeUndefined();
  });
});
