import type { ConversationState, TurnDebug } from '../engine/types.js';
import type { SearchRecoveryEnvelope } from '../engine/recovery-planner.js';

export type AdvisorUiMode =
  | 'brief_collect'
  | 'search_recovery'
  | 'preference_refine'
  | 'matches_hub'
  | 'focused';
import type { AdvisorProjectDetailDto } from './map-project-detail.js';

export interface AdvisorTurnRequest {
  session_id: string;
  text?: string;
  message?: string;
  buyer_phone?: string;
  builder_id?: string;
  conversation_id?: string;
  preferences?: Record<string, string | undefined>;
  /** Active project from the advisor board — sets focused phase before this turn. */
  project_id?: string;
  project_name?: string;
  /** Recovery chip tap — deterministic RTI fast path. */
  action_id?: string;
}

export interface AdvisorProjectCard {
  id: string;
  name: string;
  micro_market: string;
  price_label: string;
  source_builder_id?: string;
}

export interface AdvisorTurnResponse {
  status: 'ok' | 'error';
  session_id: string;
  reply: string;
  conversation_id: string;
  nd_conversation_id?: string;
  projects?: AdvisorProjectCard[];
  shortlist?: string[];
  prefs_snapshot?: Record<string, string | undefined>;
  phase?: string;
  focused_project?: AdvisorProjectDetailDto;
  visit_booked?: {
    project_id: string;
    project_name: string;
    label: string;
    iso: string;
  };
  /** Authoritative multi-stop visit queue while phase=visit (WhatsApp + advisor_web). */
  visit_queue?: {
    active?: { project_id: string; project_name: string };
    queued: Array<{ project_id: string; project_name: string }>;
    awaiting_confirm?: boolean;
    proposed_label?: string;
  };
  /** Full route with consent states — booked + proposed + queued. */
  visit_itinerary?: import('./map-visit-itinerary.js').AdvisorVisitItinerary;
  compare_matrix?: {
    projects: Array<{ project_id: string; name: string }>;
    rows: Array<{ key?: string; label: string; values: readonly string[] }>;
  };
  /** Server-derived UI mode for chips / composer gating. */
  ui_mode?: AdvisorUiMode;
  /** Catalog-backed recovery or widen actions (max 3 on WhatsApp). */
  search_recovery?: SearchRecoveryEnvelope;
  debug?: Pick<TurnDebug, 'goal' | 'tools' | 'phase' | 'grounding'>;
  error?: string;
}

export interface AdvisorProjectDetailResponse {
  status: 'ok' | 'error';
  project?: AdvisorProjectDetailDto;
  live?: boolean;
  error?: string;
}

export interface AdvisorMapInput {
  sessionId: string;
  state: ConversationState;
  reply: string;
  debug: TurnDebug;
  compareMatrix?: {
    projects: Array<{ project_id: string; name: string }>;
    rows: Array<{ key?: string; label: string; values: readonly string[] }>;
  };
  searchRecovery?: SearchRecoveryEnvelope;
  uiMode?: AdvisorUiMode;
}
