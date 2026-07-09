/**
 * P2b — map NayaDesk turn_ledger `/context`.prior → TurnFeedForward,
 * then gap-fill ConversationState (never overwrite live KV).
 */
import { excerptReply } from './turn-intent/pending-prompt.js';
import type { PendingPrompt } from './turn-intent/types.js';
import type { ConversationState, FocusState, Phase } from './types.js';

export interface LedgerPriorRow {
  turn_index: number;
  composer: string;
  reply_text: string;
  offered_project_ids?: string[];
  disclosed_facts?: Array<Record<string, unknown>>;
  awaiting_response?: boolean;
  action_plan?: Record<string, unknown>;
  resolved_intent?: Record<string, unknown>;
  snapshot_in?: Record<string, unknown>;
}

export interface TurnFeedForward {
  priorTurnIndex: number;
  priorGoalKind?: string;
  priorTopics: string[];
  awaitingResponse: boolean;
  disclosedFacts: Array<Record<string, unknown>>;
  priorReplyExcerpt: string;
  pendingPrompt?: PendingPrompt;
  focus?: FocusState;
  phase?: Phase;
  offeredProjectIds: string[];
}

const PENDING_KINDS = new Set([
  'offer_project',
  'offer_pricing',
  'offer_widen',
  'binary_budget_or_area',
  'chip_menu',
  'location_broaden',
]);

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function asTopics(resolved: Record<string, unknown> | undefined): string[] {
  if (!resolved) return [];
  const raw = resolved.ask_topics;
  if (Array.isArray(raw)) {
    return raw.filter((t): t is string => typeof t === 'string' && t.length > 0);
  }
  const single = asString(resolved.ask_topic);
  return single ? [single] : [];
}

function parsePending(raw: unknown): PendingPrompt | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const kind = asString(o.kind);
  if (!kind || !PENDING_KINDS.has(kind)) return undefined;
  const asked = typeof o.asked_at_turn === 'number' ? o.asked_at_turn : 0;
  return {
    kind: kind as PendingPrompt['kind'],
    asked_at_turn: asked,
    ...(asString(o.project_id) ? { project_id: asString(o.project_id) } : {}),
    ...(asString(o.project_name) ? { project_name: asString(o.project_name) } : {}),
    ...(asString(o.topic) ? { topic: asString(o.topic) as PendingPrompt['topic'] } : {}),
    ...(asString(o.location_target) ? { location_target: asString(o.location_target) } : {}),
    ...(Array.isArray(o.chip_ids)
      ? { chip_ids: o.chip_ids.filter((id): id is string => typeof id === 'string') }
      : {}),
  };
}

function parseFocus(snapshot: Record<string, unknown> | undefined): FocusState | undefined {
  const focus = snapshot?.focus;
  if (!focus || typeof focus !== 'object' || Array.isArray(focus)) return undefined;
  const o = focus as Record<string, unknown>;
  const projectId = asString(o.project_id) ?? asString(o.projectId);
  const projectName = asString(o.name) ?? asString(o.project_name) ?? asString(o.projectName);
  if (!projectId || !projectName) return undefined;
  return { projectId, projectName };
}

function parsePhase(snapshot: Record<string, unknown> | undefined): Phase | undefined {
  const p = asString(snapshot?.phase);
  if (p === 'discover' || p === 'focused' || p === 'visit' || p === 'handoff') return p;
  return undefined;
}

/** Pure map: Desk prior JSON → feed-forward surface. */
export function mapLedgerPrior(prior: LedgerPriorRow | null | undefined): TurnFeedForward | null {
  if (!prior) return null;
  const action = prior.action_plan ?? {};
  const resolved = prior.resolved_intent ?? {};
  const snapshot = prior.snapshot_in ?? {};
  const goalKind = asString(action.kind);
  const topicFromPlan = asString(action.topic);
  const topics = asTopics(resolved);
  if (topicFromPlan && !topics.includes(topicFromPlan)) topics.unshift(topicFromPlan);

  const pending = parsePending(snapshot.pending_prompt);
  const focus = parseFocus(snapshot);
  const phase = parsePhase(snapshot);

  return {
    priorTurnIndex: prior.turn_index,
    ...(goalKind ? { priorGoalKind: goalKind } : {}),
    priorTopics: topics,
    awaitingResponse: prior.awaiting_response !== false,
    disclosedFacts: Array.isArray(prior.disclosed_facts) ? prior.disclosed_facts : [],
    priorReplyExcerpt: excerptReply(prior.reply_text ?? ''),
    ...(pending ? { pendingPrompt: pending } : {}),
    ...(focus ? { focus } : {}),
    ...(phase ? { phase } : {}),
    offeredProjectIds: Array.isArray(prior.offered_project_ids) ? prior.offered_project_ids : [],
  };
}

/**
 * Gap-fill only: live KV / in-memory state wins over ledger.
 * Restores RTI pending + reply excerpt + last goal when missing after cold start.
 */
export function hydrateStateFromFeedForward(
  state: ConversationState,
  ff: TurnFeedForward | null | undefined,
): ConversationState {
  if (!ff) return state;

  let next = state;
  const rti = { ...(next.rti ?? {}) };

  if (!rti.lastReplyExcerpt && ff.priorReplyExcerpt) {
    rti.lastReplyExcerpt = ff.priorReplyExcerpt;
  }
  if (!rti.lastGoalKind && ff.priorGoalKind) {
    rti.lastGoalKind = ff.priorGoalKind;
  }
  if (!rti.pendingPrompt && ff.pendingPrompt && ff.awaitingResponse) {
    rti.pendingPrompt = ff.pendingPrompt;
  }

  next = { ...next, rti, feedForward: ff };

  if (!next.focus && ff.focus) {
    next = { ...next, focus: ff.focus };
    if (next.phase === 'discover' && ff.phase === 'focused') {
      next = { ...next, phase: 'focused' };
    }
  }

  return next;
}
