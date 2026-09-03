import type { AdvisorUiMode, SuggestedAction } from '../recovery-planner.js';
import type { Constraints, Phase } from '../types.js';

export type TurnIntentChannel = 'advisor_web' | 'whatsapp';

export type PendingPromptKind =
  | 'offer_project'
  | 'offer_pricing'
  | 'offer_widen'
  | 'binary_budget_or_area'
  | 'chip_menu'
  | 'location_broaden';

export interface PendingPrompt {
  kind: PendingPromptKind;
  project_id?: string;
  project_name?: string;
  /** For offer_pricing — topic to seed on bare affirm (usually price). */
  topic?: import('../types.js').AnswerTopic;
  /**
   * The offer promised the ALL-IN cost, not the headline price. A bare "yes"
   * to "shall I work out the all-in figure?" has to reach the cost sheet —
   * answering it with the sticker price is not the thing that was offered.
   */
  breakdown?: boolean;
  /**
   * The forks the question actually offered, in the order they were spoken.
   * A two-way question ("loan eligibility, or the configs?") can be answered
   * with "both", "neither", "the second one", or by naming a fork — none of
   * which is a bare yes. Without this the bot hears only "yes" and answers
   * everything else with a photocopy of its own last message.
   */
  options?: ReadonlyArray<import('../types.js').AnswerTopic>;
  location_target?: string;
  chip_ids?: string[];
  asked_at_turn: number;
}

export type TurnIntentKind =
  | 'apply_recovery_patch'
  | 'confirm_suggestion'
  | 'probe'
  | 'ask_named_project'
  | 'reject_and_widen'
  | 'continue_search'
  | 'compare_among_offered'
  | 'continue_brief'
  | 'focused_question'
  | 'release_focus'
  | 'broaden_constraints'
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
  /** focused_question — seed askTopic after RTI (e.g. price after offer_pricing). */
  ask_topic?: import('../types.js').AnswerTopic;
}

export interface RtiState {
  pendingPrompt?: PendingPrompt;
  lastSuggestedActions?: SuggestedAction[];
  lastGoalKind?: string;
  lastEvidenceKind?: 'constraint_gap' | 'budget_gap' | 'property_type_gap' | 'matches' | 'floor';
  lastReplyExcerpt?: string;
  lastUiMode?: AdvisorUiMode;
  lastRouting?: import('../turn-routing/types.js').TurnRoutingResult;
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
  state: import('../types.js').ThreadState;
  clearedKeys: Set<PatchClearKey>;
  /** When set, skip normal goal pipeline and return this reply with stored recovery. */
  probeReply?: string;
  focusCommitted?: { projectId: string; projectName: string };
  /** Focus released — re-run discover/recommend, do not answer@focus. */
  releasedFocus?: boolean;
  /** Seed extract askTopic after RTI (P4-CTA offer_pricing → yes). */
  seedAskTopic?: import('../types.js').AnswerTopic;
}
