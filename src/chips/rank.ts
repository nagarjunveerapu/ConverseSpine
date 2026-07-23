/**
 * Rank the chips by what the buyer is most likely to do next.
 *
 *     rank(chip | state) = P(next | phase, state)      <- the ledger
 *                        × available(chip, evidence)   <- can we answer it
 *                        − shown_recently(chip)        <- anti-repetition
 *
 * A lookup and three multiplications. No LLM, no embedding — a chip tap already
 * skips the embedding entirely (#120), so chips getting better makes the system
 * cheaper, not more expensive.
 *
 * The backoff is the part that stops "arbitrary": a state we have little
 * evidence for falls back to what buyers do in this phase, and failing that to
 * what buyers do at all. It never falls back to noise, and it always terminates.
 */
import {
  CHIP_GLOBAL_PRIOR,
  CHIP_PHASE_PRIOR,
  CHIP_TABLE_ID,
  CHIP_TRANSITIONS,
} from './transition-table.js';
import { chipFor, type ChipEvidence } from './catalogue.js';

/** Below this, a cell is a handful of conversations — not a preference. */
export const MIN_SUPPORT = 8;

export type BackoffLevel = 'cell' | 'phase' | 'global';

export interface RankedChip {
  state: string;
  label: string;
  /** Share of transitions out of this state. */
  p: number;
  /** Present when the state ranked but has no chip or no evidence behind it. */
  suppressed?: 'no_chip' | 'no_evidence' | 'shown_recently';
}

export interface ChipRanking {
  table: string;
  level: BackoffLevel;
  support: number;
  /** Offerable chips, best first. */
  chips: RankedChip[];
  /** Ranked states we could NOT offer, with the reason. The interesting half:
   *  a state that keeps appearing here is a gap in the catalogue or the data. */
  suppressed: RankedChip[];
}

function counts(phase: string, state: string): { c: Record<string, number>; level: BackoffLevel } {
  const cell = CHIP_TRANSITIONS[`${phase}|${state}`];
  if (cell && total(cell) >= MIN_SUPPORT) return { c: cell, level: 'cell' };
  const ph = CHIP_PHASE_PRIOR[phase];
  if (ph && total(ph) >= MIN_SUPPORT) return { c: ph, level: 'phase' };
  return { c: CHIP_GLOBAL_PRIOR, level: 'global' };
}

const total = (c: Record<string, number>): number =>
  Object.values(c).reduce((a, b) => a + b, 0);

export function rankChips(input: {
  phase: string;
  state: string;
  evidence: ChipEvidence;
  /** Labels served on recent turns — a chip the buyer just declined is dead weight. */
  recentlyShown?: readonly string[];
  limit?: number;
}): ChipRanking {
  const { phase, state, evidence, recentlyShown = [], limit = 3 } = input;
  const { c, level } = counts(phase, state);
  const n = total(c);
  const recent = new Set(recentlyShown.map((s) => s.toLowerCase()));

  const chips: RankedChip[] = [];
  const suppressed: RankedChip[] = [];

  for (const [next, count] of Object.entries(c).sort((a, b) => b[1] - a[1])) {
    // Self-transitions are real in the data (a buyer asks two price questions
    // in a row) but offering "ask this again" as the top chip is not a next
    // step. The state we just answered is never its own chip.
    if (next === state) continue;

    const def = chipFor(next);
    const p = n > 0 ? count / n : 0;
    if (!def) {
      suppressed.push({ state: next, label: '', p, suppressed: 'no_chip' });
      continue;
    }
    const label = def.label(evidence);
    if (!def.available(evidence)) {
      suppressed.push({ state: next, label, p, suppressed: 'no_evidence' });
      continue;
    }
    if (recent.has(label.toLowerCase())) {
      suppressed.push({ state: next, label, p, suppressed: 'shown_recently' });
      continue;
    }
    chips.push({ state: next, label, p });
  }

  return {
    table: CHIP_TABLE_ID,
    level,
    support: n,
    chips: chips.slice(0, limit),
    suppressed: suppressed.slice(0, limit + 2),
  };
}
