import { describe, expect, it } from 'vitest';
import { MIN_SUPPORT, rankChips } from '../src/chips/rank.js';
import { buildChipShadow, goalState } from '../src/chips/shadow.js';
import { buildLedgerWritePayload } from '../src/engine/ledger-write.js';
import { CHIP_TABLE_ID, CHIP_TRANSITIONS } from '../src/chips/transition-table.js';
import type {
  ConversationState,
  EvidenceSet,
  Extracted,
  ProjectDetail,
  TurnGoal,
} from '../src/engine/types.js';

/**
 * Chips ranked by what the buyer does next, not by a hand-written list.
 *
 * The list in nba.ts is fixed per goal kind: every buyer who reaches
 * `answer/overview` sees the same four chips in the same order, whether or not
 * the project has a price, and whether or not anyone has ever tapped them.
 *
 * These pin the three properties that make the ranker safe to put in front of
 * a buyer later: it never offers a fact we do not have, it never falls back to
 * noise, and it degrades to a sane prior instead of an empty list.
 */
const detail = (over: Partial<ProjectDetail> = {}): ProjectDetail => ({
  projectId: 'p1',
  name: 'Brigade Orchards',
  microMarket: 'Devanahalli',
  ...over,
});

const evidence = (over: Partial<Parameters<typeof rankChips>[0]['evidence']> = {}) => ({
  shortlistSize: 3,
  ...over,
});

describe('the ranking comes from the ledger, not from a list', () => {
  it('orders chips by how often buyers actually go there next', () => {
    const r = rankChips({
      phase: 'focused',
      state: 'answer/overview',
      evidence: evidence({
        focused: detail({
          configurations: [{ unitType: '3 BHK', priceDisplay: '₹82 L', priceMinInr: 8200000 }],
          reraNumber: 'PRM/KA/RERA/1',
        }),
      }),
    });
    // From the real table: after an overview in focus, availability and price
    // are the two commonest next asks. If this ever inverts, the table changed.
    expect(r.chips.map((c) => c.state)).toContain('answer/availability');
    expect(r.chips[0]!.p).toBeGreaterThan(r.chips[r.chips.length - 1]!.p);
    expect(r.level).toBe('cell');
  });

  it('reports which table produced it, so a swap is visible in the data', () => {
    const r = rankChips({ phase: 'focused', state: 'answer/overview', evidence: evidence() });
    expect(r.table).toBe(CHIP_TABLE_ID);
    expect(CHIP_TABLE_ID).toMatch(/^ct-[0-9a-f]{10}$/);
  });

  it('never offers the state it just answered as the next step', () => {
    // Self-transitions are real in the data — buyers ask two price questions in
    // a row — but "ask that again" is not a next step.
    const r = rankChips({ phase: 'focused', state: 'answer/overview', evidence: evidence({ focused: detail() }) });
    expect(r.chips.map((c) => c.state)).not.toContain('answer/overview');
  });
});

describe('a chip is never offered for a fact we do not have', () => {
  it('holds back prices when the project has none', () => {
    const r = rankChips({
      phase: 'focused',
      state: 'answer/overview',
      evidence: evidence({ focused: detail() }), // no configurations, no price
    });
    expect(r.chips.map((c) => c.state)).not.toContain('answer/price');
    expect(r.held ?? r.suppressed.map((s) => s.state)).toContain('answer/price');
  });

  it('holds back EMI without a price to amortise', () => {
    const r = rankChips({ phase: 'focused', state: 'answer/price', evidence: evidence({ focused: detail() }) });
    expect(r.chips.map((c) => c.state)).not.toContain('answer/emi');
  });

  it('offers legal once the project actually carries a RERA number', () => {
    const bare = rankChips({
      phase: 'focused', state: 'answer/overview', evidence: evidence({ focused: detail() }),
    });
    const withRera = rankChips({
      phase: 'focused', state: 'answer/overview',
      evidence: evidence({ focused: detail({ reraNumber: 'PRM/KA/RERA/1' }) }),
    });
    expect(bare.chips.map((c) => c.state)).not.toContain('answer/legal');
    expect(withRera.chips.map((c) => c.state)).toContain('answer/legal');
  });

  it('does not offer a comparison of one project', () => {
    const r = rankChips({ phase: 'discover', state: 'recommend', evidence: evidence({ shortlistSize: 1 }) });
    expect(r.chips.map((c) => c.state)).not.toContain('answer/compare');
  });

  it('records WHY each held chip was held — the gap is the useful part', () => {
    const r = rankChips({ phase: 'focused', state: 'answer/overview', evidence: evidence({ focused: detail() }) });
    const price = r.suppressed.find((s) => s.state === 'answer/price');
    expect(price?.suppressed).toBe('no_evidence');
  });

  it('drops a chip the buyer was just shown and did not take', () => {
    const shown = rankChips({
      phase: 'focused', state: 'answer/overview',
      evidence: evidence({ focused: detail({ configurations: [{ unitType: '3 BHK', priceDisplay: '₹82 L', priceMinInr: 8200000 }] }) }),
    });
    const label = shown.chips[0]!.label;
    const again = rankChips({
      phase: 'focused', state: 'answer/overview',
      evidence: evidence({ focused: detail({ configurations: [{ unitType: '3 BHK', priceDisplay: '₹82 L', priceMinInr: 8200000 }] }) }),
      recentlyShown: [label],
    });
    expect(again.chips.map((c) => c.label)).not.toContain(label);
  });
});

describe('backoff terminates instead of returning noise', () => {
  it('falls back to the phase prior for a state with no evidence', () => {
    const r = rankChips({ phase: 'focused', state: 'a_state_that_has_never_happened', evidence: evidence() });
    expect(r.level).toBe('phase');
    expect(r.chips.length).toBeGreaterThan(0);
  });

  it('falls back to the global prior for a phase we have never seen', () => {
    const r = rankChips({ phase: 'not_a_phase', state: 'nor_a_state', evidence: evidence() });
    expect(r.level).toBe('global');
    expect(r.chips.length).toBeGreaterThan(0);
  });

  it('treats a thin cell as thin rather than trusting it', () => {
    const thin = Object.entries(CHIP_TRANSITIONS).find(
      ([, v]) => Object.values(v).reduce((a, b) => a + b, 0) < MIN_SUPPORT,
    );
    if (!thin) return; // no thin cells in the current table — nothing to assert
    const [key] = thin;
    const [phase, state] = key.split('|');
    expect(rankChips({ phase: phase!, state: state!, evidence: evidence() }).level).not.toBe('cell');
  });
});

describe('the shadow log reaches the ledger', () => {
  const state = {
    convId: 'c1',
    builderId: 'naya-advisor',
    phase: 'focused',
    turnCount: 3,
    constraints: {},
    discover: { lastOffered: [{ projectId: 'p1', name: 'Brigade Orchards' }], discussedProjects: [] },
  } as unknown as ConversationState;

  const goal = { kind: 'answer', topic: 'overview' } as TurnGoal;
  const ev = { tools: [], detail: detail({ reraNumber: 'PRM/KA/RERA/1' }) } as unknown as EvidenceSet;

  it('keys the table on kind + topic, the way the table was built', () => {
    expect(goalState(goal)).toBe('answer/overview');
    expect(goalState({ kind: 'recommend' } as TurnGoal)).toBe('recommend');
  });

  it('survives the action_plan projection', () => {
    // `routing_bind` existed in code and in NO ledger row for 12,036 turns,
    // because this projection is hand-picked and quietly dropped it. A shadow
    // that never lands is a shadow that measures nothing.
    const payload = buildLedgerWritePayload({
      state,
      ex: { constraints: {}, transition: 'none' } as Extracted,
      goal,
      evidence: ev,
    });
    const shadow = payload.action_plan.chip_shadow as ReturnType<typeof buildChipShadow>;
    expect(shadow).toBeTruthy();
    expect(shadow.from).toBe('answer/overview');
    expect(shadow.phase).toBe('focused');
    expect(shadow.table).toBe(CHIP_TABLE_ID);
    expect(shadow.ranked.length).toBeGreaterThan(0);
  });

  it('carries enough to score the prediction against the next turn alone', () => {
    const shadow = buildChipShadow({ state, goal, evidence: ev });
    // A scorer needs: what we predicted, how confident, and whether the cell
    // was real. Everything else it gets from the next row.
    for (const key of ['from', 'phase', 'level', 'support', 'ranked', 'table'] as const) {
      expect(shadow, key).toHaveProperty(key);
    }
    expect(shadow.ranked[0]).toHaveProperty('p');
  });
});
