/**
 * Which-projects chooser parsing — ordinals, names, all/both/everything deixis.
 */

import type { OfferedProject } from './types.js';

const ALL_DEIXIS =
  /\b(?:all(?:\s+of\s+them)?|everything|all\s+(?:three|four|\d+)|both|these|those|them|the\s+two)\b/i;

const ORDINAL_TOKEN = /\b(\d{1,2})\b/g;

export function isAllDeixis(text: string): boolean {
  return ALL_DEIXIS.test(text.trim());
}

/** Parse "1", "1 and 2", "1,3" against a 1-based candidate list. */
export function parseOrdinalPicks(text: string, candidates: readonly OfferedProject[]): OfferedProject[] {
  const picks = new Map<string, OfferedProject>();
  const t = text.trim();
  let m: RegExpExecArray | null;
  const re = new RegExp(ORDINAL_TOKEN.source, 'g');
  while ((m = re.exec(t)) !== null) {
    const n = parseInt(m[1]!, 10);
    if (n >= 1 && n <= candidates.length) {
      const c = candidates[n - 1]!;
      picks.set(c.projectId, c);
    }
  }
  return [...picks.values()];
}

export function parseNamePicks(text: string, candidates: readonly OfferedProject[]): OfferedProject[] {
  const t = text.toLowerCase();
  const picks: OfferedProject[] = [];
  for (const c of candidates) {
    const name = c.name.toLowerCase();
    if (name.length >= 3 && t.includes(name)) picks.push(c);
  }
  return picks;
}

export type WhichPickResult =
  | { kind: 'all' }
  | { kind: 'subset'; projects: OfferedProject[] }
  | { kind: 'none' };

/**
 * Resolve chooser reply against candidateIds.
 * Prefer all-deixis → full set; else ordinals; else names.
 */
export function resolveWhichPick(text: string, candidates: readonly OfferedProject[]): WhichPickResult {
  if (candidates.length === 0) return { kind: 'none' };
  if (isAllDeixis(text)) return { kind: 'all' };
  const ordinals = parseOrdinalPicks(text, candidates);
  if (ordinals.length > 0) return { kind: 'subset', projects: ordinals };
  const names = parseNamePicks(text, candidates);
  if (names.length > 0) return { kind: 'subset', projects: names };
  return { kind: 'none' };
}

export function formatWhichChooserCopy(candidates: readonly OfferedProject[]): string {
  const lines = candidates.map((c, i) => `${i + 1}. ${c.name}`);
  return (
    `You've looked at these — which should we visit?\n` +
    `${lines.join('\n')}\n` +
    `Reply with numbers or names (e.g. 1 and 2, or ${candidates[0]?.name ?? 'a name'}).`
  );
}

export function applyPickToQueue(
  projects: OfferedProject[],
  maxStops: number,
): { projectId: string; projectName: string; queued: Array<{ projectId: string; projectName: string }> } | null {
  if (projects.length === 0) return null;
  const capped = projects.slice(0, maxStops);
  const [first, ...rest] = capped;
  return {
    projectId: first!.projectId,
    projectName: first!.name,
    queued: rest.map((p) => ({ projectId: p.projectId, projectName: p.name })),
  };
}
