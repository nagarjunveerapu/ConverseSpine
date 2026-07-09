/**
 * P2c — disclosed facts for turn_ledger + compose “already said” checks.
 * Shape matches NayaDesk DisclosedFactSchema (turn_ledger.ts).
 */
import type { EvidenceSet, TurnGoal } from './types.js';

export type DisclosedFactKind =
  | 'price'
  | 'yield'
  | 'rent'
  | 'legal'
  | 'availability'
  | 'emi'
  | 'distance'
  | 'other';

export interface DisclosedFact {
  kind: DisclosedFactKind;
  project_id: string | null;
  statement: string;
  source_tool: string;
}

function clip(s: string, max = 500): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/** True if a prior fact of this kind exists (optionally scoped to project). */
export function hasDisclosedKind(
  facts: ReadonlyArray<DisclosedFact | Record<string, unknown>> | undefined,
  kind: DisclosedFactKind,
  projectId?: string,
): boolean {
  if (!facts?.length) return false;
  return facts.some((f) => {
    const k = typeof f.kind === 'string' ? f.kind : '';
    if (k !== kind) return false;
    if (!projectId) return true;
    const pid = f.project_id ?? (f as { projectId?: unknown }).projectId;
    return pid == null || pid === projectId;
  });
}

/** True if any legal fact statement mentions RERA (for skip-repeat). */
export function hasDisclosedRera(
  facts: ReadonlyArray<DisclosedFact | Record<string, unknown>> | undefined,
  projectId?: string,
): boolean {
  if (!facts?.length) return false;
  return facts.some((f) => {
    if (f.kind !== 'legal') return false;
    if (projectId) {
      const pid = f.project_id ?? (f as { projectId?: unknown }).projectId;
      if (pid != null && pid !== projectId) return false;
    }
    const stmt = typeof f.statement === 'string' ? f.statement : '';
    return /\brera\b/i.test(stmt);
  });
}

/**
 * Extract facts this turn is about to claim from structured evidence.
 * Deterministic — does not parse free-form reply prose.
 */
export function extractDisclosedFacts(input: {
  goal: TurnGoal;
  evidence: EvidenceSet;
}): DisclosedFact[] {
  const { goal, evidence: ev } = input;
  const out: DisclosedFact[] = [];
  const projectId =
    ('projectId' in goal && typeof goal.projectId === 'string' ? goal.projectId : null) ??
    ev.detail?.projectId ??
    null;

  if (goal.kind === 'answer') {
    const topics = goal.topics?.length ? goal.topics : [goal.topic];

    if (topics.includes('legal') && ev.detail) {
      const d = ev.detail;
      const bits: string[] = [];
      if (d.reraNumber) bits.push(`RERA: ${d.reraNumber}`);
      if (d.khata) bits.push(`Khata: ${d.khata}`);
      if (d.naStatus) bits.push(`NA: ${d.naStatus}`);
      if (d.ecStatus) bits.push(`EC: ${d.ecStatus}`);
      if (d.loanEligibility) bits.push(`Loan: ${d.loanEligibility}`);
      if (bits.length) {
        out.push({
          kind: 'legal',
          project_id: projectId ?? d.projectId ?? null,
          statement: clip(`Regulatory: ${bits.join('; ')}`),
          source_tool: 'project_detail',
        });
      }
    }

    if (topics.includes('price') && ev.pricing) {
      const p = ev.pricing;
      const parts = p.components.slice(0, 4).map((c) => `${c.label} ${c.value}`).join('; ');
      out.push({
        kind: 'price',
        project_id: projectId,
        statement: clip(`Pricing — ${p.projectName}: ${parts || p.startingDisplay || 'on file'}`),
        source_tool: 'give_pricing',
      });
    }

    if (topics.includes('availability') && ev.units?.length) {
      const list = ev.units.slice(0, 4).map((u) => u.unitType ?? u.sizeDisplay ?? 'unit').join('; ');
      out.push({
        kind: 'availability',
        project_id: projectId,
        statement: clip(`Configurations: ${list}`),
        source_tool: 'listUnits',
      });
    }

    if (topics.includes('emi') && ev.emi) {
      out.push({
        kind: 'emi',
        project_id: projectId,
        statement: clip(`EMI ${ev.emi.emiFormatted}/mo at ${ev.emi.ratePercent}%`),
        source_tool: 'compute_emi',
      });
    }

    if (topics.includes('location') && ev.location) {
      out.push({
        kind: 'distance',
        project_id: projectId,
        statement: clip(`${ev.location.projectName} in ${ev.location.microMarket}`),
        source_tool: 'location',
      });
    }
  }

  return out.slice(0, 30);
}

/** Normalize unknown ledger / session rows into DisclosedFact[]. */
export function normalizeDisclosedFacts(
  facts: ReadonlyArray<DisclosedFact | Record<string, unknown>> | undefined,
): DisclosedFact[] {
  if (!facts?.length) return [];
  const out: DisclosedFact[] = [];
  for (const f of facts) {
    const kind = typeof f.kind === 'string' ? f.kind : '';
    const statement = typeof f.statement === 'string' ? f.statement.trim() : '';
    if (!statement) continue;
    const allowed: DisclosedFactKind[] = [
      'price',
      'yield',
      'rent',
      'legal',
      'availability',
      'emi',
      'distance',
      'other',
    ];
    const k = (allowed.includes(kind as DisclosedFactKind) ? kind : 'other') as DisclosedFactKind;
    const project_id =
      f.project_id === null || typeof f.project_id === 'string'
        ? (f.project_id as string | null)
        : null;
    const source_tool = typeof f.source_tool === 'string' ? f.source_tool : 'ledger';
    out.push({ kind: k, project_id, statement: clip(statement), source_tool });
  }
  return out;
}

/** Merge two fact lists, deduping by statement (max 30). */
export function mergeDisclosedFacts(
  a: ReadonlyArray<DisclosedFact | Record<string, unknown>> | undefined,
  b: ReadonlyArray<DisclosedFact | Record<string, unknown>> | undefined,
): DisclosedFact[] {
  const merged = normalizeDisclosedFacts(a);
  const seen = new Set(merged.map((f) => f.statement));
  for (const f of normalizeDisclosedFacts(b)) {
    if (seen.has(f.statement)) continue;
    seen.add(f.statement);
    merged.push(f);
  }
  return merged.slice(-30);
}

/** Format for compose PRIOR CONTEXT block. */
export function formatDisclosedForPrompt(
  facts: ReadonlyArray<DisclosedFact | Record<string, unknown>> | undefined,
): string {
  if (!facts?.length) return '';
  return facts
    .slice(0, 8)
    .map((f) => {
      const kind = typeof f.kind === 'string' ? f.kind : 'other';
      const stmt = typeof f.statement === 'string' ? f.statement : '';
      return `- [${kind}] ${stmt}`;
    })
    .join('\n');
}
