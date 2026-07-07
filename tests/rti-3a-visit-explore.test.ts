import { describe, expect, it } from 'vitest';
import { extractFactsSync } from '../src/engine/facts.js';
import { initState } from '../src/engine/state.js';
import { isVisitFollowUpQuestion, decide } from '../src/engine/phases/visit.js';
import { classifyTurnRouting, classifyTurnRoutingRules } from '../src/engine/turn-routing/classify.js';
import { buildTurnRoutingInput } from '../src/engine/turn-routing/types.js';
import { detectFocusedSwitchIntent, resolveFocusedSwitchGoal } from '../src/engine/project_switch.js';
import { extractFacts } from '../src/engine/facts.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';

const brigadeShortlist = [
  { projectId: 'cornerstone', name: 'Brigade Cornerstone Utopia' },
  { projectId: 'eldorado', name: 'Brigade Eldorado' },
  { projectId: 'orchards', name: 'Brigade Orchards' },
];

describe('RTI-3A visit vs explore routing', () => {
  it('isVisitFollowUpQuestion rejects topic probes', () => {
    const state = {
      ...initState('t', 'brigade-group'),
      discover: { ...initState('t', 'brigade-group').discover, lastOffered: brigadeShortlist },
    };
    const configsEx = extractFactsSync('what about the unit configurations of Eldorado?', state);
    expect(isVisitFollowUpQuestion('what about the unit configurations of Eldorado?', configsEx)).toBe(
      false,
    );

    const bareEx = extractFactsSync('what about Eldorado?', state);
    expect(isVisitFollowUpQuestion('what about Eldorado?', bareEx)).toBe(true);

    const priceEx = extractFactsSync('what about Eldorado pricing?', state);
    expect(isVisitFollowUpQuestion('what about Eldorado pricing?', priceEx)).toBe(false);
  });

  it('classifyTurnRouting marks configurations as answer_on_project', () => {
    const state = {
      ...initState('t', 'brigade-group'),
      phase: 'discover' as const,
      discover: { ...initState('t', 'brigade-group').discover, lastOffered: brigadeShortlist },
    };
    const ex = extractFactsSync('what about the unit configurations of Eldorado?', state);
    const routing = classifyTurnRoutingRules(buildTurnRoutingInput(state, ex, 'what about the unit configurations of Eldorado?'));
    expect(routing.routing).toBe('answer_on_project');
    expect(routing.answer_topic).toBe('availability');
  });

  it('visit.decide defers configurations to answer instead of visit_ask', () => {
    const s = {
      ...initState('t', 'brigade-group'),
      phase: 'visit' as const,
      focus: { projectId: 'cornerstone', projectName: 'Brigade Cornerstone Utopia' },
      visit: { projectId: 'cornerstone', projectName: 'Brigade Cornerstone Utopia' },
      discover: { ...initState('t', 'brigade-group').discover, lastOffered: brigadeShortlist },
    };
    const ex = extractFactsSync('what about the unit configurations of Eldorado?', s);
    const goal = decide(s, ex, {
      text: 'what about the unit configurations of Eldorado?',
      now: new Date('2026-07-10T10:00:00+05:30'),
    });
    expect(goal.kind).toBe('answer');
    if (goal.kind === 'answer') {
      expect(goal.topic).toBe('availability');
      expect(goal.projectId).toBe('eldorado');
    }
  });

  it('detectFocusedSwitchIntent commits Eldorado with availability follow-up', () => {
    const state = {
      ...initState('t', 'brigade-group'),
      phase: 'focused' as const,
      focus: { projectId: 'cornerstone', projectName: 'Brigade Cornerstone Utopia' },
      discover: { ...initState('t', 'brigade-group').discover, lastOffered: brigadeShortlist },
    };
    const text = 'what about the unit configurations of Eldorado?';
    const ex = extractFactsSync(text, state);
    const intent = detectFocusedSwitchIntent(text, ex, state);
    expect(intent).toMatchObject({
      commit: { projectId: 'eldorado', name: 'Brigade Eldorado' },
      followUp: 'availability',
    });
  });

  it('resolveFocusedSwitchGoal async path commits Eldorado', async () => {
    const deps = fakeDeps();
    const state = {
      ...initState('t', 'brigade-group'),
      phase: 'focused' as const,
      focus: { projectId: 'cornerstone', projectName: 'Brigade Cornerstone Utopia' },
      discover: { ...initState('t', 'brigade-group').discover, lastOffered: brigadeShortlist },
    };
    const text = 'what about the unit configurations of Eldorado?';
    const ex = await extractFacts(text, state, deps.llm);
    const goal = await resolveFocusedSwitchGoal(text, ex, state, deps);
    expect(goal).toMatchObject({
      kind: 'commit',
      projectId: 'eldorado',
      followUp: 'availability',
    });
  });

  it('V01: focused Cornerstone → Eldorado configurations answers availability', async () => {
    const deps = fakeDeps();
    let state = {
      ...initState('v01', 'brigade-group'),
      phase: 'focused' as const,
      turnCount: 5,
      focus: { projectId: 'cornerstone', projectName: 'Brigade Cornerstone Utopia' },
      discover: {
        ...initState('v01', 'brigade-group').discover,
        oriented: true,
        lastOffered: brigadeShortlist,
      },
    };
    await deps.store.save(state);

    const r = await runEngineTurn(
      {
        convId: state.convId,
        builderId: state.builderId,
        text: 'what about the unit configurations of Eldorado?',
        buyerPhone: '+919999999991',
        channel: 'advisor_web',
      },
      deps,
    );

    expect(r.debug.phase).toBe('focused');
    expect(r.debug.goal.kind).toBe('answer');
    if (r.debug.goal.kind === 'answer') {
      expect(r.debug.goal.topic).toBe('availability');
      expect(r.debug.goal.projectId).toBe('eldorado');
    }
    expect(r.state.phase).not.toBe('visit');
    expect(r.reply.toLowerCase()).not.toMatch(/which day works/);
  });

  it('V04: discover Eldorado pricing does not enter visit phase', async () => {
    const deps = fakeDeps();
    let state = {
      ...initState('v04', 'brigade-group'),
      phase: 'discover' as const,
      turnCount: 3,
      discover: {
        ...initState('v04', 'brigade-group').discover,
        oriented: true,
        lastOffered: brigadeShortlist,
      },
    };
    await deps.store.save(state);

    const r = await runEngineTurn(
      {
        convId: state.convId,
        builderId: state.builderId,
        text: 'what about Eldorado pricing?',
        buyerPhone: '+919999999992',
        channel: 'advisor_web',
      },
      deps,
    );

    expect(r.state.phase).not.toBe('visit');
    expect(r.debug.goal.kind).not.toBe('visit_ask');
    expect(['answer', 'commit']).toContain(r.debug.goal.kind);
  });

  it('V05: Tuesday on visit board does not search Tuesday Apartment', async () => {
    const deps = fakeDeps();
    let state = {
      ...initState('v05', 'brigade-group'),
      phase: 'discover' as const,
      turnCount: 6,
      focus: { projectId: 'cornerstone', projectName: 'Brigade Cornerstone Utopia' },
      constraints: { propertyType: 'Apartment', budgetMaxInr: 10_000_000 },
      rti: { lastGoalKind: 'visit_ask' },
      discover: {
        ...initState('v05', 'brigade-group').discover,
        oriented: true,
        lastOffered: brigadeShortlist,
      },
    };
    await deps.store.save(state);

    const r = await runEngineTurn(
      {
        convId: state.convId,
        builderId: state.builderId,
        text: 'Tuesday',
        buyerPhone: '+919999999993',
        channel: 'advisor_web',
      },
      deps,
    );

    expect(r.debug.goal.kind).not.toBe('no_fit');
    expect(r.reply).not.toMatch(/Tuesday Apartment/i);
    expect(r.state.phase).toBe('visit');
    expect(['visit_ask', 'visit_propose']).toContain(r.debug.goal.kind);
  });
});
