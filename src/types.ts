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
}

export interface TurnResult {
  reply_text: string;
  /** Engine turn goal kind (e.g. recommend, answer, visit_booked). */
  composer: string;
  turn_index: number;
  whatsapp_actions?: Array<{ id: string; label: string; patch: Record<string, string | undefined>; user_line: string; expected_matches: number }>;
}
