import type { ConversationState } from '../engine/types.js';
import type { StoredVisit } from '../engine/ports.js';

export type ItineraryStopStatus = 'queued' | 'proposed' | 'booked';
export type ItineraryConsent = 'none' | 'awaiting' | 'confirmed';

export interface AdvisorItineraryStop {
  project_id: string;
  project_name: string;
  iso?: string;
  label?: string;
  status: ItineraryStopStatus;
  consent: ItineraryConsent;
  drive_from_prev_min?: number;
  drive_source?: 'distance_matrix' | 'haversine' | 'none';
}

export interface AdvisorVisitItinerary {
  day_label?: string;
  origin_label?: string;
  route_ordered?: boolean;
  stops: AdvisorItineraryStop[];
}

export function mapVisitItinerary(state: ConversationState): AdvisorVisitItinerary | undefined {
  const booked: StoredVisit[] =
    state.visitBookedCache?.map((v) => ({
      projectId: v.projectId,
      projectName: v.projectName,
      iso: v.iso,
      label: v.label,
      confirmed: true,
    })) ?? [];
  const driveFromPriorMin = state.visit?.driveFromPriorMin;
  const driveSource = state.visit?.driveSource;
  const v = state.visit;
  if (state.phase !== 'visit' && !v?.projectId && booked.length === 0) return undefined;

  const stops: AdvisorItineraryStop[] = [];
  const bookedIds = new Set(booked.filter((b) => b.confirmed).map((b) => b.projectId));

  for (const b of booked.filter((x) => x.confirmed)) {
    stops.push({
      project_id: b.projectId,
      project_name: b.projectName,
      iso: b.iso,
      label: b.label,
      status: 'booked',
      consent: 'confirmed',
    });
  }

  if (v?.projectId && v.projectName) {
    if (!bookedIds.has(v.projectId)) {
      if (v.awaitingConfirm && v.proposedIso) {
        stops.push({
          project_id: v.projectId,
          project_name: v.projectName,
          iso: v.proposedIso,
          label: v.proposedLabel,
          status: 'proposed',
          consent: 'awaiting',
          ...(driveFromPriorMin != null && booked.length > 0
            ? { drive_from_prev_min: driveFromPriorMin, drive_source: driveSource ?? 'none' }
            : {}),
        });
      } else {
        stops.push({
          project_id: v.projectId,
          project_name: v.projectName,
          status: 'queued',
          consent: 'none',
        });
      }
    }
  }

  for (const q of v?.queued ?? []) {
    if (!bookedIds.has(q.projectId) && q.projectId !== v?.projectId) {
      stops.push({
        project_id: q.projectId,
        project_name: q.projectName,
        status: 'queued',
        consent: 'none',
      });
    }
  }

  if (stops.length === 0) return undefined;

  const dayLabel =
    v?.proposedLabel?.split(' at ')[0] ??
    booked.find((b) => b.label)?.label?.split(' at ')[0] ??
    v?.pendingDayLabel;

  return {
    ...(dayLabel ? { day_label: dayLabel } : {}),
    ...(v?.originText ? { origin_label: v.originText } : {}),
    ...(v?.tripOrdered ? { route_ordered: true } : {}),
    stops,
  };
}
