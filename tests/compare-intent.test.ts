import { describe, expect, it } from 'vitest';
import { prepareCompareExtracted } from '../src/engine/turn-intent/compare-intent.js';
import { resolveCompareProjectIds } from '../src/engine/compare_resolve.js';
import { initState, recordDiscussed, commitTo } from '../src/engine/state.js';
import {
  isAnaphoricProjectRef,
  shouldQueryProjectVectors,
} from '../src/engine/adapters/semantic-nlu.js';

describe('prepareCompareExtracted', () => {
  it('prefers PROJECT_VECTORS namedProjects over shortlist', () => {
    const state = {
      ...initState('c1', 'lokations'),
      discover: {
        ...initState('c1', 'lokations').discover,
        lastOffered: [
          { projectId: 'ayana-lokations', name: 'Ayana' },
          { projectId: 'clarks-exotica-lokations', name: 'Clarks Exotica' },
        ],
      },
    };
    const ex = prepareCompareExtracted('compare ayana and krishnaja greens', state, {
      constraints: {},
      transition: 'none',
      askTopic: 'compare',
      namedProjects: [
        { projectId: 'krishnaja-greens-lokations', name: 'Krishnaja Greens' },
        { projectId: 'ayana-lokations', name: 'Ayana' },
      ],
    });
    expect(ex.compareProjectIds).toEqual(['krishnaja-greens-lokations', 'ayana-lokations']);
  });

  it('uses discussedProjects for "compare both" instead of stale shortlist', () => {
    let state = {
      ...initState('c1', 'lokations'),
      discover: {
        ...initState('c1', 'lokations').discover,
        lastOffered: [
          { projectId: 'ayana-lokations', name: 'Ayana' },
          { projectId: 'clarks-exotica-lokations', name: 'Clarks Exotica' },
        ],
      },
    };
    state = recordDiscussed(state, [
      { projectId: 'ayana-lokations', name: 'Ayana' },
      { projectId: 'krishnaja-greens-lokations', name: 'Krishnaja Greens' },
    ]);
    const ex = prepareCompareExtracted('okay can you compare both the projects', state, {
      constraints: {},
      transition: 'none',
      askTopic: 'compare',
    });
    expect(ex.compareProjectIds).toEqual(['ayana-lokations', 'krishnaja-greens-lokations']);
  });

  it('does not bind stale shortlist on explicit "compare A and B"', () => {
    let state = {
      ...initState('c1', 'lokations'),
      discover: {
        ...initState('c1', 'lokations').discover,
        lastOffered: [
          { projectId: 'ayana-lokations', name: 'Ayana' },
          { projectId: 'clarks-exotica-lokations', name: 'Clarks Exotica' },
        ],
      },
    };
    state = recordDiscussed(state, [
      { projectId: 'ayana-lokations', name: 'Ayana' },
      { projectId: 'krishnaja-greens-lokations', name: 'Krishnaja Greens' },
    ]);
    const prepared = prepareCompareExtracted('compare ayana and krishnaja greens', state, {
      constraints: {},
      transition: 'none',
      askTopic: 'compare',
      namedProjects: [{ projectId: 'ayana-lokations', name: 'Ayana' }],
    });
    // Leave unset so resolveCompareProjectIds can use discussed + name refs.
    expect(prepared.compareProjectIds).toBeUndefined();
    const ids = resolveCompareProjectIds('compare ayana and krishnaja greens', prepared, state);
    expect(ids).toEqual(['ayana-lokations', 'krishnaja-greens-lokations']);
    expect(ids).not.toContain('clarks-exotica-lokations');
  });
});

describe('resolveCompareProjectIds discourse', () => {
  it('prefers discussed pair over lastOffered on anaphora', () => {
    const s = recordDiscussed(
      {
        ...initState('c1', 'lokations'),
        discover: {
          ...initState('c1', 'lokations').discover,
          lastOffered: [
            { projectId: 'ayana', name: 'Ayana' },
            { projectId: 'clarks', name: 'Clarks Exotica' },
          ],
        },
      },
      [
        { projectId: 'ayana', name: 'Ayana' },
        { projectId: 'krishnaja', name: 'Krishnaja Greens' },
      ],
    );
    const ids = resolveCompareProjectIds(
      'compare both the projects',
      { constraints: {}, askTopic: 'compare' },
      s,
    );
    expect(ids).toEqual(['ayana', 'krishnaja']);
  });
});

describe('anaphoric project vector gate', () => {
  it('skips PROJECT_VECTORS for visit them / compare both', () => {
    expect(isAnaphoricProjectRef('I would like to visit them')).toBe(true);
    expect(isAnaphoricProjectRef('compare both the projects')).toBe(true);
    expect(isAnaphoricProjectRef('compare ayana and krishnaja')).toBe(false);
    expect(
      shouldQueryProjectVectors(
        'I would like to visit them',
        { constraints: {}, transition: 'want_visit' },
        { phase: 'focused', microMarkets: [] },
      ),
    ).toBe(false);
  });

  it('allows vectors when only one namedProject (complete compare pair)', () => {
    expect(
      shouldQueryProjectVectors(
        'compare ayana and krishnaja greens',
        {
          constraints: {},
          askTopic: 'compare',
          namedProjects: [{ projectId: 'ayana-lokations', name: 'Ayana' }],
        },
        { phase: 'discover', microMarkets: [] },
      ),
    ).toBe(true);
  });

  it('skips vectors after single named hit without multi-name cue', () => {
    expect(
      shouldQueryProjectVectors(
        'tell me about Brigade Eldorado',
        {
          constraints: {},
          namedProjects: [{ projectId: 'eldorado', name: 'Brigade Eldorado' }],
        },
        { phase: 'discover', microMarkets: [] },
      ),
    ).toBe(false);
  });

  it('skips PROJECT_VECTORS on search + narrowing constraints (LOC-G01)', () => {
    expect(
      shouldQueryProjectVectors(
        'show me projects in North Bangalore under 1.5 Cr 3BHK',
        {
          constraints: {
            location: 'North Bangalore',
            budgetMaxInr: 15_000_000,
            bhk: '3 BHK',
          },
          speechAct: 'search',
        },
        { phase: 'discover', microMarkets: ['North Bangalore'] },
      ),
    ).toBe(false);
  });

  it('allows bare Ayana after prior constraints (ADV-BAML no_fit recovery)', () => {
    expect(
      shouldQueryProjectVectors(
        'Ayana',
        { constraints: {}, speechAct: 'unknown' },
        { phase: 'discover', microMarkets: [], hasPriorConstraints: true },
      ),
    ).toBe(true);
  });
});

describe('commitTo records discussed', () => {
  it('accumulates focus switches into discussedProjects', () => {
    let s = commitTo(initState('c1', 'lokations'), 'ayana', 'Ayana');
    s = commitTo(s, 'krishnaja', 'Krishnaja Greens');
    expect(s.discover.discussedProjects).toEqual([
      { projectId: 'ayana', name: 'Ayana' },
      { projectId: 'krishnaja', name: 'Krishnaja Greens' },
    ]);
  });
});
