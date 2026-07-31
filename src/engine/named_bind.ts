/**
 * Named-compare bind + unbound-name typing (SUBJECT PR-2 / PR-2-lite).
 *
 * `namedProjects` only carries successes. Without a channel for name-shaped
 * tokens that failed to bind, compare fall-through cannot tell "named nothing"
 * from "named something unbound" and pool-guesses the shortlist (J7).
 */
import {
  nameMentioned,
  resolveProjectReferences,
  type ProjectRef,
} from './project_references.js';
import type { Extracted, OfferedProject } from './types.js';

const COMPARE_CUE_RE =
  /\b(?:compar(?:e|ing|ison)|vs\.?|versus|difference\s+between)\b/i;

const ANAPHORA_ONLY_RE =
  /^(?:both|these|those|them|the\s+two|all(?:\s+\d+)?|dono)(?:\b|$)/i;

/**
 * Split a compare-shaped utterance into buyer name spans.
 * Returns [] for anaphora ("compare both") so conversation-pool fall-through stays valid.
 */
export function extractCompareNameCandidates(text: string): string[] {
  let work = text.trim();
  if (!work) return [];
  const hasCompareCue = COMPARE_CUE_RE.test(work);
  const hasAndOrVs = /\s+(?:and|vs\.?|versus)\s+/i.test(work);
  if (!hasCompareCue && !hasAndOrVs) return [];

  work = work
    .replace(/^(?:okay[,.]?\s+|ok[,.]?\s+|hey[,.]?\s+|please\s+|can\s+you\s+|could\s+you\s+)/i, '')
    .replace(/\b(?:compar(?:e|ing|ison)\s+(?:of\s+)?|difference\s+between\s+)/gi, ' ')
    .replace(/\b(?:vs\.?|versus)\b/gi, ' and ')
    .replace(/\b(?:the\s+)?(?:projects?|ones?|options?)\b/gi, ' ')
    .replace(/\b(?:can\s+you|could\s+you|please|okay|ok|also|now)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!work || ANAPHORA_ONLY_RE.test(work)) return [];

  const parts = work
    .split(/\s+(?:and|,)\s+/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3)
    .filter((p) => !/^(?:both|these|those|them|the\s+two|all|dono|me|my|it)$/i.test(p));

  return parts.length >= 2 ? parts.slice(0, 3) : [];
}

function asRefs(
  rows: ReadonlyArray<{ projectId: string; name: string }>,
): ProjectRef[] {
  return rows.map((r) => ({ project_id: r.projectId, name: r.name }));
}

function bindCandidate(
  candidate: string,
  pool: ReadonlyArray<{ projectId: string; name: string }>,
): OfferedProject | null {
  if (!pool.length || !candidate.trim()) return null;
  const refs = resolveProjectReferences(candidate, [], asRefs(pool));
  if (refs.length === 1) {
    return { projectId: refs[0]!.project_id, name: refs[0]!.name };
  }
  const lc = candidate.toLowerCase();
  const siblings = pool.map((p) => ({ name: p.name }));
  const hits = pool.filter((p) => {
    const full = p.name.toLowerCase();
    const distinctive = p.name.replace(/^(brigade|lokations)\s+/i, '').toLowerCase();
    return (
      lc === full ||
      lc === distinctive ||
      full.includes(lc) ||
      (distinctive.length >= 3 && lc.includes(distinctive)) ||
      nameMentioned(p.name, lc, siblings)
    );
  });
  if (hits.length === 1) return { projectId: hits[0]!.projectId, name: hits[0]!.name };
  return null;
}

export interface NamedBindPool {
  session: ReadonlyArray<{ projectId: string; name: string }>;
  catalog: ReadonlyArray<{ projectId: string; name: string }>;
}

/**
 * Stamp catalog/session binds for compare-shaped name spans and record unbound
 * name-shaped tokens. Leaves non-compare turns unchanged.
 */
export function stampNamedAndUnbound(
  text: string,
  ex: Extracted,
  pool: NamedBindPool,
): Extracted {
  const candidates = extractCompareNameCandidates(text);
  if (!candidates.length) return ex;

  const byId = new Map<string, { projectId: string; name: string }>();
  for (const p of pool.session) byId.set(p.projectId, p);
  for (const p of pool.catalog) {
    if (!byId.has(p.projectId)) byId.set(p.projectId, p);
  }
  const matchPool = [...byId.values()];

  const bound: OfferedProject[] = [];
  const unbound: string[] = [];
  const seen = new Set<string>();
  for (const cand of candidates) {
    const hit = bindCandidate(cand, matchPool);
    if (hit) {
      if (!seen.has(hit.projectId)) {
        seen.add(hit.projectId);
        bound.push(hit);
      }
    } else {
      unbound.push(cand);
    }
  }

  const named =
    bound.length >= 2
      ? bound
      : bound.length === 1 && !(ex.namedProjects?.length)
        ? bound
        : bound.length
          ? mergeNamed(ex.namedProjects, bound)
          : ex.namedProjects;

  return {
    ...ex,
    ...(named?.length ? { namedProjects: named } : {}),
    ...(unbound.length ? { unboundProjectNames: unbound } : {}),
  };
}

function mergeNamed(
  prior: OfferedProject[] | undefined,
  next: OfferedProject[],
): OfferedProject[] {
  const out: OfferedProject[] = [];
  const seen = new Set<string>();
  for (const p of [...next, ...(prior ?? [])]) {
    if (seen.has(p.projectId)) continue;
    seen.add(p.projectId);
    out.push(p);
    if (out.length >= 3) break;
  }
  return out;
}
