import { constraintsFromAdvisorPreferences } from '../../advisor/apply-preferences.js';
import { parseBudgetToInr } from '../facts.js';
import type { SuggestedAction } from '../recovery-planner.js';
import { commitTo } from '../state.js';
import type { ConversationState } from '../types.js';
import { classifyTurnIntentLlm } from './llm-classifier.js';
import { defaultProbePrompt } from './pending-prompt.js';
import type {
  PatchClearKey,
  TurnIntentApplyResult,
  TurnIntentInput,
  TurnIntentResult,
} from './types.js';

const AFFIRM_ONLY = /^(?:yes|yeah|yep|yup|ok(?:ay)?|sure|haan?|theek|done|confirm(?:ed)?|go ahead|sounds good|perfect|great)\.?!?\s*$/i;
const DECLINE = /^(?:no|nope|nah|not that|not this|something else)\.?!?\s*$/i;

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function matchAction(
  text: string,
  actions: readonly SuggestedAction[],
  actionId?: string,
): SuggestedAction | null {
  if (actionId) {
    return actions.find((a) => a.id === actionId) ?? null;
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
  const actions = input.suggested_actions;
  const chip = matchAction(input.text, actions, input.action_id);
  if (chip) return patchFromAction(chip);

  const pending = input.pending_prompt;
  const t = input.text.trim();

  if (DECLINE.test(t)) {
    return { kind: 'reject_and_widen', confidence: 'rule' };
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
    return {
      kind: 'probe',
      confidence: 'rule',
      probe_prompt: defaultProbePrompt(pending?.kind, input.channel),
    };
  }

  for (const o of input.last_offered) {
    if (t.toLowerCase().includes(o.name.toLowerCase())) {
      return {
        kind: 'ask_named_project',
        confidence: 'extractor',
        focus_project_id: o.project_id,
      };
    }
  }

  const budget = parseBudgetToInr(t);
  if (budget && /\b(?:any|open)\b/i.test(t) && /\b(?:apartment|villa|bhk|config)/i.test(t)) {
    const patch: TurnIntentResult['patch'] = {
      budgetMaxInr: budget.max,
      ...(budget.min !== undefined ? { budgetMinInr: budget.min } : {}),
    };
    const patch_clear: PatchClearKey[] = [];
    if (/\bany\b/i.test(t) && /\b(?:apartment|villa|config|bhk)\b/i.test(t)) patch_clear.push('bhk');
    if (/\bapartment/i.test(t)) patch.propertyType = 'Apartment';
    if (/\bvilla/i.test(t)) patch.propertyType = 'Villa';
    return {
      kind: 'apply_recovery_patch',
      confidence: 'extractor',
      patch,
      ...(patch_clear.length ? { patch_clear } : {}),
    };
  }

  return null;
}

export function shouldRunTurnIntent(
  uiMode: TurnIntentInput['ui_mode'],
  actionId?: string,
): boolean {
  if (actionId) return true;
  return uiMode === 'search_recovery' || uiMode === 'preference_refine';
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
    probe_prompt: defaultProbePrompt(input.pending_prompt?.kind, input.channel),
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
      return { state: next, clearedKeys, focusCommitted: { projectId: pid, projectName: name } };
    }
  }

  if (intent.kind === 'probe' || intent.kind === 'unknown') {
    return {
      state: next,
      clearedKeys,
      probeReply: intent.probe_prompt ?? defaultProbePrompt(next.rti?.pendingPrompt?.kind, 'advisor_web'),
    };
  }

  if (intent.kind === 'reject_and_widen') {
    return { state: next, clearedKeys };
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
    last_goal_kind: rti?.lastGoalKind ?? 'recommend',
    last_evidence_kind: rti?.lastEvidenceKind,
    last_reply_excerpt: rti?.lastReplyExcerpt ?? '',
    pending_prompt: rti?.pendingPrompt,
    suggested_actions: rti?.lastSuggestedActions ?? [],
    last_offered: state.discover.lastOffered.map((o) => ({
      project_id: o.projectId,
      name: o.name,
    })),
    recent_turns: recent,
    action_id: actionId,
  };
}
