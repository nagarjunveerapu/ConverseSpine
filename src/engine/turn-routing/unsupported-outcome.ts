import type { Failure } from '../outcome.js';
import type { TurnRoutingResult } from './types.js';

/** Convert an embedding-owned unsupported verdict into the route-stage value. */
export function failureFromUnsupportedRouting(
  routing: TurnRoutingResult,
): Failure | undefined {
  if (routing.routing !== 'unsupported' || !routing.policy || !routing.subject) {
    return undefined;
  }
  return {
    kind: 'unsupported',
    stage: 'route',
    subject: routing.subject,
    detail: {
      policy: routing.policy,
      ...(routing.embedder_intent_kind
        ? { intent_kind: routing.embedder_intent_kind }
        : {}),
      ...(routing.embedder_score !== undefined
        ? { score: routing.embedder_score }
        : {}),
    },
  };
}
