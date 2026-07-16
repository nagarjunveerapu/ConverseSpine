/**
 * Understanding Flywheel Wave A — what did the intent layer decide this turn?
 *
 * Distills the routing verdict into the three fields Desk's understanding
 * board stores per captured turn (UNDERSTANDING_FLYWHEEL_LLD §4):
 *
 *   bindSource — which lane decided: 'regex' | 'embed_intent' | 'none'
 *   intent     — the decision (embed: top_kind; regex: the routed kind;
 *                none: the below-τ best guess, still useful on the board)
 *   score      — embedder similarity when it fired, clamped to [0,1]
 *
 * Pure function so the mapping is testable without a turn harness.
 */

import type { TurnRoutingResult } from '../engine/turn-routing/types.js';

export interface SilDecision {
  intent: string;
  score: number;
  bindSource: string;
}

export function silDecision(routing: TurnRoutingResult | undefined): SilDecision {
  const bind = routing?.bind;
  if (!bind) return { intent: '', score: 0, bindSource: '' };
  const score = Math.max(0, Math.min(1, bind.top_score ?? 0));
  switch (bind.bind_source) {
    case 'embed_intent':
      return { intent: bind.top_kind ?? '', score, bindSource: 'embed_intent' };
    case 'regex':
      return { intent: routing?.routing ?? '', score, bindSource: 'regex' };
    default:
      return { intent: bind.top_kind ?? '', score, bindSource: 'none' };
  }
}
