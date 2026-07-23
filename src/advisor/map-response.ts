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

  // THE ENGINE STATES WHAT IT DID, so the client never has to guess it back.
  // The SPA used to decide whether to offer refine chips by running regexes
  // over this very reply — matching "no exact match", "want to adjust", and
  // (worse) place names like /Aerospace|Corridor/. Reword one sentence and the
  // chips silently vanish, with no error and no failing test.
  //
  // Every condition below is something the engine already computed a moment
  // ago. Sending it as a field is not new information; it is the information
  // arriving intact instead of being re-derived from prose.
  const suggest_refine =
    debug.goal.kind === 'no_fit' ||
    debug.goal.kind === 'ack_reject_recommend' ||
    !!searchRecovery?.suggested_actions?.length;

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
    suggest_refine,
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
    ...(o.tradeoffNote ? { tradeoff_note: o.tradeoffNote } : {}),
    ...(o.dimensionFit ? { dimension_fit: o.dimensionFit } : {}),
    ...(o.dimensionGap ? { dimension_gap: o.dimensionGap } : {}),
  }));
}

function mapPrefsSnapshot(state: AdvisorMapInput['state']): Record<string, string | undefined> {
  const c = state.constraints;
  const out: Record<string, string | undefined> = {};
  if (c.location) out.location = c.location;
  if (c.bhk) out.bhk = c.bhk;
  if (c.purpose) out.purpose = c.purpose;
  if (c.budgetMaxInr) {
    out.budget = formatInr(c.budgetMaxInr);
    // Numeric alongside the display string so a consumer (the SPA brief funnel)
    // maps to its own band without re-parsing "₹80 L". Same principle as the
    // EMI-basis fix — never make the client parse a formatted figure.
    out.budget_max_inr = String(c.budgetMaxInr);
  }
  if (c.propertyType) out.property_type = c.propertyType;
  // Trade-off Advisor soft signals — the SPA's "what Naya understands" tray.
  if (c.commuteHub) out.commute_hub = c.commuteHub;
  if (c.priorityFocus) out.priority = c.priorityFocus;
  if (c.schoolsMentioned) out.schools = 'important';
  if (c.worries?.length) out.worries = c.worries.join(', ');
  if (c.walkabilityMentioned) out.walkability = 'matters';
  return out;
}
