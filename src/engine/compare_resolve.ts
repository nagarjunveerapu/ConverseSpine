import type { ConversationState, Extracted } from './types.js';
import {
  resolveProjectReferences,
  type ContextMessage,
  type ProjectRef,
} from './project_references.js';

const GENERIC_COMPARE_RE =
  /\b(?:compare|which\s+(?:is|one)\s+better|what(?:'s|\s+is)\s+the\s+difference|difference\s+between|vs\.?|versus)\b/i;

function projectPool(s: ConversationState): ProjectRef[] {
  const pool: ProjectRef[] = s.discover.lastOffered.map((o) => ({
    project_id: o.projectId,
    name: o.name,
  }));
  if (s.focus && !pool.some((p) => p.project_id === s.focus!.projectId)) {
    pool.unshift({ project_id: s.focus.projectId, name: s.focus.projectName });
  }
  return pool;
}

function uniqueIds(refs: readonly ProjectRef[], max = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of refs) {
    if (seen.has(r.project_id)) continue;
    seen.add(r.project_id);
    out.push(r.project_id);
    if (out.length >= max) break;
  }
  return out;
}

/** Resolve which project IDs to compare for this turn. */
export function resolveCompareProjectIds(
  buyerText: string,
  ex: Extracted,
  s: ConversationState,
): string[] {
  if (ex.transition === 'want_visit') return [];

  const pool = projectPool(s);
  const recent: ContextMessage[] = (s.discover.recentMessages ?? []).map((m) => ({
    text: m.text,
    created_at_ms: m.atMs,
  }));

  if (ex.namedProjects && ex.namedProjects.length >= 2) {
    return uniqueIds(
      ex.namedProjects.map((p) => ({ project_id: p.projectId, name: p.name })),
    );
  }

  const fromRefs = resolveProjectReferences(buyerText, recent, pool);
  if (fromRefs.length >= 2) return uniqueIds(fromRefs);

  if (
    pool.length >= 2 &&
    (ex.askTopic === 'compare' || GENERIC_COMPARE_RE.test(buyerText)) &&
    fromRefs.length === 0
  ) {
    return uniqueIds(pool);
  }

  if (fromRefs.length === 1 && pool.length >= 2) {
    const hasSubstantiveTopic =
      (ex.askTopics ?? []).some((t) => t !== 'compare') ||
      (ex.askTopic != null && ex.askTopic !== 'compare');
    if (hasSubstantiveTopic) return [];
    const other = pool.find((p) => p.project_id !== fromRefs[0]!.project_id);
    if (other) return [fromRefs[0]!.project_id, other.project_id];
  }

  return [];
}
