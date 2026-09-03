import { describe, expect, it } from 'vitest';
import {
  clearOfferedExcept,
  markFacetSeen,
  projectSeenFacets,
  recordEntities,
} from '../src/engine/entity-store.js';
import { initState } from '../src/engine/state.js';
import type { ThreadState } from '../src/engine/types.js';

function withEntity(id = 'p1', name = 'Brigade Cornerstone'): ThreadState {
  return recordEntities(initState('c1', 'brigade-group'), [{ projectId: id, name }], 'offered', 1);
}

describe('seen ledger — per-project console facet history', () => {
  it('marks once, idempotently, and reads back; unknown project is a no-op', () => {
    let s = withEntity();
    s = markFacetSeen(s, 'p1', 'trust');
    s = markFacetSeen(s, 'p1', 'trust');
    s = markFacetSeen(s, 'p1', 'total');
    expect(projectSeenFacets(s, 'p1')).toEqual(['trust', 'total']);

    // Unknown project / missing id: state unchanged, read is [].
    expect(markFacetSeen(s, 'ghost', 'emi')).toBe(s);
    expect(markFacetSeen(s, undefined, 'emi')).toBe(s);
    expect(projectSeenFacets(s, 'ghost')).toEqual([]);
  });

  it('recordEntities role churn and card refresh preserve the ledger', () => {
    let s = withEntity();
    s = markFacetSeen(s, 'p1', 'place');
    // Same project re-recorded under a new role with a fresh card payload.
    s = recordEntities(
      s,
      [{ projectId: 'p1', name: 'Brigade Cornerstone', startingPriceDisplay: '₹45 L' }],
      'discussed',
      3,
    );
    expect(projectSeenFacets(s, 'p1')).toEqual(['place']);
    expect(s.entities?.['p1']?.roles).toContain('discussed');
  });

  it('clearOfferedExcept strips the offered role but keeps seenFacets', () => {
    let s = withEntity();
    s = markFacetSeen(s, 'p1', 'card');
    s = markFacetSeen(s, 'p1', 'life');
    // A widened re-search drops p1 off the board.
    s = clearOfferedExcept(s, new Set(['other']));
    expect(s.entities?.['p1']?.roles).not.toContain('offered');
    expect(projectSeenFacets(s, 'p1')).toEqual(['card', 'life']);
  });

  it('survives the durable JSON round-trip (store-kv is stringify-wholesale)', () => {
    let s = withEntity();
    s = markFacetSeen(s, 'p1', 'brochure');
    const revived = JSON.parse(JSON.stringify(s)) as ThreadState;
    expect(projectSeenFacets(revived, 'p1')).toEqual(['brochure']);
  });
});
