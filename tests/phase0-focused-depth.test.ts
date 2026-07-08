import { describe, expect, it } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import {
  extractFactsSync,
  extractLocation,
  wantsCostBreakdown,
  wantsImplicitProjectPick,
  detectTopics,
} from '../src/engine/facts.js';
import { commitTo, initState, resolvePick } from '../src/engine/state.js';
import * as discover from '../src/engine/phases/discover.js';
import { fakeDeps } from './fakes.js';

describe('Phase 0 — location extraction gates', () => {
  it('does not treat "breakdown of costs" as a locality', () => {
    expect(extractLocation('breakdown of costs')).toBeUndefined();
    expect(extractLocation('breakdown of costs', { askTopics: ['price'] })).toBeUndefined();
  });

  it('skips bare locality when buyer asks a detail topic', () => {
    expect(extractLocation('Whitefield', { askTopics: ['price'] })).toBeUndefined();
  });

  it('does not treat "tell me about Ayana" as a locality', () => {
    expect(extractLocation('tell me about Ayana')).toBeUndefined();
  });

  it('still extracts explicit locality in discover', () => {
    expect(extractLocation('looking in Whitefield')).toBe('Whitefield');
  });

  it('does not write poisoned location from breakdown ask in focused phase', () => {
    const s = commitTo(initState('c1', 'lokations'), 'ayana', 'Ayana');
    const ex = extractFactsSync('breakdown of costs', s);
    expect(ex.constraints.location).toBeUndefined();
    expect(ex.askTopics).toContain('price');
    expect(wantsCostBreakdown('breakdown of costs')).toBe(true);
  });
});

describe('Phase 0 — the/this project binding', () => {
  const shortlist = [
    { projectId: 'eldorado', name: 'Brigade Eldorado', startingPriceDisplay: '₹31 L' },
    { projectId: 'cornerstone', name: 'Brigade Cornerstone', startingPriceDisplay: '₹33 L' },
    { projectId: 'orchards', name: 'Brigade Orchards', startingPriceDisplay: '₹35 L' },
  ];

  it('wantsImplicitProjectPick with 3-way shortlist when phrase names the project', () => {
    expect(wantsImplicitProjectPick('I want the details of the project', shortlist)).toBe(true);
    expect(wantsImplicitProjectPick('details on the project', shortlist, { projectId: 'orchards', projectName: 'Brigade Orchards' })).toBe(
      true,
    );
  });

  it('resolvePick binds the/this project to focus regardless of shortlist size', () => {
    const s = {
      ...initState('c1', 'brigade-group'),
      focus: { projectId: 'orchards', projectName: 'Brigade Orchards' },
      discover: { ...initState('c1', 'brigade-group').discover, lastOffered: shortlist },
    };
    const ex = extractFactsSync('I want the details of the project', s);
    const pick = resolvePick(ex, shortlist, s);
    expect(pick?.projectId).toBe('orchards');
    const goal = discover.decide(s, ex);
    expect(goal).toMatchObject({ kind: 'commit', projectId: 'orchards', followUp: 'overview' });
  });
});

describe('Phase 0 — golden focused-depth thread', () => {
  it('focused breakdown → details-of-the-project keeps depth', async () => {
    const deps = fakeDeps();
    const convId = 'phase0-orchards-thread';
    const turn = (text: string) =>
      runEngineTurn(
        { convId, builderId: 'lokations', text, buyerPhone: '+919999999991', channel: 'advisor_web' },
        deps,
      );

    await turn('coorg, 50 Lakhs');
    const pick = await turn('tell me about Ayana');
    expect(pick.state.phase).toBe('focused');
    expect(pick.state.focus?.projectId).toBe('ayana');

    const breakdown = await turn('breakdown of costs');
    expect(breakdown.state.phase).toBe('focused');
    expect(breakdown.state.focus?.projectId).toBe('ayana');
    expect(breakdown.debug.goal).toMatchObject({ kind: 'answer', topic: 'price' });
    expect(breakdown.reply.toLowerCase()).not.toContain('no exact match');
    expect(breakdown.state.constraints.location?.toLowerCase()).not.toMatch(/breakdown/);

    const details = await turn('I want the details of the project');
    expect(details.state.phase).toBe('focused');
    expect(details.state.focus?.projectId).toBe('ayana');
    expect(details.debug.goal.kind).not.toBe('recommend');
    expect(details.reply.toLowerCase()).not.toContain('no exact match');
    expect(details.reply).not.toMatch(/Ayana.*Krishnaja.*Clarks/i);
  });

  it('pricing and legal both stays on focused project without location poison', async () => {
    const deps = fakeDeps();
    const convId = 'phase0-multi-topic';
    const turn = (text: string) =>
      runEngineTurn(
        { convId, builderId: 'lokations', text, buyerPhone: '+919999999992' },
        deps,
      );

    await turn('coorg, 50 Lakhs');
    await turn('Ayana sounds good');
    const multi = await turn('pricing and legal both');
    expect(multi.state.phase).toBe('focused');
    expect(multi.debug.goal).toMatchObject({ kind: 'answer' });
    expect(detectTopics('pricing and legal both')).toEqual(['price', 'legal']);
    expect(multi.reply).toMatch(/RERA|Regulatory/i);
    expect(multi.reply.toLowerCase()).not.toContain('no exact match');
  });
});
