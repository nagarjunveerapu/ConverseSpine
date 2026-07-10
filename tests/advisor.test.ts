import { describe, expect, it } from 'vitest';
import { mapAdvisorTurnResponse } from '../src/advisor/map-response.js';
import { sessionToConvId, sessionToPhone } from '../src/advisor/session.js';
import { initState } from '../src/engine/state.js';
import type { TurnDebug } from '../src/engine/types.js';

describe('advisor session', () => {
  it('maps session UUID to stable phone and conv id', () => {
    const sid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    expect(sessionToPhone(sid)).toBe('+9190a1b2c3d4e5');
    expect(sessionToConvId(sid)).toBe(`advisor:${sid}`);
  });
});

describe('mapAdvisorTurnResponse', () => {
  it('includes project cards and prefs from engine state', () => {
    const state = initState('advisor:test', 'naya-advisor');
    state.discover.lastOffered = [
      {
        projectId: 'ayana',
        name: 'Ayana',
        microMarket: 'Sakleshpur',
        startingPriceDisplay: '₹24.95 L',
      },
    ];
    state.constraints = {
      location: 'Sakleshpur',
      bhk: '2 BHK',
      purpose: 'self_use',
      budgetMaxInr: 8_000_000,
    };

    const debug: TurnDebug = {
      phase: 'discover',
      goal: { kind: 'recommend' },
      tools: ['search'],
      grounding: 'pass',
    };

    const resp = mapAdvisorTurnResponse({
      sessionId: 'test-session',
      state,
      reply: 'Here are three matches.',
      debug,
    });

    expect(resp.status).toBe('ok');
    expect(resp.session_id).toBe('test-session');
    expect(resp.projects).toHaveLength(1);
    expect(resp.projects![0]).toMatchObject({
      id: 'ayana',
      name: 'Ayana',
      micro_market: 'Sakleshpur',
      price_label: '₹24.95 L',
    });
    expect(resp.prefs_snapshot?.location).toBe('Sakleshpur');
    expect(resp.prefs_snapshot?.budget).toMatch(/80/);
    expect(resp.phase).toBe('discover');
    expect(resp.nba?.board).toBe('matches');
    expect(resp.nba?.chips.length).toBeGreaterThan(0);
    expect(resp.nba?.chips).toContain('Refine my brief');
    expect(resp.checklist_snapshot?.phase).toBe('discover');
    expect(resp.checklist_snapshot?.engaged_project_ids).toContain('ayana');
  });

  it('P7: legal answer routes nba to project + legal tab', () => {
    const state = initState('advisor:legal', 'naya-advisor');
    state.phase = 'focused';
    state.focus = { projectId: 'eldorado', projectName: 'Brigade Eldorado' };
    const debug: TurnDebug = {
      phase: 'focused',
      goal: { kind: 'answer', topic: 'legal', projectId: 'eldorado' },
      tools: [],
      grounding: 'pass',
    };
    const resp = mapAdvisorTurnResponse({
      sessionId: 's',
      state,
      reply: 'RERA is on file.',
      debug,
    });
    expect(resp.nba).toMatchObject({
      board: 'project',
      board_tab: 'legal',
      board_project_id: 'eldorado',
    });
    expect(resp.nba!.chips.some((c) => /banks/i.test(c))).toBe(true);
    expect(resp.nba!.chips).toContain('Back to my matches');
    expect(resp.nba!.chips).toContain('Refine my brief');
    expect(resp.checklist_snapshot?.focus_project_id).toBe('eldorado');
  });
});
