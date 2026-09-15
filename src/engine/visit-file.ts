import type { Constraints, ThreadState, VisitState } from './types.js';
import type { StoredVisit } from './ports.js';

export type BookedVisitRow = {
  projectId: string;
  projectName: string;
  iso: string;
  label: string;
};

/** Size / area / budget already on the thread — the brief we can read back. */
export function hasBuyerBrief(c: Constraints | undefined): boolean {
  if (!c) return false;
  return Boolean(
    c.bhk?.trim() ||
      c.location?.trim() ||
      c.propertyType?.trim() ||
      c.budgetMaxInr != null ||
      c.budgetMinInr != null,
  );
}

export function bookedRowFromDraft(prev: VisitState | undefined): BookedVisitRow | undefined {
  if (!prev?.projectId || !prev.proposedIso) return undefined;
  return {
    projectId: prev.projectId,
    projectName: prev.projectName ?? prev.projectId,
    iso: prev.proposedIso,
    label: prev.proposedLabel?.trim() || prev.slotText?.trim() || prev.proposedIso,
  };
}

export function mergeBookedVisitRows(
  existing: readonly BookedVisitRow[] | undefined,
  extra: readonly BookedVisitRow[],
): BookedVisitRow[] {
  const out: BookedVisitRow[] = [];
  const seen = new Set<string>();
  for (const v of [...(existing ?? []), ...extra]) {
    const key = `${v.projectId}|${v.iso}`;
    if (!v.iso || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export function mergeStoredVisits(
  ...lists: Array<readonly StoredVisit[] | undefined>
): StoredVisit[] {
  const out: StoredVisit[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const v of list ?? []) {
      const key = `${v.projectId}|${v.iso}|${v.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

export function upcomingBookedVisit(
  state: Pick<ThreadState, 'visitBookedCache' | 'buyerLifecycle'>,
  nowMs: number,
): BookedVisitRow | undefined {
  const fromCache = (state.visitBookedCache ?? []).find((v) => Date.parse(v.iso) > nowMs);
  if (fromCache) return fromCache;
  const life = state.buyerLifecycle;
  if (life?.kind === 'visit_planned' && life.visit && Date.parse(life.visit.iso) > nowMs) {
    return {
      projectId: life.visit.projectId,
      projectName: life.visit.projectName ?? life.visit.projectId,
      iso: life.visit.iso,
      label: life.visit.label,
    };
  }
  return undefined;
}

export function cacheToStored(rows: readonly BookedVisitRow[] | undefined): StoredVisit[] {
  return (rows ?? []).map((v) => ({
    projectId: v.projectId,
    projectName: v.projectName,
    iso: v.iso,
    label: v.label,
    confirmed: true,
  }));
}
