// BAML contract for ClassifyTurnIntent — TS implementation in src/engine/turn-intent/
// Clients: Ollama 8B (local) | DeepSeek JSON (deployed)

class PendingPrompt {
  kind "offer_project" | "offer_widen" | "binary_budget_or_area" | "chip_menu"
  project_id string?
  project_name string?
  chip_ids string[]?
  asked_at_turn int
}

class SuggestedActionBrief {
  id string
  label string
  user_line string
}

class TurnIntentInput {
  text string
  channel "advisor_web" | "whatsapp"
  phase string
  ui_mode string
  constraints map<string, string>
  last_goal_kind string
  last_evidence_kind string?
  last_reply_excerpt string
  pending_prompt PendingPrompt?
  suggested_actions SuggestedActionBrief[]
  last_offered map<string, string>[]
  recent_turns map<string, string>[]
}

class TurnIntentResult {
  kind "apply_recovery_patch" | "confirm_suggestion" | "probe" | "ask_named_project" | "reject_and_widen" | "compare_among_offered" | "continue_brief" | "focused_question" | "unknown"
  confidence "rule" | "extractor" | "llm" | "abstain"
  patch map<string, string>?
  patch_clear string[]?
  focus_project_id string?
  matched_action_id string?
  probe_prompt string?
}

function ClassifyTurnIntent(input: TurnIntentInput) -> TurnIntentResult {
  client Ollama
  client DeepSeek
  prompt #"
    Classify buyer turn intent for property search recovery.
    Use pending_prompt for yes/no — never treat bare yes as confirm unless kind=offer_project.
    Return JSON only matching TurnIntentResult.
    {{ input }}
  "#
}
