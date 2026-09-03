/**
 * Phase 1c — adversarial state suite.
 *
 * Goal: confuse discourse state (poison mirrors, diverge focus/stack, thrash
 * shortlist, switch/compare/release spam) and assert the entity store remains
 * the authority. Pass count alone is not enough — every step checks invariants.
 *
 * Gate: `npm run test:phase-1c`
 */
import { describe, expect, it } from 'vitest';
import {
  currentShortlist,
  discussedList,
  focusedEntity,
  focusedRef,
  discourseEntities,
} from '../src/engine/entity-store.js';
import { prepareCompareExtracted } from '../src/engine/turn-intent/compare-intent.js';
import { detectFocusedSwitchIntent } from '../src/engine/project_switch.js';
import { decide as decideDiscover } from '../src/engine/phases/discover.js';
import { resolveCompareProjectIds } from '../src/engine/compare_resolve.js';
import {
  clearLastOffered,
  commitTo,
  initState,
  recordDiscussed,
  recordOffered,
  releaseToDiscover,
} from '../src/engine/state.js';
import { runEngineTurn } from '../src/engine/turn.js';
import type { ThreadState, Match } from '../src/engine/types.js';
import { buildAdvisorNba } from '../src/advisor/nba.js';
import { fakeDeps, projectDetailFor } from './fakes.js';
import {
  gradeCompareBoth,
  gradeOtherOne,
  gradeReraGrounded,
  gradeShowSomethingElse,
} from './phase-1c-chat-quality.js';

const AYANA: Match = {
  projectId: 'ayana',
  name: 'Ayana',
  microMarket: 'Sakleshpur',
  startingPriceInr: 2_495_000,
  startingPriceDisplay: '₹24.95 L',
  matchReasons: [],
  tradeoffNote: 'estate pick',
};
const KRISHNAJA: Match = {
  projectId: 'krishnaja',
  name: 'Krishnaja Greens',
  microMarket: 'Virajpet',
  startingPriceInr: 3_900_000,
  startingPriceDisplay: '₹39 L',
  matchReasons: [],
};
const CLARKS: Match = {
  projectId: 'clarks',
  name: 'Clarks Exotica',
  microMarket: 'North Bangalore',
  startingPriceInr: 7_500_000,
  startingPriceDisplay: '₹75 L',
  matchReasons: [],
};
const ELDORADO: Match = {
  projectId: 'eldorado',
  name: 'Brigade Eldorado',
  microMarket: 'North Bangalore',
  startingPriceInr: 6_500_000,
  startingPriceDisplay: '₹65 L',
  matchReasons: [],
};
const SANCTUARY: Match = {
  projectId: 'sanctuary',
  name: 'Brigade Sanctuary',
  microMarket: 'Sarjapur Road',
  startingPriceInr: 7_900_000,
  startingPriceDisplay: '₹79 L',
  matchReasons: [],
};

/** Poison the mirror without touching the store — simulates a desync bug. */
function poisonMirror(
  s: ThreadState,
  bogus: Array<{ projectId: string; name: string }>,
): ThreadState {
  return {
    ...s,
    discover: {
      ...s.discover,
      lastOffered: bogus,
      discussedProjects: bogus.slice(0, 1),
    },
  };
}

function assertFocusedInvariants(s: ThreadState, step: string): void {
  if (s.phase !== 'focused') {
    expect(focusedRef(s), `${step}: no focus in ${s.phase}`).toBeUndefined();
    return;
  }
  const ref = focusedRef(s);
  expect(ref, `${step}: focusedRef`).toBeDefined();
  expect(s.focusStack?.[0], `${step}: stack[0]`).toBe(ref!.projectId);
  if (s.focus) {
    expect(s.focus.projectId, `${step}: legacy focus dual-write`).toBe(ref!.projectId);
  }
  expect(focusedEntity(s)?.projectId, `${step}: focusedEntity`).toBe(ref!.projectId);
}

function assertShortlistAuthority(s: ThreadState, step: string): void {
  const board = currentShortlist(s);
  if (s.shortlistIds?.length) {
    expect(
      board.map((o) => o.projectId),
      `${step}: shortlistIds → currentShortlist`,
    ).toEqual(s.shortlistIds);
    // Store wins even when the mirror lies.
    for (const id of s.shortlistIds) {
      expect(s.entities?.[id], `${step}: entity ${id}`).toBeDefined();
      expect(s.entities![id]!.roles.includes('offered'), `${step}: offered role ${id}`).toBe(true);
    }
  }
}

function assertDiscussedUncapped(s: ThreadState, minStore: number, step: string): void {
  const storeN = discussedList(s).length;
  expect(storeN, `${step}: discussedList`).toBeGreaterThanOrEqual(minStore);
  // Mirror may be sliced to 6; store must not lose history.
  if (minStore > 6) {
    expect(storeN, `${step}: store beats legacy cap`).toBeGreaterThan(6);
    expect((s.discover.discussedProjects ?? []).length).toBeLessThanOrEqual(6);
  }
}

describe('1C-ADV — poisoned mirror cannot hijack consumers', () => {
  it('currentShortlist ignores a lying lastOffered when shortlistIds exist', () => {
    let s = recordOffered(initState('adv-poison', 'lokations'), [AYANA, KRISHNAJA]);
    s = poisonMirror(s, [
      { projectId: 'clarks', name: 'Clarks Exotica' },
      { projectId: 'eldorado', name: 'Brigade Eldorado' },
    ]);
    expect(s.discover.lastOffered.map((o) => o.projectId)).toEqual(['clarks', 'eldorado']);
    expect(currentShortlist(s).map((o) => o.projectId)).toEqual(['ayana', 'krishnaja']);
  });

  it('prepareCompareExtracted "compare both" uses discussed store, not poisoned shortlist', () => {
    let s = recordOffered(initState('adv-cmp', 'lokations'), [CLARKS, ELDORADO]);
    s = recordDiscussed(s, [
      { projectId: 'ayana', name: 'Ayana' },
      { projectId: 'krishnaja', name: 'Krishnaja Greens' },
    ]);
    s = poisonMirror(s, [
      { projectId: 'clarks', name: 'Clarks Exotica' },
      { projectId: 'eldorado', name: 'Brigade Eldorado' },
    ]);
    const ex = prepareCompareExtracted('compare both the projects', s, {
      constraints: {},
      askTopic: 'compare',
    });
    expect(ex.compareProjectIds).toEqual(['ayana', 'krishnaja']);
  });

  it('resolveCompareProjectIds anaphora survives poisoned lastOffered', () => {
    let s = recordOffered(initState('adv-refs', 'lokations'), [CLARKS]);
    s = recordDiscussed(s, [
      { projectId: 'ayana', name: 'Ayana' },
      { projectId: 'krishnaja', name: 'Krishnaja Greens' },
    ]);
    s = poisonMirror(s, [{ projectId: 'eldorado', name: 'Brigade Eldorado' }]);
    const ids = resolveCompareProjectIds('compare both', { askTopic: 'compare', constraints: {} }, s);
    expect(ids).toEqual(['ayana', 'krishnaja']);
  });

  it('discover decide does not pick a poisoned shortlist head', () => {
    let s = recordOffered(initState('adv-dec', 'lokations'), [AYANA, KRISHNAJA]);
    s = poisonMirror(s, [
      { projectId: 'eldorado', name: 'Brigade Eldorado' },
      { projectId: 'sanctuary', name: 'Brigade Sanctuary' },
    ]);
    const goal = decideDiscover(s, {
      constraints: {},
      askTopic: 'compare',
      transition: 'none',
    });
    // Bare compare with 2+ board → answer/compare on board[0] from store (Ayana).
    if (goal.kind === 'answer' && goal.topic === 'compare') {
      expect(goal.projectId).toBe('ayana');
    } else {
      // Or clarify / other — never Eldorado from the poison.
      expect(JSON.stringify(goal)).not.toMatch(/eldorado/i);
    }
  });

  it('Advisor NBA shortlist chips come from store after poison', () => {
    let s = recordOffered(initState('adv-nba', 'lokations'), [AYANA, KRISHNAJA]);
    s = poisonMirror(s, [{ projectId: 'eldorado', name: 'Brigade Eldorado' }]);
    const nba = buildAdvisorNba(
      s,
      {
        phase: 'discover',
        goal: { kind: 'recommend', matches: [] },
        tools: [],
        grounding: [],
      } as never,
      false,
    );
    const blob = nba.chips.join(' | ');
    expect(blob).toMatch(/Ayana|Krishnaja/i);
    expect(blob).not.toMatch(/Eldorado/i);
  });
});

describe('1C-ADV — focus stack vs legacy focus divergence', () => {
  it('focusedRef trusts stack[0] when legacy focus lags', () => {
    let s = recordOffered(initState('adv-focus', 'lokations'), [AYANA, KRISHNAJA]);
    s = commitTo(s, 'ayana', 'Ayana');
    s = commitTo(s, 'krishnaja', 'Krishnaja Greens');
    expect(s.focusStack?.slice(0, 2)).toEqual(['krishnaja', 'ayana']);
    // Simulate a buggy writer that left legacy focus on the old project.
    s = {
      ...s,
      phase: 'focused',
      focus: { projectId: 'ayana', projectName: 'Ayana' },
    };
    expect(focusedRef(s)?.projectId).toBe('krishnaja');
    expect(focusedEntity(s)?.name).toBe('Krishnaja Greens');
  });

  it('release clears stack so focusedRef cannot resurrect focus', () => {
    let s = recordOffered(initState('adv-rel', 'lokations'), [AYANA]);
    s = commitTo(s, 'ayana', 'Ayana');
    s = releaseToDiscover(s);
    expect(s.focus).toBeUndefined();
    expect(s.focusStack ?? []).toEqual([]);
    expect(focusedRef(s)).toBeUndefined();
  });
});

describe('1C-ADV — clear / replace / thrash shortlist', () => {
  it('clearLastOffered empties board authority', () => {
    let s = recordOffered(initState('adv-clr', 'lokations'), [AYANA, KRISHNAJA]);
    s = clearLastOffered(s);
    expect(s.shortlistIds ?? []).toEqual([]);
    expect(currentShortlist(s)).toHaveLength(0);
    expect(detectFocusedSwitchIntent('the other one', {}, commitTo(s, 'ayana', 'Ayana'))).toBeNull();
  });

  it('replacement shortlist drops offered role from prior board', () => {
    let s = recordOffered(initState('adv-rep', 'naya-advisor'), [ELDORADO, SANCTUARY]);
    s = recordOffered(s, [AYANA]);
    assertShortlistAuthority(s, 'after replace');
    expect(currentShortlist(s).map((o) => o.projectId)).toEqual(['ayana']);
    expect(s.entities?.eldorado?.roles.includes('offered')).toBe(false);
    expect(s.entities?.sanctuary?.roles.includes('offered')).toBe(false);
  });

  it('discussed store keeps projects past the legacy cap of 6', () => {
    let s = initState('adv-cap', 'lokations');
    for (let i = 0; i < 8; i++) {
      s = recordDiscussed(s, [{ projectId: `p${i}`, name: `Project ${i}` }]);
    }
    assertDiscussedUncapped(s, 8, 'cap');
  });
});

describe('1C-ADV — confuse-the-bot multi-turn journeys (fakeDeps)', () => {
  it('ADV-J1: offer → focus → other one → compare both → release → new board', async () => {
    const deps = fakeDeps();
    const threadId = 'adv-j1';
    const say = (text: string) =>
      runEngineTurn(
        { threadId, builderId: 'lokations', text, buyerPhone: '+919900001001', channel: 'advisor_web' },
        deps,
      );

    // Seed a clean two-project board + focus via store writers, then thrash via turns.
    let s = initState(threadId, 'lokations');
    s = recordOffered(s, [AYANA, KRISHNAJA]);
    s = commitTo(s, 'ayana', 'Ayana');
    await deps.store.save(s);
    assertFocusedInvariants(s, 'seed');
    assertShortlistAuthority(s, 'seed');

    const t1 = await say('what about the other one');
    expect(t1.state.focus?.projectId).toBe('krishnaja');
    assertFocusedInvariants(t1.state, 't1-other-one');
    // Poison mid-flight and ensure next turn still holds.
    await deps.store.save(
      poisonMirror(t1.state, [
        { projectId: 'eldorado', name: 'Brigade Eldorado' },
        { projectId: 'sanctuary', name: 'Brigade Sanctuary' },
      ]),
    );

    const t2 = await say('compare both');
    const blob2 = `${t2.reply} ${JSON.stringify(t2.debug)}`;
    expect(blob2).toMatch(/ayana|krishnaja/i);
    expect(blob2).not.toMatch(/eldorado|sanctuary/i);
    assertShortlistAuthority(t2.state, 't2-compare');

    const t3 = await say('show me other projects');
    // Pivot / release class — focus must not silently stick via a stale stack.
    if (t3.state.phase === 'discover') {
      expect(t3.state.focusStack ?? []).toEqual([]);
      expect(focusedRef(t3.state)).toBeUndefined();
    }
  });

  it('ADV-J2: sibling NAME-06 switch then go-back deixis', async () => {
    const deps = fakeDeps();
    const threadId = 'adv-j2';
    const say = (text: string) =>
      runEngineTurn(
        {
          threadId,
          builderId: 'naya-advisor',
          text,
          buyerPhone: '+919900001002',
          channel: 'advisor_web',
        },
        deps,
      );

    const t1 = await say('tell me about Brigade Cornerstone');
    expect(t1.state.phase).toBe('focused');
    expect(t1.state.focus?.projectId).not.toMatch(/utopia/i);
    assertFocusedInvariants(t1.state, 'j2-t1');

    const t2 = await say('what about Brigade Cornerstone Utopia');
    expect(t2.state.focus?.projectId).toMatch(/utopia/i);
    assertFocusedInvariants(t2.state, 'j2-t2');
    expect((t2.state.focusStack?.length ?? 0) >= 2).toBe(true);

    const t3 = await say('go back to the first one');
    // Stack pop / alternate — should leave Utopia for prior Cornerstone when resolvable.
    if (t3.state.phase === 'focused') {
      assertFocusedInvariants(t3.state, 'j2-t3');
      expect(t3.state.focus?.projectId).not.toMatch(/utopia/i);
    }
  });

  it('ADV-J3: switch spam + facet asks must not invent a third subject', async () => {
    const deps = fakeDeps();
    const threadId = 'adv-j3';
    const say = (text: string) =>
      runEngineTurn(
        { threadId, builderId: 'lokations', text, buyerPhone: '+919900001003', channel: 'advisor_web' },
        deps,
      );

    let s = recordOffered(initState(threadId, 'lokations'), [AYANA, KRISHNAJA]);
    s = commitTo(s, 'ayana', 'Ayana');
    await deps.store.save(s);

    const turns = [
      'pricing?',
      'what about krishnaja greens',
      'and ayana again',
      'the other one',
      'rera?',
      'compare both',
    ];
    let last = s;
    for (const text of turns) {
      const r = await say(text);
      last = r.state;
      if (last.phase === 'focused') assertFocusedInvariants(last, `j3:${text}`);
      assertShortlistAuthority(last, `j3:${text}`);
      // Never invent Eldorado into this lokations thrash.
      const ids = [
        ...currentShortlist(last).map((o) => o.projectId),
        ...(focusedRef(last) ? [focusedRef(last)!.projectId] : []),
        ...discourseEntities(last).map((e) => e.projectId),
      ];
      expect(ids.some((id) => id === 'eldorado'), `j3 invented eldorado on "${text}"`).toBe(false);
    }
    expect(discussedList(last).length).toBeGreaterThanOrEqual(2);
  });

  it('ADV-J4: three-way board — "the other one" must refuse to invent', async () => {
    let s = recordOffered(initState('adv-j4', 'lokations'), [AYANA, KRISHNAJA, CLARKS]);
    s = commitTo(s, 'ayana', 'Ayana');
    expect(detectFocusedSwitchIntent('the other one', {}, s)).toBeNull();

    const deps = fakeDeps();
    await deps.store.save(s);
    const r = await runEngineTurn(
      {
        threadId: 'adv-j4',
        builderId: 'lokations',
        text: 'what about the other one',
        buyerPhone: '+919900001004',
        channel: 'advisor_web',
      },
      deps,
    );
    // Must stay on Ayana (no silent pick of Krishnaja vs Clarks).
    expect(r.state.focus?.projectId).toBe('ayana');
    assertFocusedInvariants(r.state, 'j4');
  });

  it('ADV-J5: empty store session with only legacy lastOffered still revives', () => {
    // Pre-1c KV shape — no entities / shortlistIds.
    const s: ThreadState = {
      ...initState('adv-j5', 'lokations'),
      discover: {
        ...initState('adv-j5', 'lokations').discover,
        lastOffered: [
          { projectId: 'ayana', name: 'Ayana' },
          { projectId: 'krishnaja', name: 'Krishnaja Greens' },
        ],
      },
    };
    expect(s.entities).toBeUndefined();
    expect(s.shortlistIds).toBeUndefined();
    expect(currentShortlist(s).map((o) => o.projectId)).toEqual(['ayana', 'krishnaja']);
  });

  it('ADV-J6: cold search → thrash focus/compare/other-one with poison each turn', async () => {
    const deps = fakeDeps();
    const threadId = 'adv-j6';
    const say = async (text: string) => {
      const before = (await deps.store.load(threadId)) ?? initState(threadId, 'lokations');
      const r = await runEngineTurn(
        { threadId, builderId: 'lokations', text, buyerPhone: '+919900001006', channel: 'advisor_web' },
        deps,
      );
      // Reply quality — state invariants alone let overview-recycle pass.
      if (/\b(?:the other one|go back)\b/i.test(text)) {
        const q = gradeOtherOne({ buyer: text, reply: r.reply, before, after: r.state });
        expect(q, q ? `${q.reason}\n${q.reply}` : '').toBeNull();
      }
      if (/\bcompare\b/i.test(text)) {
        const q = gradeCompareBoth({ buyer: text, reply: r.reply, state: before });
        expect(q, q ? `${q.reason}\n${q.reply}` : '').toBeNull();
      }
      if (/\bsomething else\b/i.test(text)) {
        const q = gradeShowSomethingElse({ buyer: text, reply: r.reply, before, after: r.state });
        expect(q, q ? `${q.reason}\n${q.reply}` : '').toBeNull();
      }
      if (/\brera\b/i.test(text)) {
        const q = gradeReraGrounded({
          buyer: text,
          reply: r.reply,
          // Read from the book, not repeated here — a hardcoded copy is how a
          // fixture and its assertions drift into disagreeing about one project.
          reraFromDetail: projectDetailFor('ayana')!.reraNumber,
        });
        expect(q, q ? `${q.reason}\n${q.reply}` : '').toBeNull();
      }
      // After every buyer turn: lie in the mirror. Next turn must still use the store.
      const poisoned = poisonMirror(r.state, [
        { projectId: 'eldorado', name: 'Brigade Eldorado' },
        { projectId: 'sanctuary', name: 'Brigade Sanctuary' },
      ]);
      await deps.store.save(poisoned);
      return r;
    };

    const script = [
      'hi',
      'plantation in sakleshpur under 50 lakhs',
      'tell me about ayana',
      'pricing?',
      'what about the other one',
      'compare both',
      'go back to the first one',
      'rera for this',
      'show me something else',
      '2 bhk under 50L',
    ];

    let lastFocus: string | undefined;
    for (const text of script) {
      const r = await say(text);
      assertShortlistAuthority(r.state, `j6:${text}`);
      if (r.state.phase === 'focused') {
        assertFocusedInvariants(r.state, `j6:${text}`);
        lastFocus = r.state.focus?.projectId;
        // Poisoned Eldorado must never become focus via mirror lie.
        expect(lastFocus).not.toBe('eldorado');
        expect(lastFocus).not.toBe('sanctuary');
      }
      const discourseIds = discourseEntities(r.state).map((e) => e.projectId);
      // After plantation search we may have ayana/krishnaja/clarks — never invent
      // Brigade names into discourse unless a later search pulled them (it shouldn't
      // under poison-only, since poison does not write entities).
      if (!r.state.entities?.eldorado) {
        expect(discourseIds.includes('eldorado'), `j6 discourse eldorado on "${text}"`).toBe(false);
      }
    }
  });

  it('ADV-J7: unbound Prestige + prior shortlist must not compare the board pair', async () => {
    const deps = fakeDeps();
    const threadId = 'adv-j7';
    let s = recordOffered(initState(threadId, 'lokations'), [AYANA, KRISHNAJA]);
    s = commitTo(s, 'ayana', 'Ayana');
    await deps.store.save(s);

    const r = await runEngineTurn(
      {
        threadId,
        builderId: 'lokations',
        text: 'comparing Prestige Lakeside and Brigade Eldorado',
        buyerPhone: '+919900001007',
        channel: 'advisor_web',
      },
      deps,
    );
    const reply = r.reply.toLowerCase();
    const goal = r.debug?.goal as { kind?: string; topic?: string; projectId?: string } | undefined;
    // Defect: pool-guess "compare both" on Ayana/Krishnaja while Prestige is unbound.
    const comparedBoardPair =
      goal?.kind === 'answer' &&
      goal.topic === 'compare' &&
      /ayana/.test(reply) &&
      /krishnaja/.test(reply);
    expect(comparedBoardPair, `pool-guessed board compare:\n${r.reply}\ngoal=${JSON.stringify(goal)}`).toBe(
      false,
    );
    // Naming Eldorado alone (catalog bind) is allowed; inventing a board compare is not.
    expect(reply).not.toMatch(/ayana[\s\S]{0,80}krishnaja|krishnaja[\s\S]{0,80}ayana/);
  });
});

describe('1C-ADV — invariant sweep after recordOffered journeys', () => {
  it('every write path keeps shortlistIds ↔ entities aligned (mirrors empty)', () => {
    let s = initState('adv-align', 'lokations');
    const boards = [
      [AYANA, KRISHNAJA],
      [ELDORADO, SANCTUARY],
      [AYANA],
      [KRISHNAJA, CLARKS, AYANA],
    ] as const;
    for (const board of boards) {
      s = recordOffered(s, [...board]);
      assertShortlistAuthority(s, `board-${board.map((b) => b.projectId).join('+')}`);
      expect(s.discover.lastOffered).toEqual([]);
      expect(s.shortlistIds).toEqual(board.map((b) => b.projectId));
      for (const m of board) {
        expect(s.entities?.[m.projectId]?.startingPriceDisplay).toBe(m.startingPriceDisplay);
      }
    }
  });
});
