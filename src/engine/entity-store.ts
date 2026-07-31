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
 * PHASE 1a dual-writes this store alongside the legacy fields. 1b migrates
 * consumers family by family (compare → named-resolve → visit → chips).
 * First reader: `resolveAlternateProject` ("the other one") via
 * `detectFocusedSwitchIntent`. 1c deletes the old fields once no reader remains.
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

/**
 * Return to the previous focus. Dual-writes legacy `focus` until 1c — the stack
 * alone must not diverge from `state.focus` while both exist.
 */
export function popFocus(state: ConversationState): ConversationState {
  const stack = state.focusStack ?? [];
  if (stack.length < 2) return state;
  const next = stack.slice(1);
  const id = next[0]!;
  const entity = state.entities?.[id];
  return {
    ...state,
    focusStack: next,
    phase: 'focused',
    ...(entity
      ? { focus: { projectId: entity.projectId, projectName: entity.name } }
      : {}),
  };
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

/**
 * The focused entity, if any.
 * During dual-write, trust legacy `state.focus` first — `focusStack` can lag
 * after `releaseToDiscover` until 1c deletes the split.
 */
export function focusedEntity(state: ConversationState): DiscourseEntityRecord | undefined {
  if (state.focus) {
    const fromStore = state.entities?.[state.focus.projectId];
    if (fromStore) return fromStore;
  }
  if (state.phase !== 'focused') return undefined;
  const id = (state.focusStack ?? [])[0];
  return id ? state.entities?.[id] : undefined;
}

function isDiscourseRole(roles: readonly EntityRole[]): boolean {
  return (
    roles.includes('offered') ||
    roles.includes('discussed') ||
    roles.includes('focused') ||
    roles.includes('queued')
  );
}

/**
 * Conversation-scoped entities in salience order — the pool every resolver
 * should read. Rejected rows are omitted (still retained in `state.entities`).
 * Empty when the store was never dual-written (pre-1a sessions).
 */
export function discourseEntities(state: ConversationState): DiscourseEntityRecord[] {
  return salience(state).filter(
    (e) => !e.roles.includes('rejected') && isDiscourseRole(e.roles),
  );
}

/** OfferedProject-shaped view for visit / switch / named-resolve consumers. */
export function discourseOffered(
  state: ConversationState,
): Array<{ projectId: string; name: string; microMarket?: string }> {
  return discourseEntities(state).map((e) => ({
    projectId: e.projectId,
    name: e.name,
    ...(e.microMarket ? { microMarket: e.microMarket } : {}),
  }));
}

/**
 * Legacy pool projection (discussed → focus → lastOffered) for dual-write
 * membership asserts. Order is the old compare_resolve shape — not salience.
 */
export function legacyConversationPoolIds(state: ConversationState): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string | undefined) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  for (const p of state.discover.discussedProjects ?? []) push(p.projectId);
  push(state.focus?.projectId);
  for (const o of state.discover.lastOffered) push(o.projectId);
  return out;
}

/**
 * Resolve "the other one" / alternate deixis against salience.
 *
 * Returns the unique non-focus discourse entity when exactly one exists.
 * Ambiguous (0 or 2+) → undefined — never invent a subject.
 */
export function resolveAlternateProject(
  state: ConversationState,
): DiscourseEntityRecord | undefined {
  const focusId = state.focus?.projectId ?? (state.focusStack ?? [])[0];
  if (!focusId) return undefined;

  const others = salience(state).filter(
    (e) =>
      e.projectId !== focusId &&
      !e.roles.includes('rejected') &&
      isDiscourseRole(e.roles),
  );

  if (others.length === 1) return others[0];

  // Stack depth > 1 is an unambiguous prior focus even when more offered exist.
  const stackAlt = (state.focusStack ?? [])[1];
  if (stackAlt && stackAlt !== focusId) {
    const entity = state.entities?.[stackAlt];
    if (entity && !entity.roles.includes('rejected')) return entity;
  }

  return undefined;
}
