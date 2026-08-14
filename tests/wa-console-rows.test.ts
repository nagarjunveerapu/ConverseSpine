import { describe, expect, it } from 'vitest';
import {
  packWhatsAppInteractive,
  splitProjectStamp,
  waConsoleRows,
  waConsoleTitle,
  WA_CONSOLE_SIZES,
  WA_MENU_PROJECTS,
  WA_MONEY_EMI,
  WA_MONEY_MENU,
  WA_MONEY_PLAN,
  WA_MONEY_TOTAL,
  WA_NODE_LATER,
  WA_NODE_LIFE,
  WA_NODE_PLACE,
  WA_NODE_TIME,
  WA_NODE_TRUST,
  type WaListRow,
  type WaNodeFacts,
} from '../src/channel/wa-pack.js';
import type { SeenFacet } from '../src/engine/entity-store.js';
import { markFacetSeen, recordEntities } from '../src/engine/entity-store.js';
import { commitTo, initState } from '../src/engine/state.js';

/**
 * THE console menu — one builder for every focused turn (founder walk, 14 Aug:
 * "this is a problem of what to present to the user"). Rows are gated on the
 * record, cut to what the buyer already said, and dropped once delivered.
 */

const UNITS = [
  { unitType: '1 BHK', priceDisplay: '₹41L—₹50L', sizeDisplay: '782-799 sqft' },
  { unitType: '2 BHK', priceDisplay: '₹45L—₹77L', sizeDisplay: '720-1259 sqft' },
  { unitType: '3 BHK', priceDisplay: '₹85L—₹110L', sizeDisplay: '1389-1905 sqft' },
];

const FULL_FACTS: WaNodeFacts = {
  projectId: 'cornerstone',
  reraNumber: 'PRM/KA/RERA/1251/446',
  khata: 'A-Khata',
  possession: 'Dec 2027',
  amenities: ['clubhouse', 'pool', 'gym'],
  location: { connectivitySummary: '15 min from the airport' },
  marketIntel: { appreciation3yrPct: 12 },
  mediaKinds: ['brochure', 'payment_plan'],
};

const ALL_FACETS: SeenFacet[] = [
  'card', 'total', 'emi', 'plan', 'trust', 'place', 'life', 'time', 'later', 'brochure',
];

describe('waConsoleRows — the one menu', () => {
  it('draws the full file in the fixed order, money cut to the buyer’s size', () => {
    const { rows, infoCount } = waConsoleRows({ facts: FULL_FACTS, units: UNITS, bhk: '2 BHK' });
    // 9 info rows gate on; 8 slots hold them — Returns is the deterministic drop.
    expect(rows.map((r) => r.id)).toEqual([
      'answer_media',
      WA_MONEY_TOTAL,
      WA_MONEY_PLAN,
      WA_MONEY_EMI,
      WA_NODE_TRUST,
      WA_NODE_PLACE,
      WA_NODE_LIFE,
      WA_NODE_TIME,
      'visit_book',
      WA_MENU_PROJECTS,
    ]);
    expect(infoCount).toBe(9);
    const total = rows.find((r) => r.id === WA_MONEY_TOTAL)!;
    expect(total.title).toBe('Total cost — 2 BHK');
  });

  it('a delivered row is not offered again — the seen ledger shrinks the menu', () => {
    const { rows, infoCount } = waConsoleRows({
      facts: FULL_FACTS,
      units: UNITS,
      bhk: '2 BHK',
      seen: ['brochure', 'total', 'trust'],
    });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain('answer_media');
    expect(ids).not.toContain(WA_MONEY_TOTAL);
    expect(ids).not.toContain(WA_NODE_TRUST);
    // With three seen, Returns now fits — the file rotates forward, never repeats.
    expect(ids).toContain(WA_NODE_LATER);
    expect(infoCount).toBe(6);
  });

  it('the size question is one row while open, and dies when bhk lands', () => {
    const open = waConsoleRows({ facts: FULL_FACTS, units: UNITS });
    expect(open.rows.map((r) => r.id)).toContain(WA_CONSOLE_SIZES);
    // No total-cost row without a resolvable unit — landed cost is per-unit.
    expect(open.rows.map((r) => r.id)).not.toContain(WA_MONEY_TOTAL);

    const answered = waConsoleRows({ facts: FULL_FACTS, units: UNITS, bhk: '2 BHK' });
    expect(answered.rows.map((r) => r.id)).not.toContain(WA_CONSOLE_SIZES);

    // A single-config project has no size question — total is simply All-in cost.
    const single = waConsoleRows({ facts: FULL_FACTS, units: [UNITS[1]!] });
    expect(single.rows.map((r) => r.id)).not.toContain(WA_CONSOLE_SIZES);
    expect(single.rows.find((r) => r.id === WA_MONEY_TOTAL)?.title).toBe('All-in cost');
  });

  it('Payment plan rides only when the document exists', () => {
    const noPlan = waConsoleRows({
      facts: { ...FULL_FACTS, mediaKinds: ['brochure'] },
      units: UNITS,
      bhk: '2 BHK',
    });
    expect(noPlan.rows.map((r) => r.id)).not.toContain(WA_MONEY_PLAN);
  });

  it('Returns keeps the honest gate — hollow intel draws nothing', () => {
    const { rows } = waConsoleRows({
      facts: { ...FULL_FACTS, marketIntel: {}, investment: {} },
      units: UNITS,
      bhk: '2 BHK',
    });
    expect(rows.map((r) => r.id)).not.toContain(WA_NODE_LATER);
  });

  it('no bare Price row, no ₹ in any description — the answer speaks money, not the menu', () => {
    const { rows } = waConsoleRows({ facts: FULL_FACTS, units: UNITS, bhk: '2 BHK' });
    expect(rows.map((r) => r.id)).not.toContain(WA_MONEY_MENU);
    for (const r of rows) {
      expect(r.title).not.toBe('Price');
      expect(r.description ?? '').not.toContain('₹');
    }
  });

  it('all seen → infoCount 0 and only the standing doors — the "you\'re done" signal', () => {
    const { rows, infoCount } = waConsoleRows({
      facts: FULL_FACTS,
      units: UNITS,
      bhk: '2 BHK',
      seen: ALL_FACETS,
    });
    expect(infoCount).toBe(0);
    expect(rows.map((r) => r.id)).toEqual(['visit_book', WA_MENU_PROJECTS]);
  });

  it('leadRows outrank the file and share the 8 info slots; doors close the list', () => {
    const lead: WaListRow[] = Array.from({ length: 7 }, (_, i) => ({
      id: `wa.money.bhk.${i + 1}`,
      title: `${i + 1} BHK`,
    }));
    const { rows, infoCount } = waConsoleRows({ facts: FULL_FACTS, units: UNITS, leadRows: lead });
    expect(rows).toHaveLength(10);
    expect(rows[6]!.id).toBe('wa.money.bhk.7');
    // One info slot left after the ladder — brochure leads the file.
    expect(rows[7]!.id).toBe('answer_media');
    expect(rows[8]!.id).toBe('visit_book');
    expect(rows[9]!.id).toBe(WA_MENU_PROJECTS);
    // The ladder counts as things left to do — all-seen must not fire under it.
    expect(infoCount).toBeGreaterThan(7);
  });

  it('title composes with short names and falls back inside Meta’s 24', () => {
    expect(waConsoleTitle('Eldorado')).toBe('Eldorado — what to check');
    expect(waConsoleTitle('Eldorado').length).toBeLessThanOrEqual(24);
    expect(waConsoleTitle('Brigade Cornerstone')).toBe('What to check');
    expect(waConsoleTitle(undefined)).toBe('What to check');
  });
});

describe('packWhatsAppInteractive — the console through the packer', () => {
  it('reads the seen ledger off the state and stamps every project-cut row', () => {
    let state = commitTo(initState('c', 'brigade-group'), 'cornerstone', 'Brigade Cornerstone');
    state = recordEntities(state, [{ projectId: 'cornerstone', name: 'Brigade Cornerstone' }], 'discussed', 1);
    state = { ...state, constraints: { ...state.constraints, bhk: '2 BHK' } };
    state = markFacetSeen(state, 'cornerstone', 'trust');

    const packed = packWhatsAppInteractive({
      goal: { kind: 'answer', topic: 'price', projectId: 'cornerstone' },
      state,
      catalogNames: [{ projectId: 'cornerstone', name: 'Brigade Cornerstone' }],
      singleProject: false,
      focusUnits: UNITS,
      focusFacts: FULL_FACTS,
    });
    expect(packed.kind).toBe('list');
    if (packed.kind !== 'list') return;
    expect(packed.button).toBe('More');
    expect(packed.sections[0]!.title).toBe('What to check');

    const rows = packed.sections[0]!.rows;
    expect(rows.length).toBeLessThanOrEqual(10);
    const aids = rows.map((r) => splitProjectStamp(r.id).aid);
    // The seen trust row is gone from this same turn's menu.
    expect(aids).not.toContain(WA_NODE_TRUST);
    // Project-cut rows carry their project; the standing doors stay bare.
    for (const r of rows) {
      const { aid, projectId } = splitProjectStamp(r.id);
      if (aid === 'visit_book' || aid === 'answer_media' || aid === WA_MENU_PROJECTS) {
        expect(projectId).toBeUndefined();
      } else {
        expect(projectId).toBe('cornerstone');
      }
      expect(r.title.length).toBeLessThanOrEqual(24);
      expect((r.description ?? '').length).toBeLessThanOrEqual(72);
    }
  });
});
