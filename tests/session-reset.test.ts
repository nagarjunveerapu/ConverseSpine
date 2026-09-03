import { describe, expect, it } from 'vitest';
import { commitTo, freshSession, initState, isSessionResetText } from '../src/engine/state.js';

describe('session reset', () => {
  it('recognises soak commands', () => {
    expect(isSessionResetText('/reset')).toBe(true);
    expect(isSessionResetText('  START OVER ')).toBe(true);
    expect(isSessionResetText('/start')).toBe(true);
    expect(isSessionResetText('new chat')).toBe(true);
    expect(isSessionResetText('hi')).toBe(false);
    expect(isSessionResetText('reset my budget')).toBe(false);
  });

  it('drops focus and brief but keeps Desk ids', () => {
    let s = commitTo(initState('c1', 'brigade-group'), 'eldorado', 'Brigade Eldorado');
    s = {
      ...s,
      ndThreadId: 'nd-1',
      ndBuyerPhone: '+919591400615',
      constraints: { bhk: '2 BHK', budgetMaxInr: 80_00_000 },
      returningBuyer: { buyerName: 'Nagarjun', daysSinceLastSeen: 2 },
      turnCount: 6,
    };
    const next = freshSession(s);
    expect(next.focus).toBeUndefined();
    expect(next.constraints).toEqual({});
    expect(next.returningBuyer).toBeUndefined();
    expect(next.turnCount).toBe(0);
    expect(next.ndThreadId).toBe('nd-1');
    expect(next.ndBuyerPhone).toBe('+919591400615');
    expect(next.builderId).toBe('brigade-group');
  });
});
