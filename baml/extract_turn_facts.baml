// BAML contract for ExtractTurnFacts — TS implementation in src/engine/extract-baml.ts
// Clients: DeepSeek JSON (deployed) | Ollama (local optional)
// P1 free-text: multi-slot search-brief authority for location/type/purpose (+ soft prefs).
// Chips / speech-act remain outside this contract. Budget/BHK: LLM fill when regex empty.

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
  /// e.g. "2 BHK" / "3 BHK" when clearly stated
  bhk string?
  /// Max budget in INR integer when clearly stated (e.g. 12000000 for 1.2 Cr)
  budget_max_inr int?
  near_airport bool?
  ready_to_move bool?
  confidence "llm" | "abstain"
  abstain_reason string?
}

function ExtractTurnFacts(input: ExtractTurnFactsInput) -> ExtractTurnFactsResult {
  client DeepSeek
  prompt #"
    Extract search constraints and topics from a real-estate buyer WhatsApp message.
    Return ALL clearly stated slots in one JSON (multi-requirement packing).
    Do NOT classify speech act. Do NOT invent projects or localities not in the message.
    location must be locality/corridor only — never include budget words (under/crore/lakh).
    If unsure, set confidence=abstain and leave fields null/empty.
    Return JSON matching ExtractTurnFactsResult.
    {{ input }}
  "#
}
