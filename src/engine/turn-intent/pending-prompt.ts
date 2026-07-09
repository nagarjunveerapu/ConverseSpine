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
  if (ev.propertyTypeGap) return 'property_type_gap';
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
  if (goal.kind === 'clarify_project_pick') {
    return {
      kind: 'chip_menu',
      chip_ids: (evidence.matches ?? []).map((m) => m.projectId).slice(0, 3),
      asked_at_turn: turnCount,
    };
  }
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

  if (evidence.budgetGap?.closestProjectId) {
    const g = evidence.budgetGap;
    return {
      kind: 'offer_project',
      project_id: g.closestProjectId,
      project_name: g.closestName,
      chip_ids: chipIds,
      asked_at_turn: turnCount,
    };
  }

  if (evidence.propertyTypeGap?.closestProjectId) {
    const g = evidence.propertyTypeGap;
    return {
      kind: 'offer_project',
      project_id: g.closestProjectId,
      project_name: g.closestName,
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

export function defaultProbePrompt(
  kind: PendingPromptKind | undefined,
  channel: 'advisor_web' | 'whatsapp',
  chipCount = 0,
): string {
  if (kind === 'offer_project') {
    return 'Did you want me to open that project, or keep refining your search?';
  }
  if (kind === 'binary_budget_or_area') {
    return chipCount > 0
      ? 'Raise budget, or try another area? Pick an option below.'
      : 'Raise budget, or try another area?';
  }
  if (kind === 'location_broaden') {
    return chipCount > 0
      ? 'Want to search all Bangalore? Pick an option below or say yes.'
      : 'Want to search all Bangalore instead of this corridor?';
  }
  if (chipCount > 0) {
    return channel === 'whatsapp'
      ? 'Tap a button below or reply with what to change — area, budget, or property type.'
      : 'Tap a chip below or tell me what to change — area, budget, or property type.';
  }
  return 'Tell me what to change — area, budget, property type, or BHK.';
}

export function buildRtiStateUpdate(input: {
  goal: TurnGoal;
  evidence: EvidenceSet;
  searchRecovery?: SearchRecoveryEnvelope;
  reply: string;
  uiMode: AdvisorUiMode;
  turnCount: number;
  previousRti?: RtiState;
}): RtiState {
  const pendingPrompt = buildPendingPrompt(
    input.goal,
    input.evidence,
    input.searchRecovery,
    input.turnCount,
  );
  const successTurn =
    input.goal.kind === 'recommend' ||
    input.goal.kind === 'commit' ||
    input.goal.kind === 'advance' ||
    (input.evidence.matches?.length ?? 0) > 0;
  const suggestedActions = input.searchRecovery?.suggested_actions.length
    ? input.searchRecovery.suggested_actions
    : input.previousRti?.lastSuggestedActions;
  return {
    ...(!successTurn && pendingPrompt ? { pendingPrompt } : {}),
    ...(suggestedActions?.length ? { lastSuggestedActions: suggestedActions } : {}),
    lastGoalKind: input.goal.kind,
    lastEvidenceKind: evidenceKindFromEvidence(input.evidence),
    lastReplyExcerpt: excerptReply(input.reply),
    lastUiMode: input.uiMode,
  };
}
