import type { ConversationState } from '../engine/types.js';

export interface AdvisorVisitStop {
  project_id: string;
  project_name: string;
}

/** Server visit queue — same shape for advisor_web and WhatsApp (no board on WA). */
export interface AdvisorVisitQueue {
  active?: AdvisorVisitStop;
  queued: AdvisorVisitStop[];
  awaiting_confirm?: boolean;
  proposed_label?: string;
}

export function mapVisitQueue(state: ConversationState): AdvisorVisitQueue | undefined {
  if (state.phase !== 'visit' && !state.visit?.projectId) return undefined;

  const v = state.visit;
  if (!v?.projectId && !(v?.queued?.length ?? 0)) return undefined;

  const queued = (v?.queued ?? []).map((q) => ({
    project_id: q.projectId,
    project_name: q.projectName,
  }));

  const active =
    v?.projectId && v.projectName
      ? { project_id: v.projectId, project_name: v.projectName }
      : undefined;

  return {
    ...(active ? { active } : {}),
    queued,
    ...(v?.awaitingConfirm ? { awaiting_confirm: true } : {}),
    ...(v?.proposedLabel ? { proposed_label: v.proposedLabel } : {}),
  };
}

/** Ordered route: active stop then queued — mirrors WhatsApp sequential scheduling. */
export function visitRouteProjectIds(queue: AdvisorVisitQueue): string[] {
  const ids: string[] = [];
  if (queue.active) ids.push(queue.active.project_id);
  for (const q of queue.queued) ids.push(q.project_id);
  return ids;
}
