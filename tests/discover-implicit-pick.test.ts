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
});
