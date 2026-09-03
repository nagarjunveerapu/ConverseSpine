/**
 * Unbound-name typing (PR-2-lite) — SUBJECT plan rows for J7 honesty + catalog match.
 *
 * Run: `npm run test:unbound-name`
 */
import { describe, expect, it } from 'vitest';
import { resolveCompareProjectIds } from '../src/engine/compare_resolve.js';
import {
  extractCompareNameCandidates,
  stampNamedAndUnbound,
} from '../src/engine/named_bind.js';
import { initState } from '../src/engine/state.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';

const SHORTLIST = [
  { projectId: 'ayana', name: 'Ayana' },
  { projectId: 'desire-spaces', name: 'Desire Spaces' },
  { projectId: 'vanam', name: 'Vanam' },
] as const;

const CATALOG = [
  { projectId: 'ayana', name: 'Ayana' },
  { projectId: 'krishnaja', name: 'Krishnaja Greens' },
  { projectId: 'eldorado', name: 'Brigade Eldorado' },
  { projectId: 'sanctuary', name: 'Brigade Sanctuary' },
];

function harness(threadId: string) {
  const deps = fakeDeps();
  const turn = (text: string) =>
    runEngineTurn(
      {
        threadId,
        builderId: 'naya-advisor',
        text,
        buyerPhone: `+9199${threadId.replace(/\W/g, '').slice(-8).padStart(8, '0')}`,
        channel: 'advisor_web',
      },
      deps,
    );
  return { deps, turn };
}

async function seedShortlist(
  deps: ReturnType<typeof fakeDeps>,
  threadId: string,
  offered: ReadonlyArray<{ projectId: string; name: string }> = SHORTLIST,
) {
  await runEngineTurn(
    {
      threadId,
      builderId: 'naya-advisor',
      text: 'hi',
      buyerPhone: `+9199${threadId.replace(/\W/g, '').slice(-8).padStart(8, '0')}`,
      channel: 'advisor_web',
    },
    deps,
  );
  const s = await deps.store.load(threadId);
  expect(s).toBeTruthy();
  s!.discover.lastOffered = offered.map((o) => ({ ...o }));
  await deps.store.save(s!);
}

describe('UN — unbound-name typing + catalog compare match', () => {
  it('UN-01 comparing Eldorado and Sanctuary → those two, not shortlist Ayana', async () => {
    const { deps, turn } = harness('un01');
    await seedShortlist(deps, 'un01');
    const r = await turn('comparing Eldorado and Sanctuary');
    expect(r.reply).toMatch(/Eldorado/i);
    expect(r.reply).toMatch(/Sanctuary/i);
    expect(r.reply).not.toMatch(/Ayana/i);
    expect(r.debug.goal.kind === 'answer' && r.debug.goal.topic === 'compare').toBe(true);
  });

  it('UN-02 compare ayana and krishnaja greens still binds those two', async () => {
    const { deps, turn } = harness('un02');
    await seedShortlist(deps, 'un02', [
      { projectId: 'ayana', name: 'Ayana' },
      { projectId: 'krishnaja', name: 'Krishnaja Greens' },
      { projectId: 'clarks', name: 'Clarks Exotica' },
    ]);
    const r = await turn('compare ayana and krishnaja greens');
    expect(r.reply).toMatch(/Ayana/i);
    expect(r.reply).toMatch(/Krishnaja/i);
    expect(r.reply).not.toMatch(/Clarks/i);
  });

  it('UN-03 compare both / anaphora still uses conversation pool', async () => {
    const { deps, turn } = harness('un03');
    await seedShortlist(deps, 'un03', [
      { projectId: 'ayana', name: 'Ayana' },
      { projectId: 'krishnaja', name: 'Krishnaja Greens' },
    ]);
    const s = await deps.store.load('un03');
    s!.discover.discussedProjects = [
      { projectId: 'ayana', name: 'Ayana' },
      { projectId: 'krishnaja', name: 'Krishnaja Greens' },
    ];
    await deps.store.save(s!);
    const r = await turn('compare both');
    expect(r.reply).toMatch(/Ayana/i);
    expect(r.reply).toMatch(/Krishnaja/i);
  });

  it('UN-04 Prestige Lakeside unbound → clarify, not pool-guess', async () => {
    const { deps, turn } = harness('un04');
    await seedShortlist(deps, 'un04');
    const r = await turn('compare Prestige Lakeside and Eldorado');
    // Must not pool-guess the shortlist as the compare set.
    expect(r.reply).not.toMatch(/Ayana/i);
    expect(r.reply).not.toMatch(/Desire Spaces/i);
    expect(r.reply).not.toMatch(/\bVanam\b/i);
    const wrongCompare =
      r.debug.goal.kind === 'answer' &&
      r.debug.goal.topic === 'compare' &&
      r.debug.tools.includes('compare') &&
      /Ayana|Desire|Vanam/i.test(r.reply);
    expect(wrongCompare).toBe(false);
  });

  it('UN-05 unit: unboundProjectNames set; pool fall-through blocked', () => {
    expect(extractCompareNameCandidates('comparing Eldorado and Sanctuary')).toEqual([
      'Eldorado',
      'Sanctuary',
    ]);
    expect(extractCompareNameCandidates('compare both')).toEqual([]);
    expect(extractCompareNameCandidates('compare Prestige Lakeside and Eldorado')).toEqual([
      'Prestige Lakeside',
      'Eldorado',
    ]);

    const state = {
      ...initState('un05', 'naya-advisor'),
      discover: {
        ...initState('un05', 'naya-advisor').discover,
        lastOffered: SHORTLIST.map((o) => ({ ...o })),
      },
    };

    // Prior-state defect: compare topic + no catalog + no unbound → shortlist pool-guess.
    const priorIds = resolveCompareProjectIds(
      'comparing Eldorado and Sanctuary',
      { constraints: {}, askTopic: 'compare' },
      state,
      [],
    );
    expect(priorIds).toEqual(['ayana', 'desire-spaces', 'vanam']);
    const stamped = stampNamedAndUnbound(
      'compare Prestige Lakeside and Eldorado',
      { constraints: {}, askTopic: 'compare' },
      { session: SHORTLIST.map((o) => ({ ...o })), catalog: CATALOG },
    );
    expect(stamped.unboundProjectNames?.length).toBeGreaterThan(0);
    expect(stamped.unboundProjectNames!.some((n) => /prestige/i.test(n))).toBe(true);
    expect(stamped.namedProjects?.map((p) => p.projectId)).toContain('eldorado');

    const ids = resolveCompareProjectIds(
      'compare Prestige Lakeside and Eldorado',
      stamped,
      state,
      CATALOG,
    );
    expect(ids).toEqual([]);

    const j7 = stampNamedAndUnbound(
      'comparing Eldorado and Sanctuary',
      { constraints: {} },
      { session: SHORTLIST.map((o) => ({ ...o })), catalog: CATALOG },
    );
    expect(j7.unboundProjectNames ?? []).toHaveLength(0);
    expect(j7.namedProjects?.map((p) => p.projectId).sort()).toEqual(['eldorado', 'sanctuary']);
    const j7Ids = resolveCompareProjectIds(
      'comparing Eldorado and Sanctuary',
      j7,
      state,
      CATALOG,
    );
    expect(j7Ids.sort()).toEqual(['eldorado', 'sanctuary']);
  });
});
