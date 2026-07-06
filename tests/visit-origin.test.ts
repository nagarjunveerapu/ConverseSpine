import { describe, expect, it } from 'vitest';
import { initState } from '../src/engine/state.js';
import { decide } from '../src/engine/phases/visit.js';
import { nearestProjectName, buildProjectGeoMap, TEST_PROJECT_GEO } from '../src/engine/project-geo.js';

describe('visit origin intelligence', () => {
  const now = new Date('2026-07-06T10:00:00+05:30');
  const yelahanka = { lat: 13.1007, lng: 77.5963 };

  it('ranks nearest project from catalog coords', () => {
    const stops = [
      { projectId: 'cornerstone', projectName: 'Brigade Cornerstone' },
      { projectId: 'eldorado', projectName: 'Brigade Eldorado' },
    ];
    const geo = buildProjectGeoMap(['cornerstone', 'eldorado'], TEST_PROJECT_GEO);
    const nearer = nearestProjectName(yelahanka, stops, geo);
    expect(nearer).toMatch(/Brigade (Cornerstone|Eldorado)/);
  });

  it('normalizes I come from cue to locality label', () => {
    const s = {
      ...initState('t', 'naya-advisor'),
      phase: 'visit' as const,
      visit: {
        projectId: 'eldorado',
        projectName: 'Brigade Eldorado',
        queued: [{ projectId: 'cornerstone', projectName: 'Brigade Cornerstone' }],
        lastAsk: 'origin' as const,
        originAsked: true,
      },
    };
    const goal = decide(
      s,
      { constraints: {}, transition: 'none' },
      {
        text: 'I come from Yelahanka',
        now,
        originGeo: yelahanka,
        projectGeoCatalog: TEST_PROJECT_GEO,
      },
    );
    expect(goal.kind).toBe('visit_ask');
    if (goal.kind === 'visit_ask') {
      expect(goal.state.originText).toBe('Yelahanka');
      expect(goal.copy).toContain('*Yelahanka*');
      expect(goal.copy).not.toContain('I come from');
    }
  });

  it('tells buyer nearer first stop after origin answer', () => {
    const s = {
      ...initState('t', 'naya-advisor'),
      phase: 'visit' as const,
      visit: {
        projectId: 'eldorado',
        projectName: 'Brigade Eldorado',
        queued: [{ projectId: 'cornerstone', projectName: 'Brigade Cornerstone' }],
        originText: 'Yelahanka',
        originLat: 13.1007,
        originLng: 77.5963,
        originAsked: true,
      },
    };
    const goal = decide(
      s,
      { constraints: {}, transition: 'none' },
      {
        text: 'Thursday',
        now,
        originGeo: yelahanka,
        projectGeoCatalog: TEST_PROJECT_GEO,
      },
    );
    expect(goal.kind).toBe('visit_ask');
    if (goal.kind === 'visit_ask') {
      expect(goal.copy.toLowerCase()).toContain('nearer');
      expect(goal.copy).toContain('Yelahanka');
    }
  });
});
