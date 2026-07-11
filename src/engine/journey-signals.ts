/**
 * Map Spine turn outcomes → NayaDesk journey SignalEnvelope (closed vocabulary).
 * Desk Zod strips unknown keys (phase/goal/committed_project_id) — this is the adapter.
 */
import type { ConversationState, EvidenceSet, TurnGoal } from './types.js';

export type DeskJourneySignals = {
  facts_known?: number;
  goal_known?: boolean;
  recommendation_served?: boolean;
  projects_compared?: number;
  project_committed?: boolean;
  project_rejected?: boolean;
  visit_booked?: boolean;
  visit_date?: string;
};

export type JourneySignalPost = {
  signals: DeskJourneySignals;
  shortlistAdd?: string[];
  rejectedAdd?: string[];
};

function constraintFactCount(c: ConversationState['constraints']): number {
  let n = 0;
  if (c.location) n++;
  if (c.budgetMaxInr != null) n++;
  if (c.bhk) n++;
  if (c.propertyType) n++;
  if (c.purpose) n++;
  return n;
}

/** Pure mapper — unit-tested; used by syncTelemetry only. */
export function buildJourneySignalPost(
  goal: TurnGoal,
  state: ConversationState,
  evidence: EvidenceSet,
): JourneySignalPost {
  const signals: DeskJourneySignals = {};
  const facts = constraintFactCount(state.constraints);
  if (facts > 0) signals.facts_known = facts;
  if (facts >= 2 || (state.constraints.location && state.constraints.budgetMaxInr != null)) {
    signals.goal_known = true;
  }

  let shortlistAdd: string[] | undefined;
  let rejectedAdd: string[] | undefined;

  if (
    (goal.kind === 'recommend' || goal.kind === 'ack_reject_recommend') &&
    (evidence.matches?.length ?? 0) > 0
  ) {
    signals.recommendation_served = true;
    shortlistAdd = evidence.matches!.map((m) => m.projectId);
  }

  if (goal.kind === 'answer' && (goal.topic === 'compare' || goal.topics?.includes('compare'))) {
    const n = Math.max(
      state.discover.discussedProjects?.length ?? 0,
      state.discover.lastOffered.length,
      2,
    );
    signals.projects_compared = n;
  } else if ((state.discover.discussedProjects?.length ?? 0) >= 2) {
    // Soft signal when buyer has engaged 2+ projects even without compare goal this turn.
    signals.projects_compared = state.discover.discussedProjects!.length;
  }

  if (goal.kind === 'commit') {
    signals.project_committed = true;
    shortlistAdd = [goal.projectId, ...(shortlistAdd ?? [])];
  }

  if (goal.kind === 'answer' && state.focus) {
    // Focused Q&A implies shortlist engagement.
    shortlistAdd = [...new Set([state.focus.projectId, ...(shortlistAdd ?? [])])];
  }

  if (goal.kind === 'visit_booked') {
    signals.visit_booked = true;
    if (goal.iso) signals.visit_date = goal.iso.slice(0, 10);
  }

  if (goal.kind === 'propose_visit' || goal.kind === 'visit_ask' || goal.kind === 'visit_propose') {
    // Keep stage path toward visit_planning via commit/shortlist; booking still owns visit_booked.
    if (state.focus) signals.project_committed = signals.project_committed ?? true;
  }

  const rejected = state.discover.rejectedProjectIds;
  if (rejected.length) {
    signals.project_rejected = true;
    rejectedAdd = [rejected[rejected.length - 1]!];
  }

  return {
    signals,
    ...(shortlistAdd?.length ? { shortlistAdd: [...new Set(shortlistAdd)] } : {}),
    ...(rejectedAdd?.length ? { rejectedAdd } : {}),
  };
}

/** Desk profile observations reject provenance "extractor" — map to closed enum. */
export function deskFactProvenance(
  source: 'regex' | 'classifier' | 'brain' | 'buyer_correction' = 'regex',
): 'regex' | 'classifier' | 'brain' | 'buyer_correction' {
  return source;
}
