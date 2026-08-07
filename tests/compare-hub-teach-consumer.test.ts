import { describe, expect, it } from 'vitest';
import { mapIntentToRouting } from '../src/engine/turn-routing/embedder-map.js';
import { mergeRoutingTopicsIntoExtract } from '../src/engine/turn-routing/answer-topics.js';
import {
  hasTeachCompareStamp,
  isCompareAmongOfferedTurn,
  prepareCompareExtracted,
} from '../src/engine/turn-intent/compare-intent.js';
import { initState } from '../src/engine/state.js';
import type { TurnRoutingInput } from '../src/engine/turn-routing/types.js';

const baseInput = {
  text: 'which location is better?',
  phase: 'focused',
  builder_id: 'brigade-group',
  shortlist_count: 3,
} as TurnRoutingInput;

describe('compare hub — teach consumer (no open regex)', () => {
  it('compare_projects routing stamps answer_topic compare', () => {
    const r = mapIntentToRouting('compare_projects', 0.92, baseInput);
    expect(r?.routing).toBe('compare_offered');
    expect(r?.answer_topic).toBe('compare');
    expect(r?.answer_topics).toEqual(['compare']);
  });

  it('routing stamp → merge → prepareCompare seeds shortlist (location hub)', () => {
    expect(isCompareAmongOfferedTurn('which location is better?')).toBe(false);

    const shortlist = [
      { projectId: 'eldorado', name: 'Brigade Eldorado' },
      { projectId: 'orchards', name: 'Brigade Orchards' },
    ];
    const s = {
      ...initState('t', 'brigade-group'),
      discover: { ...initState('t', 'brigade-group').discover, lastOffered: shortlist },
      phase: 'focused' as const,
      focus: { projectId: 'cornerstone', projectName: 'Brigade Cornerstone' },
    };

    const routed = mapIntentToRouting('compare_projects', 0.92, baseInput);
    let ex = mergeRoutingTopicsIntoExtract({ constraints: {} }, routed ?? undefined);
    expect(hasTeachCompareStamp(ex)).toBe(true);

    ex = prepareCompareExtracted('which location is better?', s, ex);
    expect(ex.askTopic).toBe('compare');
    expect(ex.compareProjectIds?.length).toBeGreaterThanOrEqual(2);
  });
});
