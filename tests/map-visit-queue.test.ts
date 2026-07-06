import { describe, expect, it } from 'vitest';
import { mapVisitQueue, visitRouteProjectIds } from '../src/advisor/map-visit-queue.js';
import { initState } from '../src/engine/state.js';

describe('mapVisitQueue', () => {
  it('maps active + queued stops during visit phase', () => {
    const state = {
      ...initState('v', 'naya-advisor'),
      phase: 'visit' as const,
      visit: {
        projectId: 'orchards',
        projectName: 'Brigade Orchards',
        queued: [{ projectId: 'cornerstone', projectName: 'Brigade Cornerstone' }],
        awaitingConfirm: true,
        proposedLabel: 'Saturday at 11:00 AM',
      },
    };
    const q = mapVisitQueue(state)!;
    expect(q.active?.project_id).toBe('orchards');
    expect(q.queued).toHaveLength(1);
    expect(q.awaiting_confirm).toBe(true);
    expect(q.proposed_label).toBe('Saturday at 11:00 AM');
    expect(visitRouteProjectIds(q)).toEqual(['orchards', 'cornerstone']);
  });

  it('returns undefined when not in visit scheduling', () => {
    const state = initState('d', 'naya-advisor');
    expect(mapVisitQueue(state)).toBeUndefined();
  });
});
