import { formatInr } from '../engine/compose.js';
import { filterUnitsByBhk } from '../engine/unit-config.js';
import { mapProjectDetailDto } from './map-project-detail.js';
import { mapVisitQueue } from './map-visit-queue.js';
import { mapVisitItinerary } from './map-visit-itinerary.js';
import { buildAdvisorNba, buildChecklistSnapshot } from './nba.js';
import type { AdvisorMapInput, AdvisorProjectCard, AdvisorTurnResponse } from './types.js';

export function mapAdvisorTurnResponse(input: AdvisorMapInput): AdvisorTurnResponse {
  const { sessionId, state, reply, debug, compareMatrix, searchRecovery, uiMode } = input;
  const projects = mapProjectCards(state);
  const prefs = mapPrefsSnapshot(state);
  const focusId = state.focus?.projectId;
  const focusedDetail = focusId ? state.projectCache?.[focusId] : undefined;
  const focusedDto = focusedDetail
    ? scopeFocusedConfigurations(mapProjectDetailDto(focusedDetail), state.constraints.bhk)
    : undefined;
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

  let nba = buildAdvisorNba(state, debug);
  if (compareMatrix) {
    nba = {
      chips: nba.chips.length ? nba.chips : ['Plan a visit day', 'Back to my matches'],
      board: 'compare',
    };
  }
  const checklist_snapshot = buildChecklistSnapshot(state);

  return {
    status: 'ok',
    session_id: sessionId,
    reply,
    conversation_id: state.convId,
    ...(state.ndConversationId ? { nd_conversation_id: state.ndConversationId } : {}),
    ...(focusedDto ? { focused_project: focusedDto } : {}),
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
    nba,
    checklist_snapshot,
    debug: {
      phase: debug.phase,
      goal: debug.goal,
      tools: debug.tools,
      grounding: debug.grounding,
    },
  };
}

/** Prefer buyer's BHK on the focused board — full list when multi-select or no BHK. */
export function scopeFocusedConfigurations(
  dto: import('./map-project-detail.js').AdvisorProjectDetailDto,
  constraintBhk: string | undefined,
): import('./map-project-detail.js').AdvisorProjectDetailDto {
  const configs = dto.configurations;
  if (!configs?.length || !constraintBhk?.trim()) return dto;
  if (/[·,]/.test(constraintBhk) || /\bor\b/i.test(constraintBhk)) return dto;
  const mapped = configs.map((c) => ({
    unitType: c.unit_type,
    priceDisplay: c.price_display,
    priceMinInr: c.price_min_inr,
    ...(c.size_display ? { sizeDisplay: c.size_display } : {}),
  }));
  const filtered = filterUnitsByBhk(mapped, constraintBhk.trim());
  if (filtered.length === 0 || filtered.length === mapped.length) return dto;
  return {
    ...dto,
    configurations: filtered.map((c) => ({
      unit_type: c.unitType,
      price_display: c.priceDisplay,
      price_min_inr: c.priceMinInr,
      ...(c.sizeDisplay ? { size_display: c.sizeDisplay } : {}),
    })),
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
