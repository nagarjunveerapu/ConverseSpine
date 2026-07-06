import type { EvidenceSet, TurnGoal } from '../types.js';
import type { AdvisorUiMode, SearchRecoveryEnvelope } from '../recovery-planner.js';
import type { PendingPrompt, PendingPromptKind, RtiState } from './types.js';

export function excerptReply(reply: string, max = 200): string {
  const flat = reply.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

export function evidenceKindFromEvidence(
  ev: EvidenceSet,
): RtiState['lastEvidenceKind'] | undefined {
  if (ev.constraintGap) return 'constraint_gap';
  if (ev.budgetGap) return 'budget_gap';
  if (ev.floor) return 'floor';
  if (ev.matches?.length) return 'matches';
  return undefined;
}

/** Infer what the bot asked — drives contextual yes/no. */
export function buildPendingPrompt(
  goal: TurnGoal,
  evidence: EvidenceSet,
  searchRecovery: SearchRecoveryEnvelope | undefined,
  turnCount: number,
): PendingPrompt | undefined {
  if (goal.kind !== 'no_fit' && !searchRecovery) return undefined;

  const chipIds = searchRecovery?.suggested_actions.map((a) => a.id) ?? [];

  if (evidence.constraintGap?.alternateProject) {
    const g = evidence.constraintGap;
    return {
      kind: 'offer_project',
      project_id: g.alternateProjectId,
      project_name: g.alternateProject,
      chip_ids: chipIds,
      asked_at_turn: turnCount,
    };
  }

  if (evidence.budgetGap) {
    return {
      kind: 'binary_budget_or_area',
      chip_ids: chipIds,
      asked_at_turn: turnCount,
    };
  }

  if (searchRecovery?.suggested_actions.length) {
    return {
      kind: chipIds.length ? 'chip_menu' : 'offer_widen',
      chip_ids: chipIds,
      asked_at_turn: turnCount,
    };
  }

  if (goal.kind === 'no_fit') {
    return {
      kind: 'offer_widen',
      chip_ids: chipIds,
      asked_at_turn: turnCount,
    };
  }

  return undefined;
}

export function defaultProbePrompt(kind: PendingPromptKind | undefined, channel: 'advisor_web' | 'whatsapp'): string {
  if (kind === 'offer_project') {
    return 'Did you want me to open that project, or keep refining your search?';
  }
  if (kind === 'binary_budget_or_area') {
    return 'Raise budget, or try another area? Pick an option below.';
  }
  if (channel === 'whatsapp') {
    return 'Tap a button below or reply with what to change — BHK, budget, or area.';
  }
  return 'Tap a chip below or tell me what to change — BHK, budget, or area.';
}

export function buildRtiStateUpdate(input: {
  goal: TurnGoal;
  evidence: EvidenceSet;
  searchRecovery?: SearchRecoveryEnvelope;
  reply: string;
  uiMode: AdvisorUiMode;
  turnCount: number;
}): RtiState {
  const pendingPrompt = buildPendingPrompt(
    input.goal,
    input.evidence,
    input.searchRecovery,
    input.turnCount,
  );
  return {
    ...(pendingPrompt ? { pendingPrompt } : {}),
    ...(input.searchRecovery?.suggested_actions.length
      ? { lastSuggestedActions: input.searchRecovery.suggested_actions }
      : {}),
    lastGoalKind: input.goal.kind,
    lastEvidenceKind: evidenceKindFromEvidence(input.evidence),
    lastReplyExcerpt: excerptReply(input.reply),
    lastUiMode: input.uiMode,
  };
}
