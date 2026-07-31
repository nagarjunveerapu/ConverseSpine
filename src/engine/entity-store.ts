/**
 * The discourse entity store — one place, one ordering.
 *
 * Phase 1a dual-wrote this alongside `lastOffered` / `discussedProjects` /
 * `focus`. 1b migrated identity resolvers. **1c** makes the store the
 * authority for the current shortlist (ids + card payload); legacy arrays are
 * write-through mirrors for old KV revive and any remaining raw readers.
 *
 * NOT in NayaDesk. Desk owns the catalog; Spine owns conversation discourse.
 * There is nothing to delete from Desk when this lands.
 *
 * DURABLE SHAPE. `store-kv.ts` is `JSON.stringify(state)`. Never store a Map/Set.
 */
import type { ConversationState, OfferedProject } from './types.js';

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
  /** Card payload — Advisor SPA / re-list. Only on the current shortlist set. */
  startingPriceDisplay?: string;
  startingPriceInr?: number;
  tradeoffNote?: string;
  dimensionFit?: OfferedProject['dimensionFit'];
  dimensionGap?: OfferedProject['dimensionGap'];
  /** Rank within the current shortlist (0 = top search hit). */
  offeredRank?: number;
}

/** Rank order: rejected sinks; everything else is ordered by the focus stack. */
const REJECTED_RANK = 1_000_000;

export type EntityWrite = {
  projectId: string;
  name: string;
  microMarket?: string;
  startingPriceDisplay?: string;
  startingPriceInr?: number;
  tradeoffNote?: string;
  dimensionFit?: OfferedProject['dimensionFit'];
  dimensionGap?: OfferedProject['dimensionGap'];
  offeredRank?: number;
};

/**
 * Record entities under a role, merging with what is already known.
 *
 * An entity is never replaced wholesale: roles accumulate, because "offered
 * then discussed then rejected" is three true facts about one project.
 */
export function recordEntities(
  state: ConversationState,
  entities: ReadonlyArray<EntityWrite>,
  role: EntityRole,
  turn: number,
): ConversationState {
  const next: Record<string, DiscourseEntityRecord> = { ...(state.entities ?? {}) };
  let changed = false;

  for (const e of entities) {
    if (!e.projectId || !e.name?.trim()) continue;
    const prior = next[e.projectId];
    next[e.projectId] = prior
      ? {
          ...prior,
          name: e.name,
          roles: prior.roles.includes(role) ? prior.roles : [...prior.roles, role],
          lastTouchedTurn: turn,
          ...(e.microMarket ? { microMarket: e.microMarket } : {}),
          ...(e.startingPriceDisplay !== undefined
            ? { startingPriceDisplay: e.startingPriceDisplay }
            : {}),
          ...(e.startingPriceInr !== undefined ? { startingPriceInr: e.startingPriceInr } : {}),
          ...(e.tradeoffNote !== undefined ? { tradeoffNote: e.tradeoffNote } : {}),
          ...(e.dimensionFit !== undefined ? { dimensionFit: e.dimensionFit } : {}),
          ...(e.dimensionGap !== undefined ? { dimensionGap: e.dimensionGap } : {}),
          ...(e.offeredRank !== undefined ? { offeredRank: e.offeredRank } : {}),
        }
      : {
          projectId: e.projectId,
          name: e.name,
          roles: [role],
          firstSeenTurn: turn,
          lastTouchedTurn: turn,
          ...(e.microMarket ? { microMarket: e.microMarket } : {}),
          ...(e.startingPriceDisplay !== undefined
            ? { startingPriceDisplay: e.startingPriceDisplay }
            : {}),
          ...(e.startingPriceInr !== undefined ? { startingPriceInr: e.startingPriceInr } : {}),
          ...(e.tradeoffNote !== undefined ? { tradeoffNote: e.tradeoffNote } : {}),
          ...(e.dimensionFit !== undefined ? { dimensionFit: e.dimensionFit } : {}),
          ...(e.dimensionGap !== undefined ? { dimensionGap: e.dimensionGap } : {}),
          ...(e.offeredRank !== undefined ? { offeredRank: e.offeredRank } : {}),
        };
    changed = true;
  }

  return changed ? { ...state, entities: next } : state;
}

/** Drop the `offered` role + card payload from every entity not in `keepIds`. */
export function clearOfferedExcept(
  state: ConversationState,
  keepIds: ReadonlySet<string>,
): ConversationState {
  const entities = state.entities;
  if (!entities) return state;
  let changed = false;
  const next: Record<string, DiscourseEntityRecord> = {};
  for (const [id, e] of Object.entries(entities)) {
    if (e.roles.includes('offered') && !keepIds.has(id)) {
      changed = true;
      next[id] = {
        projectId: e.projectId,
        name: e.name,
        roles: e.roles.filter((r) => r !== 'offered'),
        firstSeenTurn: e.firstSeenTurn,
        lastTouchedTurn: e.lastTouchedTurn,
        ...(e.microMarket ? { microMarket: e.microMarket } : {}),
      };
    } else {
      next[id] = e;
    }
  }
  return changed ? { ...state, entities: next } : state;
}

/** Focus a project, pushing the previous focus down the stack (most recent first). */
export function pushFocus(state: ConversationState, projectId: string, turn: number): ConversationState {
  if (!projectId) return state;
  const entity = state.entities?.[projectId];
  const stack = [projectId, ...(state.focusStack ?? []).filter((id) => id !== projectId)];
  const withRole = entity
    ? recordEntities(
        state,
        [
          {
            projectId,
            name: entity.name,
            ...(entity.microMarket ? { microMarket: entity.microMarket } : {}),
          },
        ],
        'focused',
        turn,
      )
    : state;
  return { ...withRole, focusStack: stack };
}

/**
 * Return to the previous focus. Dual-writes legacy `focus` until focus-field
 * 1c — the stack alone must not diverge from `state.focus` while both exist.
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
 * Trust legacy `state.focus` first while the focus field still dual-writes.
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

export function entityToOffered(e: DiscourseEntityRecord): OfferedProject {
  return {
    projectId: e.projectId,
    name: e.name,
    ...(e.microMarket ? { microMarket: e.microMarket } : {}),
    ...(e.startingPriceDisplay ? { startingPriceDisplay: e.startingPriceDisplay } : {}),
    ...(e.startingPriceInr !== undefined ? { startingPriceInr: e.startingPriceInr } : {}),
    ...(e.tradeoffNote ? { tradeoffNote: e.tradeoffNote } : {}),
    ...(e.dimensionFit ? { dimensionFit: e.dimensionFit } : {}),
    ...(e.dimensionGap ? { dimensionGap: e.dimensionGap } : {}),
  };
}

/**
 * Current search board — Phase 1c authority.
 * Prefer `shortlistIds` + entity card payload; fall back to legacy `lastOffered`
 * for pre-1c KV sessions.
 */
export function currentShortlist(state: ConversationState): OfferedProject[] {
  const ids = state.shortlistIds;
  if (ids?.length && state.entities) {
    const out: OfferedProject[] = [];
    for (const id of ids) {
      const e = state.entities[id];
      if (e) out.push(entityToOffered(e));
    }
    if (out.length) return out;
  }
  return state.discover.lastOffered ?? [];
}

/**
 * Discussed discourse projects (uncapped). Legacy array is a revive fallback
 * and is capped at 6 — store wins when present.
 */
export function discussedList(state: ConversationState): OfferedProject[] {
  const fromStore = Object.values(state.entities ?? {})
    .filter((e) => e.roles.includes('discussed'))
    .sort((a, b) => a.firstSeenTurn - b.firstSeenTurn || a.lastTouchedTurn - b.lastTouchedTurn)
    .map(entityToOffered);
  if (fromStore.length) return fromStore;
  return state.discover.discussedProjects ?? [];
}

/**
 * Conversation-scoped entities in salience order — the pool every resolver
 * should read. Rejected rows are omitted (still retained in `state.entities`).
 */
export function discourseEntities(state: ConversationState): DiscourseEntityRecord[] {
  return salience(state).filter(
    (e) => !e.roles.includes('rejected') && isDiscourseRole(e.roles),
  );
}

/** OfferedProject-shaped view for visit / switch / named-resolve consumers. */
export function discourseOffered(state: ConversationState): OfferedProject[] {
  return discourseEntities(state).map(entityToOffered);
}

/**
 * Mirror store → legacy arrays so remaining raw readers stay correct.
 * Call after every shortlist / discussed write.
 */
export function mirrorLegacyPools(state: ConversationState): ConversationState {
  const lastOffered = currentShortlist(state);
  const discussedProjects = discussedList(state);
  return {
    ...state,
    discover: {
      ...state.discover,
      lastOffered,
      discussedProjects,
    },
  };
}

/**
 * Legacy pool projection (discussed → focus → lastOffered) for membership
 * asserts during dual-write.
 */
export function legacyConversationPoolIds(state: ConversationState): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string | undefined) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  for (const p of discussedList(state)) push(p.projectId);
  push(state.focus?.projectId);
  for (const o of currentShortlist(state)) push(o.projectId);
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

  const stackAlt = (state.focusStack ?? [])[1];
  if (stackAlt && stackAlt !== focusId) {
    const entity = state.entities?.[stackAlt];
    if (entity && !entity.roles.includes('rejected')) return entity;
  }

  return undefined;
}
