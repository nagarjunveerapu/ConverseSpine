/**
 * Hybrid latency/quality gate — ≤20% paid DeepSeek; templates otherwise.
 * See docs/lld/HYBRID_LATENCY_LLD.md
 */
import type { Env } from '../env.js';
import type { ThreadState, TurnGoal } from './types.js';
import type { Extracted } from './types.js';
import type { EvidenceSet } from './types.js';

export type HybridMode = 'off' | 'on';

export function resolveHybridMode(env: Pick<Env, 'HYBRID_COMPOSE'>): HybridMode {
  const raw = (env.HYBRID_COMPOSE ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === '0' || raw === 'false') return 'off';
  if (raw === 'on' || raw === '1' || raw === 'true') return 'on';
  // Default on when unset in eng — callers pass explicit wrangler default.
  return raw === '' ? 'on' : 'off';
}

export function paidLlmTimeoutMs(env: Pick<Env, 'PAID_LLM_TIMEOUT_MS'>): number {
  const n = Number(env.PAID_LLM_TIMEOUT_MS ?? '1200');
  return Number.isFinite(n) && n >= 200 ? Math.min(n, 8000) : 1200;
}

export function llmRateTarget(env: Pick<Env, 'LLM_RATE_TARGET'>): number {
  const n = Number(env.LLM_RATE_TARGET ?? '0.2');
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.2;
}

/** Conversation soft-cap: force template when recent LLM share exceeds target. */
export function llmRateExceeded(state: ThreadState, target: number): boolean {
  const turns = Math.max(1, state.turnCount);
  const used = state.llmUsedCount ?? 0;
  // Before this turn completes: if past usage already over target, shed.
  return used / turns > target;
}

/**
 * High-confidence goals that must stay on voice templates under hybrid
 * (in addition to existing templateLocked).
 */
export function hybridPreferTemplate(
  goal: TurnGoal,
  evidence: EvidenceSet,
  ex: Extracted,
): boolean {
  if (ex.objection) return true;
  if (goal.kind === 'greet' || goal.kind === 'orient' || goal.kind === 'probe') return true;
  if (goal.kind === 'objection' || goal.kind === 'handoff' || goal.kind === 'smalltalk') return true;
  if (goal.kind === 'recommend' || goal.kind === 'ack_reject_recommend') return true;
  if (goal.kind === 'answer') {
    if (goal.topic === 'price' && (evidence.pricing || evidence.landedCost || evidence.detail)) {
      return true;
    }
    if (goal.topic === 'overview' && evidence.detail) return true;
  }
  return false;
}

/** Confidence floor — allow a paid call when extract is still thin. */
export function needsPaidLlmFloor(ex: Extracted, goal: TurnGoal): boolean {
  if (ex.objection || ex.stop || ex.wantsHuman) return false;
  if (ex.speechAct === 'greet' || ex.speechAct === 'stop' || ex.speechAct === 'handoff') return false;
  if (goal.kind === 'clarify_intent' && (ex.speechAct === 'unknown' || !ex.speechAct)) return true;
  if (ex.speechAct === 'unknown' || !ex.speechAct) {
    if (!ex.askTopics?.length && !ex.askTopic && !ex.transition) return true;
  }
  if (
    goal.kind === 'answer' &&
    goal.topic !== 'overview' &&
    goal.topic !== 'price' &&
    goal.topic !== 'availability' &&
    goal.topic !== 'legal' &&
    goal.topic !== 'media' &&
    goal.topic !== 'location'
  ) {
    return true;
  }
  return false;
}
