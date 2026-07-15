import type { SuggestedAction } from '../recovery-planner.js';
import { constraintsFromAdvisorPreferences } from '../../advisor/apply-preferences.js';
import { commitTo, releaseToDiscover } from '../state.js';
import type { ConversationState } from '../types.js';
import { isBudgetFitQuestion, isCostComponentAsk } from '../facts.js';
import { hasExplicitProjectCue } from '../project_switch.js';
import { extractRecoveryPatchFromText } from './extract-recovery-patch.js';
import { classifyFocusedPivot, shouldRunFocusedTurnIntent } from './focused-intent.js';
import { isCompareAmongOfferedTurn } from './compare-intent.js';
import { isVisitFollowUpQuestion, isVisitRouteExpand } from '../phases/visit.js';
import { classifyTurnIntentLlm } from './llm-classifier.js';
import { defaultProbePrompt } from './pending-prompt.js';
import { AFFIRM_ONLY, DECLINE } from './dialogue-acts.js';
import type {
  PatchClearKey,
  TurnIntentApplyResult,
  TurnIntentInput,
  TurnIntentResult,
} from './types.js';

export { AFFIRM_ONLY, DECLINE } from './dialogue-acts.js';

/**
 * Closed dialogue affirm set (L2). Includes multi-word ("yeah sure") and Hinglish ("haan").
 * Must stay in sync with facts.ts AFFIRM for extract.affirm.
 */
const REFINE_CONTINUE =
  /\b(?:keep|continue)\s+refining(?:\s+(?:the|my))?\s+search\b|\brefine(?:\s+(?:the|my))?\s+search\b/i;
const LIST_AT_BUDGET =
  /\b(?:what|which)\s+options?\b.{0,40}\bbudget\b|\boptions?\s+(?:do you have|at|within|for)\b.{0,30}\bbudget\b/i;

/** Free-text that should re-run search/list — not contextual yes/no probe. */
export function shouldPassthroughRecoverySearch(text: string): boolean {
  const t = text.trim();
  if (REFINE_CONTINUE.test(t)) return true;
  if (LIST_AT_BUDGET.test(t)) return true;
  if (isBudgetFitQuestion(t)) return true;
  if (/\b(?:show|list|see)\s+(?:me\s+)?(?:the\s+)?options?\b/i.test(t)) return true;
  if (/\bwhat (?:do you have|can you find|is available)\b/i.test(t)) return true;
  // Name beats filters (#65): "tell me about Ayana" during recovery must reach the
  // main pipeline, where PROJECT_VECTORS resolve the name and commit focus. With
  // AB-2's honest no_fit on typed zero-matches, recovery chips are pending more
  // often — without this, a named-project ask that matches no chip fell into the
  // probe and the name was never honoured. Structural cue only, no catalog names.
  if (hasExplicitProjectCue(t)) return true;
  return false;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function matchAction(
  text: string,
  actions: readonly SuggestedAction[],
  actionId?: string,
  constraints?: import('../types.js').Constraints,
): SuggestedAction | null {
  if (actionId) {
    const fromList = actions.find((a) => a.id === actionId);
    if (fromList) return fromList;
    if (actionId === 'relax_bhk:drop' || actionId === 'clear_bhk') {
      return {
        id: actionId,
        label: 'Any configuration',
        patch: { bhk: '' },
        user_line: 'Show projects with any BHK configuration',
        expected_matches: 1,
      };
    }
  }
  const t = normalize(text);
  for (const a of actions) {
    if (normalize(a.label) === t || normalize(a.user_line) === t) return a;
    if (t.length >= 4 && normalize(a.label).includes(t)) return a;
  }
  const num = /^(\d)\.?$/.exec(t);
  if (num) {
    const idx = parseInt(num[1]!, 10) - 1;
    if (idx >= 0 && idx < actions.length) return actions[idx] ?? null;
  }
  return null;
}

function patchFromAction(action: SuggestedAction): TurnIntentResult {
  return {
    kind: 'apply_recovery_patch',
    confidence: 'rule',
    matched_action_id: action.id,
    patch: constraintsFromAdvisorPreferences(action.patch),
    patch_clear: patchClearFromPrefs(action.patch),
  };
}

function patchClearFromPrefs(patch: Record<string, string | undefined>): PatchClearKey[] | undefined {
  const clears: PatchClearKey[] = [];
  if ('bhk' in patch && !patch.bhk?.trim()) clears.push('bhk');
  if ('location' in patch && (!patch.location?.trim() || patch.location.toLowerCase() === 'open to suggestions')) {
    clears.push('location');
  }
  if ('property_type' in patch && !patch.property_type?.trim()) clears.push('propertyType');
  return clears.length ? clears : undefined;
}

function resolveProjectId(
  name: string,
  offered: TurnIntentInput['last_offered'],
): string | undefined {
  const n = name.toLowerCase();
  return offered.find((o) => o.name.toLowerCase().includes(n) || n.includes(o.name.toLowerCase()))?.project_id;
}

function ruleClassify(input: TurnIntentInput): TurnIntentResult | null {
  const pending = input.pending_prompt;
  const t = input.text.trim();

  // L2: pending offer_pricing affirm/decline before focused-pivot (e.g. "no thanks" ≠ broaden).
  if (pending?.kind === 'offer_pricing' && input.phase === 'focused') {
    if (DECLINE.test(t)) {
      return { kind: 'focused_question', confidence: 'rule' };
    }
    if (AFFIRM_ONLY.test(t)) {
      return {
        kind: 'focused_question',
        confidence: 'rule',
        ask_topic: pending.topic ?? 'price',
        ...(pending.project_id ? { focus_project_id: pending.project_id } : {}),
      };
    }
  }

  // Focused soft decline (incl. Hinglish) — stay on project; never invent locality / no_fit.
  // Must run before classifyFocusedPivot: extractLocation used to treat "nahi chahiye" as a place.
  if (input.phase === 'focused' && DECLINE.test(t)) {
    return { kind: 'focused_question', confidence: 'rule' };
  }

  const focusedPivot = classifyFocusedPivot(input);
  if (focusedPivot) return focusedPivot;

  const actions = input.suggested_actions;
  const chip = matchAction(input.text, actions, input.action_id, input.constraints);
  if (chip) return patchFromAction(chip);

  if (DECLINE.test(t)) {
    return { kind: 'reject_and_widen', confidence: 'rule' };
  }

  if (REFINE_CONTINUE.test(t)) {
    return { kind: 'continue_search', confidence: 'rule' };
  }

  if (shouldPassthroughRecoverySearch(t)) {
    return { kind: 'continue_search', confidence: 'rule' };
  }

  const recoveryPatch = extractRecoveryPatchFromText(t, input.ui_mode);
  if (recoveryPatch && !AFFIRM_ONLY.test(t)) return recoveryPatch;

  if (
    /^budget\.?$/i.test(t) &&
    (input.ui_mode === 'search_recovery' || input.ui_mode === 'preference_refine')
  ) {
    return {
      kind: 'probe',
      confidence: 'rule',
      probe_prompt: 'What budget should I search up to? e.g. ₹1 Cr or ₹3 Cr.',
    };
  }

  if (AFFIRM_ONLY.test(t)) {
    if (pending?.kind === 'offer_project') {
      const pid =
        pending.project_id ??
        (pending.project_name ? resolveProjectId(pending.project_name, input.last_offered) : undefined);
      if (pid) {
        return {
          kind: 'confirm_suggestion',
          confidence: 'rule',
          focus_project_id: pid,
        };
      }
    }
    // P4-CTA: bare yes after focused availability CTA → price on same focus.
    if (pending?.kind === 'offer_pricing' && input.phase === 'focused') {
      return {
        kind: 'focused_question',
        confidence: 'rule',
        ask_topic: pending.topic ?? 'price',
        ...(pending.project_id ? { focus_project_id: pending.project_id } : {}),
      };
    }
    if (pending?.kind === 'location_broaden') {
      return {
        kind: 'apply_recovery_patch',
        confidence: 'rule',
        patch: { location: pending.location_target ?? 'Bangalore' },
      };
    }
    return {
      kind: 'probe',
      confidence: 'rule',
      probe_prompt: defaultProbePrompt(pending?.kind, input.channel, actions.length),
    };
  }

  for (const o of input.last_offered) {
    if (input.phase === 'visit') continue;
    if (t.toLowerCase().includes(o.name.toLowerCase())) {
      return {
        kind: 'ask_named_project',
        confidence: 'extractor',
        focus_project_id: o.project_id,
      };
    }
  }

  return null;
}

export function shouldRunTurnIntent(state: ConversationState, actionId?: string, text?: string): boolean {
  if (text && isCompareAmongOfferedTurn(text)) return false;
  if (actionId) return true;
  if (state.postVisitAckPending) return false;
  // Visit queue owns scheduling — RTI must not commit focus or recovery mid-visit.
  if (state.phase === 'visit') {
    if (text && (isVisitFollowUpQuestion(text) || isVisitRouteExpand(text))) return false;
    return false;
  }
  if (state.phase === 'focused') {
    // W7: a cost-sheet ask (stamp duty, registration charges, GST) while focused
    // is a facet question about the focus — answer it on the pricing evidence via
    // the main pipeline, never divert to a search-recovery probe. Placed BEFORE
    // the pendingPrompt branch ON PURPOSE: an explicit cost question takes
    // precedence over a pending CTA (offer_pricing / hold / visit digression) —
    // the buyer's question is answered and the pending offer still stands. Do not
    // move below pendingPrompt without re-soaking HOLD / offer_pricing digression.
    if (text && isCostComponentAsk(text)) return false;
    if (text && DECLINE.test(text.trim())) return true;
    if (state.rti?.pendingPrompt) {
      const pending = state.rti.pendingPrompt;
      // SA-3 / P4-CTA: offer_pricing only binds bare affirm/decline.
      // "what sizes for 2 BHK?" must reach extract → listUnits, not the pricing probe.
      if (pending.kind === 'offer_pricing' && text) {
        const t = text.trim();
        if (AFFIRM_ONLY.test(t) || DECLINE.test(t)) return true;
        return Boolean(shouldRunFocusedTurnIntent(state, text, actionId));
      }
      return true;
    }
    return Boolean(text && shouldRunFocusedTurnIntent(state, text, actionId));
  }
  if (text && shouldRunFocusedTurnIntent(state, text, actionId)) return true;
  const mode = state.rti?.lastUiMode;
  if (mode === 'search_recovery' || mode === 'preference_refine') return true;
  if (state.rti?.lastGoalKind === 'no_fit') return true;
  if (state.rti?.pendingPrompt) return true;
  return false;
}

export function focusedUiMode(state: ConversationState): TurnIntentInput['ui_mode'] {
  if (state.phase === 'focused') return 'focused';
  return recoveryUiMode(state);
}

export function recoveryUiMode(state: ConversationState): TurnIntentInput['ui_mode'] {
  if (state.rti?.lastUiMode === 'preference_refine') return 'preference_refine';
  if (
    state.rti?.lastUiMode === 'search_recovery' ||
    state.rti?.lastGoalKind === 'no_fit' ||
    state.rti?.pendingPrompt
  ) {
    return 'search_recovery';
  }
  return state.rti?.lastUiMode ?? 'brief_collect';
}

export async function classifyTurnIntent(
  env: import('../../env.js').Env,
  input: TurnIntentInput,
): Promise<TurnIntentResult> {
  const ruled = ruleClassify(input);
  if (ruled) return ruled;

  const llm = await classifyTurnIntentLlm(env, input);
  if (llm) return llm;

  return {
    kind: 'unknown',
    confidence: 'abstain',
    probe_prompt: defaultProbePrompt(input.pending_prompt?.kind, input.channel, input.suggested_actions.length),
  };
}

export function applyTurnIntentResult(
  state: ConversationState,
  intent: TurnIntentResult,
  actions: readonly SuggestedAction[],
): TurnIntentApplyResult {
  const clearedKeys = new Set<PatchClearKey>();

  if (intent.patch_clear?.length) {
    for (const k of intent.patch_clear) clearedKeys.add(k);
  }

  if (intent.matched_action_id) {
    const action = actions.find((a) => a.id === intent.matched_action_id);
    if (action) {
      const prefsClears = patchClearFromPrefs(action.patch);
      prefsClears?.forEach((k) => clearedKeys.add(k));
    }
  }

  let next = { ...state, constraints: { ...state.constraints } };

  for (const key of clearedKeys) {
    if (key === 'bhk') delete next.constraints.bhk;
    if (key === 'location') delete next.constraints.location;
    if (key === 'propertyType') delete next.constraints.propertyType;
    if (key === 'budget') {
      delete next.constraints.budgetMaxInr;
      delete next.constraints.budgetMinInr;
    }
  }

  if (intent.patch) {
    next = {
      ...next,
      constraints: { ...next.constraints, ...intent.patch },
    };
  }

  if (intent.matched_action_id) {
    const action = actions.find((a) => a.id === intent.matched_action_id);
    if (action) {
      const fromPatch = constraintsFromAdvisorPreferences(action.patch);
      next = {
        ...next,
        constraints: { ...next.constraints, ...fromPatch },
      };
    }
  }

  if (intent.kind === 'confirm_suggestion' || intent.kind === 'ask_named_project') {
    const pid = intent.focus_project_id;
    if (pid) {
      const name =
        next.discover.lastOffered.find((o) => o.projectId === pid)?.name ??
        next.rti?.pendingPrompt?.project_name ??
        pid;
      next = commitTo(next, pid, name);
      next = {
        ...next,
        rti: {
          ...next.rti,
          pendingPrompt: undefined,
        },
      };
      return { state: next, clearedKeys, focusCommitted: { projectId: pid, projectName: name } };
    }
  }

  if (intent.kind === 'apply_recovery_patch') {
    next = {
      ...next,
      rti: {
        ...next.rti,
        pendingPrompt: undefined,
      },
    };
  }

  if (intent.kind === 'probe' || intent.kind === 'unknown') {
    return {
      state: next,
      clearedKeys,
      probeReply:
        intent.probe_prompt ??
        defaultProbePrompt(next.rti?.pendingPrompt?.kind, 'advisor_web', actions.length),
    };
  }

  if (intent.kind === 'reject_and_widen' || intent.kind === 'continue_search') {
    next = {
      ...next,
      rti: {
        ...next.rti,
        pendingPrompt: undefined,
      },
    };
    return { state: next, clearedKeys };
  }

  if (intent.kind === 'release_focus' || intent.kind === 'broaden_constraints') {
    next = releaseToDiscover(next);
    next = {
      ...next,
      rti: {
        ...next.rti,
        pendingPrompt: undefined,
        lastUiMode: 'matches_hub',
      },
    };
    return { state: next, clearedKeys, releasedFocus: true };
  }

  if (intent.kind === 'focused_question') {
    next = {
      ...next,
      rti: {
        ...next.rti,
        pendingPrompt: undefined,
      },
    };
    // Decline of offer_pricing: stay focused, no seed topic — overview/ack via normal decide.
    return {
      state: next,
      clearedKeys,
      ...(intent.ask_topic ? { seedAskTopic: intent.ask_topic } : {}),
    };
  }

  return { state: next, clearedKeys };
}

export function buildTurnIntentInput(
  state: ConversationState,
  text: string,
  channel: TurnIntentInput['channel'],
  uiMode: TurnIntentInput['ui_mode'],
  actionId?: string,
): TurnIntentInput {
  const rti = state.rti;
  const recent = (state.discover.recentMessages ?? []).slice(-4).map((m) => ({
    role: m.role,
    text: m.text,
  }));
  return {
    text,
    channel,
    phase: state.phase,
    ui_mode: uiMode,
    constraints: state.constraints,
    last_goal_kind: rti?.lastGoalKind ?? state.feedForward?.priorGoalKind ?? 'recommend',
    last_evidence_kind: rti?.lastEvidenceKind,
    last_reply_excerpt: rti?.lastReplyExcerpt ?? state.feedForward?.priorReplyExcerpt ?? '',
    pending_prompt: rti?.pendingPrompt ?? state.feedForward?.pendingPrompt,
    suggested_actions: rti?.lastSuggestedActions ?? [],
    last_offered: state.discover.lastOffered.map((o) => ({
      project_id: o.projectId,
      name: o.name,
    })),
    recent_turns: recent,
    action_id: actionId,
  };
}
