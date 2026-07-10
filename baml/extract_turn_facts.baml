// BAML contract for ExtractTurnFacts — TS implementation in src/engine/extract-baml.ts
// Clients: DeepSeek JSON (deployed) | Ollama (local optional)
// P6: abstain-only gap-fill AFTER regex + embedder. Never owns speech act / chip path.

class ExtractTurnFactsInput {
  text string
  phase string
  speech_act string
  ask_topics string[]
  constraints map<string, string>
  has_named_project bool
  focus_project_name string?
}

class ExtractTurnFactsResult {
  /// Empty / abstain when unsure — never invent.
  ask_topics string[]?
  location string?
  property_type string?
  purpose "self_use" | "investment" | null
  transition "want_details" | "see_others" | "want_visit" | null
  confidence "llm" | "abstain"
  abstain_reason string?
}

function ExtractTurnFacts(input: ExtractTurnFactsInput) -> ExtractTurnFactsResult {
  client DeepSeek
  prompt #"
    Extract ONLY gap fields from a real-estate buyer message.
    Do NOT classify speech act. Do NOT invent projects, prices, or localities.
    If unsure, set confidence=abstain and leave fields null/empty.
    Return JSON matching ExtractTurnFactsResult.
    {{ input }}
  "#
}
