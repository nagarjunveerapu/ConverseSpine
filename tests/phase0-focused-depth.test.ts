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

  it('in Eldorado is not a locality when Eldorado is on the shortlist', () => {
    expect(
      extractLocation('what options are there for 2BHK in Eldorado', {
        projectNameHints: ['Brigade Eldorado', 'Brigade Orchards'],
      }),
    ).toBeUndefined();
  });

  it('does not write poisoned location from breakdown ask in focused phase', () => {
    const s = commitTo(initState('c1', 'lokations'), 'ayana', 'Ayana');
    const ex = extractFactsSync('breakdown of costs', s);
    expect(ex.constraints.location).toBeUndefined();
    expect(ex.askTopics).toContain('price');
    expect(wantsCostBreakdown('breakdown of costs')).toBe(true);
  });

  it('does not treat discourse prefixes as localities (also/about/for this project)', () => {
    expect(extractLocation('also, ROI? for this one')).toBeUndefined();
    expect(extractLocation('also, builder reputation?')).toBeUndefined();
    expect(extractLocation('about this project? for this one')).toBeUndefined();
    expect(extractLocation('for this project, tell me location')).toBeUndefined();
    // Residual P0: stop-trim leftovers must not become places.
    expect(extractLocation('also, when is completion')).toBeUndefined();
    expect(extractLocation('when is completion')).toBeUndefined();
    expect(extractLocation('bhai kab milega batao')).toBeUndefined();
    expect(extractLocation('also, share down payment please')).toBeUndefined();
    expect(extractLocation('share inventory')).toBeUndefined();
    expect(extractLocation('bhai builder kaun hai batao')).toBeUndefined();
    expect(extractLocation('also, share tell me more')).toBeUndefined();
    const s = commitTo(initState('c1', 'brigade-group'), 'brigade-eldorado', 'Brigade Eldorado');
    const locAsk = extractFactsSync('for this project, tell me location', s);
    expect(locAsk.constraints.location).toBeUndefined();
    expect(locAsk.askTopics).toContain('location');
    const ex = extractFactsSync('also, what resale value can I expect if available', s);
    expect(ex.constraints.location).toBeUndefined();
    expect(ex.askTopics ?? []).not.toContain('availability');
  });

  it('if-available hedge does not steal builder/legal into availability', () => {
    expect(detectTopics('builder reputation? if available')).toContain('overview');
    expect(detectTopics('builder reputation? if available')).not.toContain('availability');
    expect(detectTopics('also, is OC available')).toContain('legal');
    expect(detectTopics('also, is OC available')).not.toContain('availability');
  });

  it('park amenity ask and airport hinglish land on facets', () => {
    expect(detectTopics('park?')).toContain('amenities');
    expect(detectTopics('list the park')).toContain('amenities');
    expect(detectTopics('airport kitna door batao')).toContain('location');
    expect(detectTopics('airport kitna door batao')).not.toContain('price');
    expect(detectTopics('any best price on this')).toContain('price');
    expect(detectTopics('dono farq kya hai')).toContain('compare');
    expect(detectTopics('project se kaun better please')).toContain('compare');
    expect(detectTopics('inmein se kaun better')).toContain('compare');
    expect(detectTopics('location? please')).toContain('location');
    expect(detectTopics('hey, tell me about returns if available')).toContain('overview');
    expect(detectTopics('hey, tell me about returns if available')).not.toContain('availability');
    expect(extractLocation('project se airport kitna door batao')).toBeUndefined();
  });

  it('residual P0 facets: inventory, CLP, commute, overview hinglish', () => {
    expect(detectTopics('share inventory')).toContain('availability');
    expect(detectTopics('for this project, what is the CLP')).toContain('price');
    expect(detectTopics('also, share down payment please')).toContain('price');
    expect(detectTopics('what about commute')).toContain('location');
    expect(detectTopics('bhai builder kaun hai batao')).toContain('overview');
    expect(detectTopics('also, share tell me more')).toContain('overview');
    expect(detectTopics('tradeoff the top ones please')).toContain('compare');
    expect(detectTopics('price, when is completion')).toEqual(
      expect.arrayContaining(['price', 'availability']),
    );
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
