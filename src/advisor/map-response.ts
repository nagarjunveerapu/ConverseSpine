import { formatInr } from '../engine/compose.js';
import { mapProjectDetailDto } from './map-project-detail.js';
import { mapVisitQueue } from './map-visit-queue.js';
import { mapVisitItinerary } from './map-visit-itinerary.js';
import type { AdvisorMapInput, AdvisorProjectCard, AdvisorTurnResponse } from './types.js';

export function mapAdvisorTurnResponse(input: AdvisorMapInput): AdvisorTurnResponse {
  const { sessionId, state, reply, debug, compareMatrix, searchRecovery, uiMode } = input;
  const projects = mapProjectCards(state);
  const prefs = mapPrefsSnapshot(state);
  const focusId = state.focus?.projectId;
  const focusedDetail = focusId ? state.projectCache?.[focusId] : undefined;
  const visitBooked =
    debug.goal.kind === 'visit_booked' && 'projectId' in debug.goal
      ? {
          project_id: debug.goal.projectId,
          project_name: debug.goal.projectName,
          label: debug.goal.label,
          iso: debug.goal.iso,
        }
      : undefined;
  const visitQueue = mapVisitQueue(state);
  const visitItinerary = mapVisitItinerary(state);

  return {
    status: 'ok',
    session_id: sessionId,
    reply,
    conversation_id: state.convId,
    ...(state.ndConversationId ? { nd_conversation_id: state.ndConversationId } : {}),
    ...(focusedDetail ? { focused_project: mapProjectDetailDto(focusedDetail) } : {}),
    ...(visitBooked ? { visit_booked: visitBooked } : {}),
    ...(visitQueue ? { visit_queue: visitQueue } : {}),
    ...(visitItinerary ? { visit_itinerary: visitItinerary } : {}),
    ...(compareMatrix ? { compare_matrix: compareMatrix } : {}),
    ...(projects.length ? { projects } : {}),
    ...(state.discover.lastOffered.length
      ? { shortlist: state.discover.lastOffered.map((o) => o.projectId) }
      : {}),
    ...(Object.keys(prefs).length ? { prefs_snapshot: prefs } : {}),
    phase: state.phase,
    ...(uiMode ? { ui_mode: uiMode } : {}),
    ...(searchRecovery ? { search_recovery: searchRecovery } : {}),
    debug: {
      phase: debug.phase,
      goal: debug.goal,
      tools: debug.tools,
      grounding: debug.grounding,
    },
  };
}

function mapProjectCards(state: AdvisorMapInput['state']): AdvisorProjectCard[] {
  return state.discover.lastOffered.map((o) => ({
    id: o.projectId,
    name: o.name,
    micro_market: o.microMarket ?? '',
    price_label: o.startingPriceDisplay ?? '',
  }));
}

function mapPrefsSnapshot(state: AdvisorMapInput['state']): Record<string, string | undefined> {
  const c = state.constraints;
  const out: Record<string, string | undefined> = {};
  if (c.location) out.location = c.location;
  if (c.bhk) out.bhk = c.bhk;
  if (c.purpose) out.purpose = c.purpose;
  if (c.budgetMaxInr) out.budget = formatInr(c.budgetMaxInr);
  if (c.propertyType) out.property_type = c.propertyType;
  return out;
}
