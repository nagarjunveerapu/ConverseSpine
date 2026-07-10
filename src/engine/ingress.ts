/**
 * Ingress provenance — chip vs free_text and UI-filled slot masks.
 * Set at channel entry only; never inferred from text shape.
 */
export type TurnInputSource = 'chip' | 'free_text';

export type IngressSlotKey = 'location' | 'bhk' | 'budget' | 'propertyType' | 'purpose';

/** Buyer explicitly overrides a UI-filled slot this turn. */
export const TEXT_OVERRIDE_RE =
  /\b(?:actually|instead|rather|change|switch(?:\s+to)?|update|not\s+\w+\s+but)\b/i;

export function resolveInputSource(actionId?: string): TurnInputSource {
  return actionId?.trim() ? 'chip' : 'free_text';
}

export function hasTextOverride(text: string): boolean {
  return TEXT_OVERRIDE_RE.test(text);
}

export function isSlotWritable(
  slot: IngressSlotKey,
  filled: ReadonlySet<IngressSlotKey>,
  text: string,
): boolean {
  if (!filled.has(slot)) return true;
  return hasTextOverride(text);
}

export type FieldProvenance =
  | 'regex'
  | 'llm'
  | 'embedder'
  | 'bridge'
  | 'ingress_blocked'
  | 'chip_skip'
  | 'override'
  | 'chip_resolve'
  | 'baml';

export interface ExtractProvenance {
  path: 'chip_skip' | 'free_text_funnel';
  fields: Partial<Record<string, FieldProvenance>>;
  /** SA-0 speech-act stamp. */
  speech_act?: import('./speech-act/types.js').SpeechActKind;
  chip_path_ids?: import('./speech-act/types.js').ChipPathId[];
  /** P6 — shadow/promote telemetry for ExtractTurnFacts. */
  baml?: import('./extract-baml.js').BamlShadowReport;
}

export function markIngressBlocked(
  provenance: ExtractProvenance['fields'],
  slot: IngressSlotKey,
): void {
  provenance[slot] = 'ingress_blocked';
}
