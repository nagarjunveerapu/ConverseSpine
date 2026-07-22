import { describe, expect, it } from 'vitest';
import { decide as discoverDecide } from '../src/engine/phases/discover.js';
import { initState } from '../src/engine/state.js';
import type { Extracted } from '../src/engine/types.js';

describe('discover implicit project pick', () => {
  it('asks which project when shortlist has 2+ and no name', () => {
    const s = {
      ...initState('c1', 'lokations'),
      discover: {
        ...initState('c1', 'lokations').discover,
        lastOffered: [
          { projectId: 'ayana', name: 'Ayana' },
          { projectId: 'clarks', name: 'Clarks Exotica' },
        ],
      },
    };
    const ex: Extracted = {
      constraints: {},
      transition: 'want_details',
      implicitProjectPick: true,
    };
    const goal = discoverDecide(s, ex);
    expect(goal).toEqual({ kind: 'clarify_project_pick' });
  });

  it('commits singleton shortlist on details ask', () => {
    const s = {
      ...initState('c1', 'lokations'),
      discover: {
        ...initState('c1', 'lokations').discover,
        lastOffered: [{ projectId: 'ayana', name: 'Ayana' }],
      },
    };
    const ex: Extracted = {
      constraints: {},
      transition: 'want_details',
      implicitProjectPick: true,
    };
    const goal = discoverDecide(s, ex);
    expect(goal).toMatchObject({
      kind: 'commit',
      projectId: 'ayana',
      followUp: 'overview',
    });
  });

  it('commits when buyer names a shortlisted project', () => {
    const s = {
      ...initState('c1', 'lokations'),
      discover: {
        ...initState('c1', 'lokations').discover,
        lastOffered: [
          { projectId: 'ayana', name: 'Ayana' },
          { projectId: 'clarks', name: 'Clarks Exotica' },
        ],
      },
    };
    const ex: Extracted = {
      constraints: {},
      transition: 'want_details',
      pickName: 'Ayana',
      namedProjects: [{ projectId: 'ayana', name: 'Ayana' }],
    };
    const goal = discoverDecide(s, ex);
    expect(goal).toMatchObject({
      kind: 'commit',
      projectId: 'ayana',
    });
  });

  it('commits bare pickName without want_details (after clarify)', () => {
    const s = {
      ...initState('c1', 'lokations'),
      discover: {
        ...initState('c1', 'lokations').discover,
        lastOffered: [
          { projectId: 'ayana', name: 'Ayana' },
          { projectId: 'clarks', name: 'Clarks Exotica' },
        ],
      },
    };
    const ex: Extracted = { constraints: {}, pickName: 'Ayana' };
    const goal = discoverDecide(s, ex);
    expect(goal).toMatchObject({ kind: 'commit', projectId: 'ayana' });
  });

  it('explicit name beats stale filters: forceRecommendList + leftover location must still commit', () => {
    // Dev repro (name-beats-filters): buyer says a vague brief ("green near the
    // hills") → no_fit; the recovery prompt makes the next turn look like a
    // refinement, so extract sets forceRecommendList=true and the project name
    // leaks into constraints.location. A single high-confidence PROJECT_VECTORS
    // hit means the buyer NAMED that project — it must commit, not run a search
    // that returns no_fit. The freshSearchBoard/forceRecommendList belt yields.
    const s = {
      ...initState('c1', 'lokations'),
      constraints: { location: 'Ayana' },
    };
    const ex: Extracted = {
      constraints: { location: 'Ayana' },
      speechAct: 'unknown',
      transition: 'none',
      forceRecommendList: true,
      namedProjects: [{ projectId: 'ayana-lokations', name: 'Ayana' }],
    };
    const goal = discoverDecide(s, ex);
    expect(goal).toMatchObject({ kind: 'commit', projectId: 'ayana-lokations' });
  });

  it('LOC-G01: search + constraints recommends despite hallucinated namedProjects', () => {
    const s = {
      ...initState('c1', 'brigade-group'),
      constraints: {
        location: 'North Bangalore',
        budgetMaxInr: 15_000_000,
        bhk: '3 BHK',
      },
    };
    const ex: Extracted = {
      constraints: {
        location: 'North Bangalore',
        budgetMaxInr: 15_000_000,
        bhk: '3 BHK',
      },
      speechAct: 'search',
      namedProjects: [{ projectId: 'brigade-eldorado', name: 'Brigade Eldorado' }],
    };
    const goal = discoverDecide(s, ex);
    expect(goal).toEqual({ kind: 'recommend' });
  });

  it('facet ask with multi shortlist and no pick → shortlist-wide answer (not recommend)', () => {
    const s = {
      ...initState('c1', 'brigade-group'),
      discover: {
        ...initState('c1', 'brigade-group').discover,
        lastOffered: [
          { projectId: 'neo', name: 'Brigade Northridge Neo' },
          { projectId: 'eldorado', name: 'Brigade Eldorado' },
        ],
      },
      constraints: { location: 'North Bangalore', propertyType: 'apartment' },
    };
    const ex: Extracted = {
      constraints: {},
      askTopic: 'price',
      askTopics: ['price'],
      speechAct: 'answer',
    };
    const goal = discoverDecide(s, ex);
    // Was clarify_project_pick — the 4q clarify-pick sinkhole. The protection
    // this test encodes (never recommend/no_fit on stale constraints) holds;
    // the facet is now ANSWERED per shortlisted project instead of menu'd.
    expect(goal).toEqual({
      kind: 'shortlist_answer',
      topic: 'price',
      projectIds: ['neo', 'eldorado'],
    });
  });
});
