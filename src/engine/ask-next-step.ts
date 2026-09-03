/**
 * Phase 2c — state-conditioned consumer for `ask_next_step`.
 *
 * The embedder can bind the kind; without a consumer the turn falls through
 * to search/overview. Meaning is (state, text) → next dialogue move:
 *   cold          → orient / probe
 *   board (≥2)    → clarify which to open
 *   board (1)     → open the singleton
 *   focused       → advance (visit / hold nudge)
 *   visit_pending → continue booking (re-propose or propose_visit)
 *
 * Deterministic text detect is the floor so unit gates don't need Vectorize.
 * Embedder bind (`routing === 'ask_next_step'`) is the live path once corpus
 * is rebuilt under SIL_STATE_TOKENS.
 */
import { visitProposeConfirmCopy } from './advisory-copy.js';
import { isAskNextStepText } from './ask-next-step-detect.js';
import { currentShortlist } from './entity-store.js';
import { firstMissingSlot } from './phases/discover.js';
import { catalogAskOwns } from './turn-routing/intent-authority.js';
import { discourseStateToken } from './turn-routing/state-tokens.js';
import { isNonPlaceUtterance } from './placeability.js';
import type { ThreadState, Extracted, TurnGoal } from './types.js';

export { ASK_NEXT_STEP_RE, isAskNextStepText } from './ask-next-step-detect.js';

export function shouldConsumeAskNextStep(
  s: ThreadState,
  ex: Extracted,
  text: string,
): boolean {
  if (ex.askTopic || (ex.askTopics?.length ?? 0) > 0) return false;
  if (ex.transition === 'want_visit' || ex.transition === 'want_details') return false;
  if ((ex.namedProjects?.length ?? 0) > 0) return false;
  if (ex.wantsMore || ex.rejected || ex.recall || ex.recallConstraints || ex.wantsHuman) {
    return false;
  }
  if (catalogAskOwns(ex, text)) return false;
  // Smash / smalltalk noise must not ride ask_next_step → cold orient.
  // Board/shortlist chrome is ask_next_step text, not filler — allow through.
  if (isNonPlaceUtterance(text) && !isAskNextStepText(text)) return false;

  const routing = s.rti?.lastRouting;
  if (routing?.routing === 'ask_next_step') return true;
  if (routing?.embedder_intent_kind === 'ask_next_step') return true;
  return isAskNextStepText(text);
}

export function resolveAskNextStepGoal(
  s: ThreadState,
  channel?: 'whatsapp' | 'advisor_web',
): TurnGoal {
  const board = currentShortlist(s);
  const token = discourseStateToken({
    phase: s.phase,
    focus: s.focus
      ? { project_id: s.focus.projectId, project_name: s.focus.projectName }
      : null,
    visit: s.visit
      ? {
          awaiting_confirm: !!s.visit.awaitingConfirm,
          project_id: s.visit.projectId,
          booked_count: s.visitBookedCache?.length,
        }
      : null,
    boardCount: board.length,
  });

  if (token === '<visit_pending>') {
    const v = s.visit;
    if (v?.awaitingConfirm && v.proposedIso && v.projectId) {
      const label = v.proposedLabel ?? 'that slot';
      const name = v.projectName ?? 'the project';
      return {
        kind: 'visit_propose',
        iso: v.proposedIso,
        label,
        projectName: name,
        projectId: v.projectId,
        copy: visitProposeConfirmCopy({ channel, label, projectName: name }),
        state: v,
      };
    }
    const projectId = v?.projectId ?? s.focus?.projectId;
    return projectId ? { kind: 'propose_visit', projectId } : { kind: 'propose_visit' };
  }

  if (token === '<focused>') {
    return { kind: 'advance', reason: 'same_set' };
  }

  if (token.startsWith('<board:')) {
    if (board.length >= 2) return { kind: 'clarify_project_pick' };
    if (board.length === 1) {
      return {
        kind: 'commit',
        projectId: board[0]!.projectId,
        projectName: board[0]!.name,
        followUp: 'overview',
      };
    }
  }

  // cold — never hardcode location when the brief already filled hard slots (A3).
  if (!s.discover.oriented) return { kind: 'orient' };
  const missing = firstMissingSlot(s);
  if (missing) return { kind: 'probe', slot: missing };
  return { kind: 'recommend' };
}
