import { describe, expect, it } from 'vitest';
import { applyVisitBooked, initState } from '../src/engine/state.js';
import { decide as focusedDecide } from '../src/engine/phases/focused.js';

describe('applyVisitBooked focus pin', () => {
  it('pins focus from visit.projectId when focus was unset (advisor path)', () => {
    const s = {
      ...initState('c1', 'brigade-group'),
      phase: 'visit' as const,
      visit: {
        projectId: 'eldorado',
        projectName: 'Brigade Eldorado',
        slotText: 'Monday 10:00 AM',
        awaitingConfirm: true,
      },
    };
    const next = applyVisitBooked(s);
    expect(next.phase).toBe('focused');
    expect(next.focus).toEqual({ projectId: 'eldorado', projectName: 'Brigade Eldorado' });
    expect(next.postVisitAckPending).toBe(true);
    expect(next.visit).toBeUndefined();
  });

  it('bare 2BHK in focused post-book answers availability', () => {
    const s = {
      ...initState('c1', 'brigade-group'),
      phase: 'focused' as const,
      focus: { projectId: 'eldorado', projectName: 'Brigade Eldorado' },
      postVisitAckPending: true,
    };
    const goal = focusedDecide(s, { constraints: { bhk: '2 BHK' } }, '2BHK');
    expect(goal.kind).toBe('answer');
    if (goal.kind === 'answer') {
      expect(goal.topic).toBe('availability');
      expect(goal.projectId).toBe('eldorado');
    }
  });
});
