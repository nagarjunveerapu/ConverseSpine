import { describe, expect, it } from 'vitest';
import { decide as handoffDecide } from '../src/engine/phases/handoff.js';
import { commitTo, initState } from '../src/engine/state.js';
import type { Extracted } from '../src/engine/types.js';

function stickyHandoffState() {
  return { ...commitTo(initState('c1', 'naya-advisor'), 'brigade-eldorado-naya-advisor', 'Brigade Eldorado'), phase: 'handoff' as const };
}

describe('handoff catalog escape', () => {
  it('stays handoff for a true human ask with no catalog owner', () => {
    const ex: Extracted = { constraints: {}, wantsHuman: true };
    expect(handoffDecide(stickyHandoffState(), ex, 'talk to a human')).toEqual({ kind: 'handoff' });
  });

  it('stays handoff for empty free-text when focus exists', () => {
    const ex: Extracted = { constraints: {} };
    expect(handoffDecide(stickyHandoffState(), ex, 'asdf qwer')).toEqual({ kind: 'handoff' });
  });

  it('escapes sticky handoff to answer a media/brochure ask while focus lives', () => {
    const ex: Extracted = {
      constraints: {},
      askTopic: 'media',
      mediaAssetKind: 'brochure',
    };
    const goal = handoffDecide(stickyHandoffState(), ex, 'send the brochure');
    expect(goal.kind).toBe('answer');
    if (goal.kind === 'answer') {
      expect(goal.topic).toBe('media');
      expect(goal.projectId).toBe('brigade-eldorado-naya-advisor');
    }
  });

  it('escapes sticky handoff on a FactKey loan ask', () => {
    const ex: Extracted = { constraints: {} };
    const goal = handoffDecide(stickyHandoffState(), ex, 'can I get the loan for this project?');
    expect(goal.kind).toBe('answer');
    if (goal.kind === 'answer') {
      expect(goal.topic).toBe('legal');
    }
  });

  it('escapes sticky handoff on amenities extract', () => {
    const ex: Extracted = { constraints: {}, askTopic: 'amenities', askTopics: ['amenities'] };
    const goal = handoffDecide(stickyHandoffState(), ex, 'what amenities does it have');
    expect(goal.kind).toBe('answer');
    if (goal.kind === 'answer') expect(goal.topic).toBe('amenities');
  });

  it('keeps warm_ack / recall escapes', () => {
    expect(
      handoffDecide(stickyHandoffState(), { constraints: {}, recall: true }, 'what did we book'),
    ).toEqual({ kind: 'visit_recall' });
    expect(
      handoffDecide(stickyHandoffState(), { constraints: {}, smalltalk: true }, 'thanks'),
    ).toEqual({ kind: 'warm_ack' });
  });
});
