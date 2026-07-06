import { describe, expect, it } from 'vitest';
import { extractFactsSync } from '../src/engine/facts.js';
import { initState } from '../src/engine/state.js';
import * as visit from '../src/engine/phases/visit.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';

const offered = [
  { projectId: 'eldorado', name: 'Brigade Eldorado' },
  { projectId: 'cornerstone', name: 'Brigade Cornerstone' },
  { projectId: 'orchards', name: 'Brigade Orchards' },
];

function brigadeDiscoverState() {
  return {
    ...initState('rti-d', 'brigade-group'),
    phase: 'discover' as const,
    turnCount: 4,
    discover: {
      ...initState('rti-d', 'brigade-group').discover,
      oriented: true,
      lastOffered: offered,
    },
    constraints: {
      budgetMaxInr: 5_000_000,
      location: 'Devanahalli',
      propertyType: 'apartment',
    },
  };
}

describe('RTI-D visit multi-stop (unit)', () => {
  it('resolveNamed picks both projects from visit line', () => {
    const s = brigadeDiscoverState();
    const ex = extractFactsSync('I would like to visit eldorado and cornerstone', s);
    expect(ex.transition).toBe('want_visit');
    expect(ex.namedProjects?.map((p) => p.projectId).sort()).toEqual(['cornerstone', 'eldorado']);
  });

  it('seeds visit queue for two named projects', () => {
    const s = { ...brigadeDiscoverState(), phase: 'visit' as const };
    const text = 'I would like to visit eldorado and cornerstone';
    const ex = extractFactsSync(text, s);
    const goal = visit.decide(s, ex, { text, now: new Date('2026-07-10T10:00:00+05:30') });
    expect(goal.kind).toBe('visit_ask');
    if (goal.kind !== 'visit_ask') return;
    expect(goal.ask).toBe('origin');
    expect(goal.state.projectId).toBe('eldorado');
    expect(goal.state.queued).toEqual([
      { projectId: 'cornerstone', projectName: 'Brigade Cornerstone' },
    ]);
    expect(goal.copy).toMatch(/coming from/i);
  });

  it('ALSO appends a stop without switching away from the first project', () => {
    const s = {
      ...brigadeDiscoverState(),
      phase: 'visit' as const,
      visit: {
        projectId: 'eldorado',
        projectName: 'Brigade Eldorado',
        queued: [],
      },
    };
    const text = 'add cornerstone too';
    const ex = extractFactsSync(text, s);
    const goal = visit.decide(s, ex, { text, now: new Date('2026-07-10T10:00:00+05:30') });
    expect(goal.kind).toBe('visit_ask');
    if (goal.kind !== 'visit_ask') return;
    expect(goal.ask).toBe('origin');
    expect(goal.state.projectId).toBe('eldorado');
    expect(goal.state.queued?.some((q) => q.projectId === 'cornerstone')).toBe(true);
    expect(goal.copy).toMatch(/coming from/i);
  });

  it('isVisitRouteExpand detects add/also phrasing', () => {
    expect(visit.isVisitRouteExpand('add cornerstone too')).toBe(true);
    expect(visit.isVisitRouteExpand('What is the RERA status?')).toBe(false);
  });
});

describe('RTI-D end-to-end', () => {
  it('want_visit with two names enters visit phase with queued stop', async () => {
    const deps = fakeDeps();
    let state = brigadeDiscoverState();
    await deps.store.save(state);

    const r = await runEngineTurn(
      {
        convId: state.convId,
        builderId: state.builderId,
        text: 'I would like to visit eldorado and cornerstone',
        channel: 'advisor_web',
      },
      deps,
    );

    expect(r.state.phase).toBe('visit');
    expect(r.state.visit?.projectId).toBe('eldorado');
    expect(r.state.visit?.queued?.[0]?.projectId).toBe('cornerstone');
    expect(r.debug.goal.kind).toBe('visit_ask');
  });
});
