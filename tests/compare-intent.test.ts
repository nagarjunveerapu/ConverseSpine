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
