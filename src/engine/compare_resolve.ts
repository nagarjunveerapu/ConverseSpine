import type { ConversationState, Extracted } from './types.js';
import {
  resolveProjectReferences,
  type ContextMessage,
  type ProjectRef,
} from './project_references.js';
import { discourseEntities, discussedList } from './entity-store.js';

const GENERIC_COMPARE_RE =
  /\b(?:compare|which\s+(?:is|one)\s+better|what(?:'s|\s+is)\s+the\s+difference|difference\s+between|vs\.?|versus)\b/i;

/** Catalog joins matching only on compare-shaped turns — not "what about X utopia". */
const CATALOG_MATCH_CUE_RE =
  /\b(?:compar(?:e|ing|ison)|vs\.?|versus|difference\s+between|which\s+(?:is|one)\s+better)\b/i;

/**
 * Conversation matching/fallback pool — Phase 1b reads the entity store.
 * Discussed order is preserved at the front so "compare both" stays stable;
 * remaining discourse entities follow salience (focus → stack → recency).
 */
function projectPool(s: ConversationState): ProjectRef[] {
  const ents = discourseEntities(s);
  if (ents.length === 0) {
    // Pre-1a sessions / empty store — legacy projection.
    const discussed = s.discover.discussedProjects ?? [];
    const pool: ProjectRef[] = [];
    const seen = new Set<string>();
    const push = (project_id: string, name: string) => {
      if (!project_id || seen.has(project_id)) return;
      seen.add(project_id);
      pool.push({ project_id, name });
    };
    for (const p of discussed) push(p.projectId, p.name);
    if (s.focus) push(s.focus.projectId, s.focus.projectName);
    for (const o of s.discover.lastOffered) push(o.projectId, o.name);
    return pool;
  }

  const pool: ProjectRef[] = [];
  const seen = new Set<string>();
  const push = (project_id: string, name: string) => {
    if (!project_id || seen.has(project_id)) return;
    seen.add(project_id);
    pool.push({ project_id, name });
  };
  for (const p of s.discover.discussedProjects ?? []) {
    if (ents.some((e) => e.projectId === p.projectId)) push(p.projectId, p.name);
  }
  for (const e of ents) push(e.projectId, e.name);
  return pool;
}

function discussedRefs(s: ConversationState): ProjectRef[] {
  return discussedList(s).map((p) => ({ project_id: p.projectId, name: p.name }));
}

/** Conversation pool ∪ catalog — catalog joins MATCHING only, never fallback. */
function matchingPool(
  conversation: ReadonlyArray<ProjectRef>,
  catalog: ReadonlyArray<{ projectId: string; name: string }>,
): ProjectRef[] {
  const out: ProjectRef[] = [];
  const seen = new Set<string>();
  for (const p of conversation) {
    if (!p.project_id || seen.has(p.project_id)) continue;
    seen.add(p.project_id);
    out.push(p);
  }
  for (const p of catalog) {
    if (!p.projectId || seen.has(p.projectId)) continue;
    seen.add(p.projectId);
    out.push({ project_id: p.projectId, name: p.name });
  }
  return out;
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

function hasUnboundNames(ex: Extracted): boolean {
  return (ex.unboundProjectNames?.length ?? 0) > 0;
}

/** Resolve which project IDs to compare for this turn. */
export function resolveCompareProjectIds(
  buyerText: string,
  ex: Extracted,
  s: ConversationState,
  catalogNames: ReadonlyArray<{ projectId: string; name: string }> = [],
): string[] {
  if (ex.transition === 'want_visit') return [];

  const pool = projectPool(s);
  // Catalog in the MATCHING pool only when the buyer is comparing — otherwise
  // "what about cornerstone utopia" binds both siblings and blocks NAME-06 switch.
  const catalogInMatch =
    ex.askTopic === 'compare' ||
    (ex.askTopics?.includes('compare') ?? false) ||
    CATALOG_MATCH_CUE_RE.test(buyerText);
  const matchPool = catalogInMatch ? matchingPool(pool, catalogNames) : pool;
  const recent: ContextMessage[] = (s.discover.recentMessages ?? []).map((m) => ({
    text: m.text,
    created_at_ms: m.atMs,
  }));

  if (ex.namedProjects && ex.namedProjects.length >= 2) {
    return uniqueIds(
      ex.namedProjects.map((p) => ({ project_id: p.projectId, name: p.name })),
    );
  }

  const fromRefs = resolveProjectReferences(buyerText, recent, matchPool);
  if (fromRefs.length >= 2) return uniqueIds(fromRefs);

  // Name-shaped tokens were attempted and none (or not enough) bound — clarify.
  // Never fall through to the conversation shortlist (J7 honesty).
  if (hasUnboundNames(ex) && (ex.namedProjects?.length ?? 0) < 2) {
    return [];
  }

  const discussed = discussedRefs(s);
  const anaphora = /\b(?:both|these|those|them|the\s+two|dono)\b/i.test(buyerText);
  if (anaphora && discussed.length >= 2) {
    return uniqueIds(discussed);
  }

  if (
    pool.length >= 2 &&
    (ex.askTopic === 'compare' || GENERIC_COMPARE_RE.test(buyerText)) &&
    fromRefs.length === 0 &&
    !hasUnboundNames(ex)
  ) {
    // Prefer discussed pair over search shortlist when buyer has engaged 2+ projects.
    if (discussed.length >= 2) {
      return uniqueIds(discussed);
    }
    return uniqueIds(pool);
  }

  if (fromRefs.length === 1 && pool.length >= 2 && !hasUnboundNames(ex)) {
    const hasSubstantiveTopic =
      (ex.askTopics ?? []).some((t) => t !== 'compare') ||
      (ex.askTopic != null && ex.askTopic !== 'compare');
    if (hasSubstantiveTopic) return [];
    const other = pool.find((p) => p.project_id !== fromRefs[0]!.project_id);
    if (other) return [fromRefs[0]!.project_id, other.project_id];
  }

  return [];
}
