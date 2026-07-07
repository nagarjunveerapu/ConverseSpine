import type { TurnRoutingInput } from './types.js';

/** Context bundle for embed query — same features as SCRUM-9 Path A. */
export function buildRoutingQuery(input: TurnRoutingInput): string {
  const parts = [
    `phase=${input.phase}`,
    input.focus ? `focus=${input.focus.project_name}` : '',
    input.visit?.awaiting_confirm ? 'awaiting_visit_confirm=true' : '',
    (input.visit?.booked_count ?? 0) > 0 ? `booked_stops=${input.visit!.booked_count}` : '',
    (input.visit?.queued_count ?? 0) > 0 ? `queued_stops=${input.visit!.queued_count}` : '',
    input.transition && input.transition !== 'none' ? `transition=${input.transition}` : '',
    `buyer: ${input.text.trim()}`,
  ];
  return parts.filter(Boolean).join(' | ');
}
