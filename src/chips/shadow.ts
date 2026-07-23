/**
 * Shadow mode — compute the ranking, change nothing.
 *
 * The chips a buyer sees still come from nba.ts. This records what the ranker
 * WOULD have offered, into the ledger, so the ordering can be checked against
 * what buyers actually do next before it drives anything they see.
 *
 * The measurement is the point. Offline on dev traffic the table predicts the
 * next state at 85.4% top-3 against 51.5% for one fixed list — but that is
 * replays and internal test conversations. Shadow mode is how the same number
 * gets computed on real buyers without betting the UI on it first.
 *
 * Reading the log later: for each turn, `ranked` is the prediction; the NEXT
 * turn's `action_plan.kind` is the truth. Nothing else needs joining.
 */
import { rankChips, type ChipRanking } from './rank.js';
import type { ChipEvidence } from './catalogue.js';
import type { ConversationState, EvidenceSet, TurnGoal } from '../engine/types.js';

export interface ChipShadowLog {
  /** Artifact the ranking came from — a table swap must be visible in the data. */
  table: string;
  /** The state we just produced; the ranking is conditioned on it. */
  from: string;
  phase: string;
  /** 'cell' means real evidence for this state; 'phase'/'global' mean we backed off. */
  level: ChipRanking['level'];
  support: number;
  ranked: Array<{ state: string; label: string; p: number }>;
  /** Predicted states we could NOT offer, and why. A state that piles up here
   *  is a catalogue gap or a data gap — both worth seeing. */
  held?: Array<{ state: string; p: number; why: string }>;
}

/** `answer` + topic is the state the table is keyed on. */
export function goalState(goal: TurnGoal): string {
  const topic = 'topic' in goal && typeof goal.topic === 'string' ? goal.topic : '';
  return topic ? `${goal.kind}/${topic}` : goal.kind;
}

export function buildChipShadow(input: {
  state: ConversationState;
  goal: TurnGoal;
  evidence: EvidenceSet;
}): ChipShadowLog {
  const { state, goal, evidence } = input;

  const ev: ChipEvidence = {
    ...(evidence.detail ? { focused: evidence.detail } : {}),
    shortlistSize: state.discover.lastOffered.length,
    ...(state.visitBookedCache?.length ? { visitBooked: true } : {}),
  };

  const ranking = rankChips({
    phase: state.phase,
    state: goalState(goal),
    evidence: ev,
  });

  return {
    table: ranking.table,
    from: goalState(goal),
    phase: state.phase,
    level: ranking.level,
    support: ranking.support,
    ranked: ranking.chips.map((c) => ({
      state: c.state,
      label: c.label,
      p: Math.round(c.p * 1000) / 1000,
    })),
    ...(ranking.suppressed.length
      ? {
          held: ranking.suppressed.map((c) => ({
            state: c.state,
            p: Math.round(c.p * 1000) / 1000,
            why: c.suppressed ?? 'unknown',
          })),
        }
      : {}),
  };
}
