export type ComposerKind =
  | 'template:list'
  | 'template:pricing'
  | 'template:visit_confirm'
  | 'template:visit_ask_day'
  | 'template:greeting'
  | 'template:legal'
  | 'template:objection'
  | 'template:detail'
  | 'template:welcome_list'
  | 'template:returning_greeting'
  | 'template:compare'
  | 'template:compare_advice'
  | 'template:media'
  | 'template:units'
  | 'llm'
  | 'early_exit:ack';

export interface ConversationRow {
  id: string;
  buyer_phone: string;
  builder_id: string;
  budget: string | null;
  bhk: string | null;
  location: string | null;
  purpose: string | null;
  focused_project_id: string | null;
  shortlist_json: string;
  status: string;
  pending_json: string | null;
}

export interface ProjectRow {
  id: string;
  builder_id: string;
  name: string;
  micro_market: string;
  starting_price_lakhs: number;
  bhk_options: string;
  rera: string;
}

export interface MemoryView {
  conversation: ConversationRow;
  facts: {
    budget?: string;
    bhk?: string;
    location?: string;
    purpose?: string;
    project_id?: string;
  };
  pending: { kind: string; payload: Record<string, unknown> } | null;
  shortlist: string[];
  /** From NayaDesk conversation-context when focused. */
  focusedProject?: {
    project_id: string;
    name: string;
    micro_market: string;
    rera_number: string;
    entry_price_band: string;
  } | null;
  builderName?: string;
  builder?: {
    name: string;
    bot_name: string;
    bot_persona: string;
    bot_signature: string;
    preferred_tone: string;
  };
  returningBuyer?: {
    buyer_name: string;
    days_since_last_seen: number;
  } | null;
  /** 1-based turn index for this inbound message. */
  turnIndex: number;
  objectionPlaybooks?: Array<{
    objection_topic: string;
    reframe_angles: string;
    trigger_phrases: string;
  }>;
}

export interface Intent {
  kind: string;
}

export interface SlotWrite {
  slot: 'budget' | 'bhk' | 'location' | 'purpose' | 'project_id';
  value: string;
}

export interface UnderstandResult {
  intents: Intent[];
  slot_writes: SlotWrite[];
  compare_names?: string[];
  media_kind?: string;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  output: Record<string, unknown>;
}

export interface DecideResult {
  composer: ComposerKind;
  tool_plan: ToolCall[];
  memory_writes: Array<{ op: string; [key: string]: unknown }>;
}

export interface TurnLedgerRow {
  conversation_id: string;
  turn_index: number;
  buyer_text: string;
  composer: string;
  tool_names: string;
  reply_text: string;
  snapshot_json: string;
  created_at: number;
}

export interface TurnInput {
  conversation_id: string;
  buyer_text: string;
  builder_id?: string;
  buyer_phone?: string;
  action_id?: string;
  /** W6 — ingress door. Every door sets it explicitly; absent = legacy caller (treated as whatsapp). */
  channel?: 'whatsapp' | 'advisor_web' | 'api';
}

export interface MediaAttachmentDto {
  asset_kind: string;
  label: string;
  url: string;
  mime_type?: string;
  delivery: 'image' | 'document' | 'video';
  filename?: string;
  project_name?: string;
}

export interface TurnResult {
  reply_text: string;
  /** Engine turn goal kind (e.g. recommend, answer, visit_booked). */
  composer: string;
  turn_index: number;
  whatsapp_actions?: Array<{ id: string; label: string; patch: Record<string, string | undefined>; user_line: string; expected_matches: number }>;
  /** Native Cloud API interactive (list XOR buttons). Saarathi / webhook send this. */
  whatsapp_interactive?:
    | { type: 'button'; buttons: Array<{ id: string; title: string }> }
    | {
        type: 'list';
        button: string;
        sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>;
      };
  /** Named media for client cards / WhatsApp native send (URL not in reply_text). */
  media_attachments?: MediaAttachmentDto[];
  /**
   * One-time "Reply STOP … or DELETE …" line, present only on the turn that
   * owes it. Its own message, not appended to `reply_text`: the first reply is
   * often an interactive list whose body caps at 1024 characters, and a notice
   * that gets silently truncated is worse than no notice.
   */
  consent_notice?: string;
  /**
   * One-time welcome for a buyer who registered themselves on Desk's form,
   * present only on the turn that owes it. Sent BEFORE `reply_text` — see
   * engine/welcome.ts for why it leads while `consent_notice` trails.
   */
  welcome_message?: string;
  /** Engine debug — NayaDesk Auto/Vault map tools → brain.tool_calls. */
  debug?: {
    phase?: string;
    goal?: unknown;
    /** Turn-end conversation state. Additive, and the reason the live harness
     *  can grade a deployed reply as strictly as the in-process one. */
    focus?: { projectId: string; projectName: string };
    constraints?: Record<string, unknown>;
    tools?: string[];
    grounding?: string;
    speech_act?: string;
    /** P6 / extract funnel provenance (incl. baml shadow). */
    extract_provenance?: unknown;
    last_offered_count?: number;
    last_offered_ids?: string[];
    timings?: {
      pre_extract_ms?: number;
      extract_ms?: number;
      mid_pre_goal_ms?: number;
      mid_catalog_ms?: number;
      mid_location_ms?: number;
      mid_phase_prep_ms?: number;
      routing_ms?: number;
      evidence_ms?: number;
      compose_ms?: number;
      goal_ms?: number;
      post_compose_ms?: number;
      store_save_ms?: number;
      crm_pre_ms?: number;
      total_ms?: number;
      embed_ms?: number;
      embed_calls?: number;
      embed_texts?: number;
      desk_ms?: number;
    };
    cache?: {
      seg?: 'hit' | 'miss' | 'skip';
      proj?: 'hit' | 'miss' | 'skip';
      emb?: 'hit' | 'miss' | 'skip';
      search?: 'hit' | 'miss' | 'skip';
    };
    llm_used?: boolean;
    llm_shed?: boolean;
    compose_template?: boolean;
  };
}
