import type { AdvisorUiMode, SuggestedAction } from '../recovery-planner.js';
import type { Constraints, Phase } from '../types.js';

export type TurnIntentChannel = 'advisor_web' | 'whatsapp';

export type PendingPromptKind =
  | 'offer_project'
  | 'offer_widen'
  | 'binary_budget_or_area'
  | 'chip_menu';

export interface PendingPrompt {
  kind: PendingPromptKind;
  project_id?: string;
  project_name?: string;
  chip_ids?: string[];
  asked_at_turn: number;
}

export type TurnIntentKind =
  | 'apply_recovery_patch'
  | 'confirm_suggestion'
  | 'probe'
  | 'ask_named_project'
  | 'reject_and_widen'
  | 'compare_among_offered'
  | 'continue_brief'
  | 'focused_question'
  | 'unknown';

export type TurnIntentConfidence = 'rule' | 'extractor' | 'llm' | 'abstain';

export type PatchClearKey = 'bhk' | 'location' | 'propertyType' | 'budget';

export interface TurnIntentResult {
  kind: TurnIntentKind;
  confidence: TurnIntentConfidence;
  patch?: Partial<Constraints>;
  patch_clear?: PatchClearKey[];
  focus_project_id?: string;
  matched_action_id?: string;
  probe_prompt?: string;
}

export interface RtiState {
  pendingPrompt?: PendingPrompt;
  lastSuggestedActions?: SuggestedAction[];
  lastGoalKind?: string;
  lastEvidenceKind?: 'constraint_gap' | 'budget_gap' | 'matches' | 'floor';
  lastReplyExcerpt?: string;
  lastUiMode?: AdvisorUiMode;
}

export interface TurnIntentInput {
  text: string;
  channel: TurnIntentChannel;
  phase: Phase;
  ui_mode: AdvisorUiMode;
  constraints: Constraints;
  last_goal_kind: string;
  last_evidence_kind?: RtiState['lastEvidenceKind'];
  last_reply_excerpt: string;
  pending_prompt?: PendingPrompt;
  suggested_actions: SuggestedAction[];
  last_offered: Array<{ project_id: string; name: string }>;
  recent_turns: Array<{ role: 'buyer' | 'bot'; text: string }>;
  action_id?: string;
}

export interface TurnIntentApplyResult {
  state: import('../types.js').ConversationState;
  clearedKeys: Set<PatchClearKey>;
  /** When set, skip normal goal pipeline and return this reply with stored recovery. */
  probeReply?: string;
  focusCommitted?: { projectId: string; projectName: string };
}
