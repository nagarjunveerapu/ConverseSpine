/**
 * Phase 1a — one entity store, dual-written.
 *
 * Discourse entities live in five places today — `discover.lastOffered`,
 * `discover.discussedProjects`, `focus`, `projectCache`, `visit.queued` — and
 * 21 resolvers read them in four different orderings. That disagreement IS the
 * bug class:
 *
 *   J7       compare_resolve.projectPool is discussed -> focus -> lastOffered
 *            and the catalog is in none of them, so "comparing Eldorado and
 *            Sanctuary" compared Ayana / Desire Spaces / Vanam
 *   NAME-06  focus is a single slot, not a stack, so there is nothing to pop
 *            back to and no way to reach a longer-named sibling
 *
 * 1a writes the store ALONGSIDE the existing fields and changes no behaviour.
 * Nothing reads it yet. 1b migrates consumers family by family, asserting
 * `salience(state)` still matches the old projection at each step; 1c deletes
 * the old fields once no reader remains.
 *
 * DURABLE SHAPE. `store-kv.ts:28` is `JSON.stringify(state)`, and a Map/Set
 * round-trips to `{}` — silently, and it typechecks. So the store is a
 * `Record<>` of plain records and salience is a PURE FUNCTION over state,
 * never a method on it. (Caught in review before it shipped.)
 */
import { describe, expect, it } from 'vitest';
import {
  recordEntities,
  pushFocus,
  popFocus,
  salience,
  focusedEntity,
  type DiscourseEntityRecord,
} from '../../src/engine/entity-store.js';
import { initState } from '../../src/engine/state.js';
import type { ConversationState } from '../../src/engine/types.js';

const ELDORADO = { projectId: 'eldorado', name: 'Brigade Eldorado' };
const CORNERSTONE = { projectId: 'cornerstone', name: 'Brigade Cornerstone' };
const UTOPIA = { projectId: 'utopia', name: 'Brigade Cornerstone Utopia' };

const names = (rows: DiscourseEntityRecord[]) => rows.map((r) => r.name);

describe('the store survives being persisted', () => {
  it('round-trips through JSON with its contents intact', () => {
    let s: ConversationState = initState('c1', 'naya-advisor');
    s = recordEntities(s, [ELDORADO, CORNERSTONE], 'offered', 1);
    s = pushFocus(s, ELDORADO.projectId, 2);

    const revived = JSON.parse(JSON.stringify(s)) as ConversationState;

    expect(Object.keys(revived.entities ?? {})).toHaveLength(2);
    expect(revived.focusStack).toEqual(['eldorado']);
    expect(names(salience(revived))[0]).toBe('Brigade Eldorado');
  });
});

describe('one salience order, not four pools', () => {
  it('current focus leads', () => {
    let s = recordEntities(initState('c1', 'b'), [ELDORADO, CORNERSTONE], 'offered', 1);
    s = pushFocus(s, CORNERSTONE.projectId, 2);
    expect(names(salience(s))[0]).toBe('Brigade Cornerstone');
  });

  it('the stack orders what was focused before, most recent first', () => {
    let s = recordEntities(initState('c1', 'b'), [ELDORADO, CORNERSTONE, UTOPIA], 'offered', 1);
    s = pushFocus(s, ELDORADO.projectId, 2);
    s = pushFocus(s, CORNERSTONE.projectId, 3);
    s = pushFocus(s, UTOPIA.projectId, 4);
    expect(names(salience(s)).slice(0, 3)).toEqual([
      'Brigade Cornerstone Utopia',
      'Brigade Cornerstone',
      'Brigade Eldorado',
    ]);
  });

  it('popping the stack returns to the previous focus — NAME-06 needs this', () => {
    let s = recordEntities(initState('c1', 'b'), [ELDORADO, CORNERSTONE], 'offered', 1);
    s = pushFocus(s, ELDORADO.projectId, 2);
    s = pushFocus(s, CORNERSTONE.projectId, 3);
    s = popFocus(s);
    expect(names(salience(s))[0]).toBe('Brigade Eldorado');
  });

  it('a rejected project ranks last but is never forgotten — a rejection is information', () => {
    let s = recordEntities(initState('c1', 'b'), [ELDORADO, CORNERSTONE], 'offered', 1);
    s = recordEntities(s, [ELDORADO], 'rejected', 2);
    const ordered = names(salience(s));
    expect(ordered).toHaveLength(2);
    expect(ordered[ordered.length - 1]).toBe('Brigade Eldorado');
  });

  it('recency breaks ties between equally-ranked entities', () => {
    let s = recordEntities(initState('c1', 'b'), [ELDORADO], 'offered', 1);
    s = recordEntities(s, [CORNERSTONE], 'offered', 5);
    expect(names(salience(s))[0]).toBe('Brigade Cornerstone');
  });

  it('never stores a slug as a name — ProjectDetail.name invariant', () => {
    const s = recordEntities(initState('c1', 'b'), [{ projectId: 'eldorado', name: '' }], 'offered', 1);
    expect(s.entities?.eldorado).toBeUndefined();
  });

  it('re-recording an entity merges roles rather than duplicating it', () => {
    let s = recordEntities(initState('c1', 'b'), [ELDORADO], 'offered', 1);
    s = recordEntities(s, [ELDORADO], 'discussed', 2);
    expect(Object.keys(s.entities ?? {})).toHaveLength(1);
    expect(s.entities!.eldorado!.roles.sort()).toEqual(['discussed', 'offered']);
  });
});

describe('1a changes no behaviour — it only writes alongside', () => {
  it('leaves the legacy fields exactly as they were', () => {
    const before = initState('c1', 'b');
    const after = recordEntities(before, [ELDORADO], 'offered', 1);
    expect(after.discover.lastOffered).toEqual(before.discover.lastOffered);
    expect(after.discover.discussedProjects).toEqual(before.discover.discussedProjects);
    expect(after.focus).toEqual(before.focus);
  });
});

/**
 * THE DUAL-WRITE INVARIANT.
 *
 * LLD open question 6: what asserts `salience(state)` still matches the old
 * projection while both exist? This does. It runs real turns through
 * `runEngineTurn` and checks the store against the legacy fields it shadows.
 *
 * While 1a holds, a divergence here means the dual-write is wrong. Once 1b
 * starts migrating consumers, a divergence means a consumer changed behaviour —
 * which is exactly the signal that phase needs, so this test stays.
 */
describe('dual-write invariant: the store agrees with the fields it shadows', () => {
  it('holds across a real search → focus → switch journey', async () => {
    const { runEngineTurn } = await import('../../src/engine/turn.js');
    const { fakeDeps } = await import('../fakes.js');
    const deps = fakeDeps();
    const say = (text: string) =>
      runEngineTurn({ convId: 'dual-write', builderId: 'lokations', text, channel: 'advisor_web' }, deps);

    await say('hi');
    await say('plantation in sakleshpur');
    const focused = await say('give me details on the project');
    const s = focused.state;

    // Everything the legacy fields know, the store knows.
    for (const o of s.discover.lastOffered) {
      expect(s.entities?.[o.projectId], `offered ${o.projectId} missing from store`).toBeDefined();
      expect(s.entities![o.projectId]!.name).toBe(o.name);
    }
    for (const d of s.discover.discussedProjects ?? []) {
      expect(s.entities?.[d.projectId], `discussed ${d.projectId} missing from store`).toBeDefined();
    }
    if (s.focus) {
      expect(s.focusStack?.[0]).toBe(s.focus.projectId);
      expect(focusedEntity(s)?.name).toBe(s.focus.projectName);
    }
    // And the store never invents an entity the conversation never saw.
    const known = new Set([
      ...s.discover.lastOffered.map((o) => o.projectId),
      ...(s.discover.discussedProjects ?? []).map((d) => d.projectId),
      ...(s.focus ? [s.focus.projectId] : []),
    ]);
    for (const id of Object.keys(s.entities ?? {})) expect(known.has(id)).toBe(true);
  });

  it('keeps a project the legacy cap of 6 would have dropped', async () => {
    // recordDiscussed slices to the last 6. The store does not, because a
    // dropped entity is how a project the buyer engaged with becomes
    // unreachable to every later resolver.
    const { recordDiscussed } = await import('../../src/engine/state.js');
    let s = initState('cap', 'b');
    for (let i = 0; i < 8; i++) {
      s = recordDiscussed(s, [{ projectId: `p${i}`, name: `Project ${i}` }]);
    }
    expect(s.discover.discussedProjects).toHaveLength(6);
    expect(Object.keys(s.entities ?? {})).toHaveLength(8);
  });
});
