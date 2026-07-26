/**
 * The discourse entity store — one place, one ordering.
 *
 * Entities live in five fields today (`discover.lastOffered`,
 * `discover.discussedProjects`, `focus`, `projectCache`, `visit.queued`) and 21
 * resolvers read them in four different orderings. The disagreement is the bug
 * class, not a symptom of it:
 *
 *   J7       `compare_resolve.projectPool` is discussed → focus → lastOffered
 *            with the catalog in none of them, so "comparing Eldorado and
 *            Sanctuary" compared Ayana / Desire Spaces / Vanam.
 *   NAME-06  `focus` is a single slot. There is nothing to pop back to, so
 *            "what about cornerstone utopia" cannot reach the sibling.
 *
 * PHASE 1a writes this store ALONGSIDE the existing fields. Nothing reads it
 * yet and no behaviour changes. 1b migrates consumers family by family
 * (compare → named-resolve → visit → chips), asserting `salience(state)`
 * matches the old projection at each step. 1c deletes the old fields.
 *
 * DURABLE SHAPE. `store-kv.ts:28` is `JSON.stringify(state)`. A `Map` or `Set`
 * round-trips to `{}` — silently, while still typechecking — so the stored
 * shape is a plain `Record<>` of plain records, and salience is a pure
 * function over state rather than a method on it. A turn may build a `Map` in
 * memory; never as the stored field.
 */
import type { ConversationState } from './types.js';

export type EntityRole = 'offered' | 'discussed' | 'focused' | 'rejected' | 'queued';

export interface DiscourseEntityRecord {
  projectId: string;
  /** The project's real name. NEVER the slug — a cached slug is spoken to the
   *  buyer on every later turn (the #149 class). */
  name: string;
  roles: EntityRole[];
  firstSeenTurn: number;
  lastTouchedTurn: number;
  microMarket?: string;
}

/** Rank order: rejected sinks; everything else is ordered by the focus stack. */
const REJECTED_RANK = 1_000_000;

/**
 * Record entities under a role, merging with what is already known.
 *
 * An entity is never replaced wholesale: roles accumulate, because "offered
 * then discussed then rejected" is three true facts about one project, and
 * collapsing them is how `discussedProjects` and `lastOffered` drifted apart.
 */
export function recordEntities(
  state: ConversationState,
  entities: ReadonlyArray<{ projectId: string; name: string; microMarket?: string }>,
  role: EntityRole,
  turn: number,
): ConversationState {
  const next: Record<string, DiscourseEntityRecord> = { ...(state.entities ?? {}) };
  let changed = false;

  for (const e of entities) {
    // A slug is not a name. Refusing the write here is cheaper than scrubbing
    // it out of a reply later.
    if (!e.projectId || !e.name?.trim()) continue;
    const prior = next[e.projectId];
    next[e.projectId] = prior
      ? {
          ...prior,
          name: e.name,
          roles: prior.roles.includes(role) ? prior.roles : [...prior.roles, role],
          lastTouchedTurn: turn,
          ...(e.microMarket ? { microMarket: e.microMarket } : {}),
        }
      : {
          projectId: e.projectId,
          name: e.name,
          roles: [role],
          firstSeenTurn: turn,
          lastTouchedTurn: turn,
          ...(e.microMarket ? { microMarket: e.microMarket } : {}),
        };
    changed = true;
  }

  return changed ? { ...state, entities: next } : state;
}

/** Focus a project, pushing the previous focus down the stack (most recent first). */
export function pushFocus(state: ConversationState, projectId: string, turn: number): ConversationState {
  if (!projectId) return state;
  const entity = state.entities?.[projectId];
  const stack = [projectId, ...(state.focusStack ?? []).filter((id) => id !== projectId)];
  const withRole = entity
    ? recordEntities(state, [{ projectId, name: entity.name, ...(entity.microMarket ? { microMarket: entity.microMarket } : {}) }], 'focused', turn)
    : state;
  return { ...withRole, focusStack: stack };
}

/** Return to the previous focus. This is what NAME-06 and "go back" need. */
export function popFocus(state: ConversationState): ConversationState {
  const stack = state.focusStack ?? [];
  if (stack.length < 2) return state;
  return { ...state, focusStack: stack.slice(1) };
}

/**
 * THE single ordering every resolver should read.
 *
 * current focus → focus-stack depth → recency of touch. Rejected entities rank
 * last but are never removed: a rejection is information, and dropping it is
 * how a rejected project gets re-offered.
 */
export function salience(state: ConversationState): DiscourseEntityRecord[] {
  const stack = state.focusStack ?? [];
  const depth = new Map(stack.map((id, i) => [id, i]));
  return Object.values(state.entities ?? {}).sort((a, b) => {
    const ar = a.roles.includes('rejected') ? REJECTED_RANK : (depth.get(a.projectId) ?? 10_000);
    const br = b.roles.includes('rejected') ? REJECTED_RANK : (depth.get(b.projectId) ?? 10_000);
    if (ar !== br) return ar - br;
    return b.lastTouchedTurn - a.lastTouchedTurn;
  });
}

/** The focused entity, if any — the store's answer to `state.focus`. */
export function focusedEntity(state: ConversationState): DiscourseEntityRecord | undefined {
  const id = (state.focusStack ?? [])[0];
  return id ? state.entities?.[id] : undefined;
}
