import { describe, expect, it } from 'vitest';
import { initState } from '../src/engine/state.js';
import { mapVisitItinerary } from '../src/advisor/map-visit-itinerary.js';

describe('mapVisitItinerary', () => {
  it('merges booked cache with active propose and queued stops', () => {
    const state = {
      ...initState('t', 'naya-advisor'),
      phase: 'visit' as const,
      visitBookedCache: [
        {
          projectId: 'cornerstone',
          projectName: 'Brigade Cornerstone',
          iso: '2026-07-13T11:00:00+05:30',
          label: 'Monday at 11:00 AM',
        },
      ],
      visit: {
        projectId: 'eldorado',
        projectName: 'Brigade Eldorado',
        awaitingConfirm: true,
        proposedIso: '2026-07-13T12:55:00+05:30',
        proposedLabel: 'Monday at 12:55 PM',
        driveFromPriorMin: 25,
        driveSource: 'distance_matrix' as const,
        queued: [{ projectId: 'orchards', projectName: 'Brigade Orchards' }],
      },
    };
    const itinerary = mapVisitItinerary(state);
    expect(itinerary?.stops).toHaveLength(3);
    expect(itinerary?.stops[0]?.status).toBe('booked');
    expect(itinerary?.stops[1]?.status).toBe('proposed');
    expect(itinerary?.stops[1]?.drive_from_prev_min).toBe(25);
    expect(itinerary?.stops[2]?.status).toBe('queued');
  });
});
