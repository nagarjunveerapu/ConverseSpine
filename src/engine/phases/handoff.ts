import type { Extracted, TurnGoal } from '../types.js';

export function decide(ex: Extracted): TurnGoal {
  if (ex.recall) return { kind: 'visit_recall' };
  if (ex.postVisitAck || (ex.affirm && !ex.askTopic && !ex.isQuestion) || ex.smalltalk) {
    return { kind: 'warm_ack' };
  }
  return { kind: 'handoff' };
}
