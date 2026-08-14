import { describe, expect, it } from 'vitest';
import {
  packWhatsAppInteractive,
  splitProjectStamp,
  waCanonicalUtterance,
  waConsoleRows,
  waConsoleTitle,
  waNodeMenuRows,
  waNodeOf,
  waNodeTitle,
  WA_BACK_FILE,
  WA_COMPARE,
  WA_CONSOLE_SIZES,
  WA_MENU_PROJECTS,
  WA_MONEY_EMI,
  WA_MONEY_MENU,
  WA_MONEY_PLAN,
  WA_MONEY_TOTAL,
  WA_NODE_LATER,
  WA_NODE_LIFE,
  WA_NODE_MONEY,
  WA_NODE_PLACE,
  WA_NODE_TIME,
  WA_NODE_TRUST,
  WA_NODE_UNIT,
  type WaNodeFacts,
} from '../src/channel/wa-pack.js';
import { markFacetSeen, recordEntities } from '../src/engine/entity-store.js';
import { commitTo, initState } from '../src/engine/state.js';

/**
 * THE file, and the way through it. The founder's model, verbatim: "section ->
 * sub-section -> media if available -> back to main section or sub-sections ->
 * sections -> completely new project -> Compare -> Visit like that".
 *
 * The root is the project's SECTIONS — a section is a place you can stand, so
 * it stays on the list whether or not you have been inside it. Only the hybrid
 * money row (the question almost everyone asks) obeys the seen ledger.
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
  ecStatus: 'Available on request',
  approvalAuthority: 'BBMP',
  possession: 'Dec 2027',
  amenities: ['clubhouse', 'pool', 'gym'],
  spec: { totalAcres: 50, towerCount: 12, openSpacePct: 60, amenitiesSqft: 80_000 },
  location: {
    connectivitySummary: '15 min from the airport',
    metroStations: [{ name: 'Baiyappanahalli' }],
    schools: [{ name: 'Little Elly' }, { name: 'EuroKids' }],
    hospitals: [{ name: 'Ramaiah' }],
  },
  marketIntel: { appreciation3yrPct: 12 },
  mediaKinds: ['brochure', 'payment_plan', 'floor_plan', 'ownership_certificate'],
  mediaAssets: [
    { assetId: 'a1', kind: 'brochure', title: 'Brochure' },
    { assetId: 'a2', kind: 'payment_plan', title: 'Payment plan' },
    { assetId: 'a3', kind: 'floor_plan', title: '2 BHK plan', unitTypeFilter: '2 BHK' },
    { assetId: 'a4', kind: 'ownership_certificate', title: 'OC' },
  ],
  loanEligibility: 'HDFC, ICICI, SBI — up to 80% LTV',
};

describe('the file — the root menu is the project’s sections', () => {
  it('draws one row per section the record can back, then the three standing acts', () => {
    const { rows, infoCount } = waConsoleRows({ facts: FULL_FACTS, units: UNITS, bhk: '2 BHK' });
    expect(rows.map((r) => r.id)).toEqual([
      // The founder's hybrid: the hottest money question stays one tap away.
      WA_MONEY_TOTAL,
      WA_NODE_MONEY,
      WA_NODE_TRUST,
      WA_NODE_PLACE,
      WA_NODE_LIFE,
      WA_NODE_TIME,
      WA_NODE_UNIT,
      'visit_book',
      WA_COMPARE,
      WA_MENU_PROJECTS,
    ]);
    expect(rows.find((r) => r.id === WA_MONEY_TOTAL)!.title).toBe('Total cost — 2 BHK');
    // Returns gated on and then gave way from the tail — never the way out.
    // infoCount counts unseen ANSWERS, not rows: sections never empty, so
    // counting them would kill the "you've been through the full file" signal.
    expect(infoCount).toBe(9);
    expect(rows).toHaveLength(10);
  });

  it('a section says what it holds — Life speaks the township’s own numbers', () => {
    const { rows } = waConsoleRows({ facts: FULL_FACTS, units: UNITS, bhk: '2 BHK' });
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by(WA_NODE_MONEY).description).toBe('all-in, EMI, payment plan');
    expect(by(WA_NODE_TRUST).description).toContain('RERA');
    expect(by(WA_NODE_TRUST).description).toContain('A-Khata');
    expect(by(WA_NODE_PLACE).description).toBe('metro · schools · hospitals');
    expect(by(WA_NODE_LIFE).description).toBe('80,000 sqft amenities · 50 acres');
    expect(by(WA_NODE_TIME).description).toBe('Dec 2027');
    expect(by(WA_NODE_UNIT).description).toBe('sizes · floor plan');
  });

  it('a section the record cannot back is not drawn at all', () => {
    const { rows } = waConsoleRows({
      facts: { projectId: 'p', possession: 'Dec 2027' },
      units: [],
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(WA_NODE_TIME);
    expect(ids).not.toContain(WA_NODE_TRUST);
    expect(ids).not.toContain(WA_NODE_PLACE);
    expect(ids).not.toContain(WA_NODE_LIFE);
    expect(ids).not.toContain(WA_NODE_MONEY);
    expect(ids).not.toContain(WA_NODE_UNIT);
  });

  it('sections survive being visited — navigation you can use once is not navigation', () => {
    const { rows } = waConsoleRows({
      facts: FULL_FACTS,
      units: UNITS,
      bhk: '2 BHK',
      seen: ['trust', 'place', 'life', 'time', 'total'],
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(WA_NODE_TRUST);
    expect(ids).toContain(WA_NODE_PLACE);
    // Only the delivered money answer drops.
    expect(ids).not.toContain(WA_MONEY_TOTAL);
  });

  it('no record: the standing acts stand, nothing is invented', () => {
    const { rows, infoCount } = waConsoleRows({ units: [] });
    expect(rows.map((r) => r.id)).toEqual(['visit_book', WA_COMPARE, WA_MENU_PROJECTS]);
    expect(infoCount).toBe(0);
  });

  it('no bare Price row, no ₹ in any description — the answer speaks money, not the menu', () => {
    const { rows } = waConsoleRows({ facts: FULL_FACTS, units: UNITS, bhk: '2 BHK' });
    expect(rows.map((r) => r.id)).not.toContain(WA_MONEY_MENU);
    for (const r of rows) {
      expect(r.title).not.toBe('Price');
      expect(r.description ?? '').not.toContain('₹');
      expect(r.title.length).toBeLessThanOrEqual(24);
      expect((r.description ?? '').length).toBeLessThanOrEqual(72);
    }
  });

  it('titles stay inside Meta’s 24', () => {
    expect(waConsoleTitle('Eldorado')).toBe('Eldorado — the file');
    expect(waConsoleTitle('Brigade Cornerstone')).toBe('The file');
    expect(waConsoleTitle(undefined)).toBe('The file');
    for (const n of ['money', 'trust', 'place', 'life', 'time', 'unit'] as const) {
      expect(waNodeTitle(n).length).toBeLessThanOrEqual(24);
    }
  });
});

describe('a section’s own screen — which part, and the way back', () => {
  it('Trust offers its topics AND its paperwork, then the way back', () => {
    const { rows } = waNodeMenuRows('trust', { facts: FULL_FACTS, units: UNITS, bhk: '2 BHK' });
    expect(rows.map((r) => r.id)).toEqual([
      'wa.sub.trust.rera',
      'wa.sub.trust.khata',
      'wa.sub.trust.ec',
      'wa.sub.trust.approvals',
      // The founder's "Trust amalgamated with the media" — the document sits
      // with the topics it belongs to, not in a separate Media pile.
      'wa.doc.ownership_certificate',
      WA_BACK_FILE,
      'visit_book',
    ]);
    expect(rows.find((r) => r.id === 'wa.sub.trust.khata')!.description).toBe('A-Khata');
    expect(rows.find((r) => r.id === 'wa.doc.ownership_certificate')!.description).toBe(
      'document · 1 file',
    );
  });

  it('the unit offers the floor plan cut to the buyer’s own size', () => {
    const facts: WaNodeFacts = {
      ...FULL_FACTS,
      mediaAssets: [
        ...(FULL_FACTS.mediaAssets ?? []),
        { assetId: 'a7', kind: 'floor_plan', title: '3 BHK plan', unitTypeFilter: '3 BHK' },
        { assetId: 'a8', kind: 'floor_plan', title: '1 BHK plan', unitTypeFilter: '1 BHK' },
      ],
    };
    const { rows } = waNodeMenuRows('unit', { facts, units: UNITS, bhk: '2 BHK' });
    const plan = rows.find((r) => r.id === 'wa.doc.floor_plan')!;
    expect(plan.title).toBe('Floor plan — 2 BHK');
    // Three plans on file, one of them this buyer's: the row promises one.
    expect(plan.description).toBe('document · 1 file');
    expect(rows.map((r) => r.id)).toContain(WA_CONSOLE_SIZES);
  });

  it('Money keeps the rows that shipped, and adds the banks only when named', () => {
    const { rows } = waNodeMenuRows('money', { facts: FULL_FACTS, units: UNITS, bhk: '2 BHK' });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(WA_MONEY_TOTAL);
    expect(ids).toContain(WA_MONEY_EMI);
    expect(ids).toContain(WA_MONEY_PLAN);
    expect(ids).toContain('wa.sub.money.loan');
    // The "Payment plan" topic row already sends the payment-plan file, so the
    // document must not be offered a second time under its own name.
    expect(ids).not.toContain('wa.doc.payment_plan');

    // A money document the topic rows do NOT already send still gets its row.
    const withSheet = waNodeMenuRows('money', {
      facts: {
        ...FULL_FACTS,
        mediaAssets: [
          ...(FULL_FACTS.mediaAssets ?? []),
          { assetId: 'a9', kind: 'price_sheet', title: 'Price sheet' },
        ],
      },
      units: UNITS,
      bhk: '2 BHK',
    });
    expect(withSheet.rows.map((r) => r.id)).toContain('wa.doc.price_sheet');

    const noBanks = waNodeMenuRows('money', {
      facts: { ...FULL_FACTS, loanEligibility: undefined },
      units: UNITS,
      bhk: '2 BHK',
    });
    expect(noBanks.rows.map((r) => r.id)).not.toContain('wa.sub.money.loan');
  });

  it('an empty section still gives a way back — never a dead end', () => {
    const { rows, infoCount } = waNodeMenuRows('trust', { facts: { projectId: 'p' }, units: [] });
    expect(infoCount).toBe(0);
    expect(rows.map((r) => r.id)).toEqual([WA_BACK_FILE, 'visit_book']);
  });

  it('every screen stays inside Meta’s 10 rows and 24/72 chars', () => {
    for (const n of ['money', 'trust', 'place', 'life', 'time', 'unit'] as const) {
      const { rows } = waNodeMenuRows(n, { facts: FULL_FACTS, units: UNITS, bhk: '2 BHK' });
      expect(rows.length).toBeLessThanOrEqual(10);
      for (const r of rows) {
        expect(r.title.length).toBeLessThanOrEqual(24);
        expect((r.description ?? '').length).toBeLessThanOrEqual(72);
      }
    }
  });
});

describe('the id is the navigation state', () => {
  it('every tap knows which section drew it, stamp and all', () => {
    expect(waNodeOf('wa.node.trust@cornerstone')).toBe('trust');
    expect(waNodeOf('wa.sub.place.schools@cornerstone')).toBe('place');
    expect(waNodeOf('wa.doc.ownership_certificate@cornerstone')).toBe('trust');
    expect(waNodeOf('wa.doc.floor_plan')).toBe('unit');
    expect(waNodeOf(WA_MONEY_TOTAL)).toBe('money');
    // The way back and the acts belong to no section — they leave.
    expect(waNodeOf(WA_BACK_FILE)).toBeUndefined();
    expect(waNodeOf('visit_book')).toBeUndefined();
  });

  it('every drawable id speaks a sentence the engine already parses', () => {
    const ids = [
      WA_NODE_MONEY,
      WA_NODE_UNIT,
      WA_BACK_FILE,
      'wa.sub.trust.rera',
      'wa.sub.trust.khata',
      'wa.sub.trust.ec',
      'wa.sub.trust.approvals',
      'wa.sub.place.metro',
      'wa.sub.place.schools',
      'wa.sub.place.hospitals',
      'wa.sub.life.amenities',
      'wa.sub.life.spec',
      'wa.sub.time.possession',
      'wa.sub.time.phases',
      'wa.doc.brochure',
      'wa.doc.floor_plan',
    ];
    for (const id of ids) {
      expect(waCanonicalUtterance(`${id}@cornerstone`), id).toBeTruthy();
    }
    expect(waCanonicalUtterance('wa.doc.floor_plan')).toBe('share the floor plan');
  });
});

describe('packWhatsAppInteractive — the console through the packer', () => {
  const state0 = () => {
    let s = commitTo(initState('c', 'brigade-group'), 'cornerstone', 'Brigade Cornerstone');
    s = recordEntities(s, [{ projectId: 'cornerstone', name: 'Brigade Cornerstone' }], 'discussed', 1);
    return { ...s, constraints: { ...s.constraints, bhk: '2 BHK' } };
  };

  it('a focused turn packs the file, and every project-cut row carries its project', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'answer', topic: 'price', projectId: 'cornerstone' },
      state: state0(),
      catalogNames: [{ projectId: 'cornerstone', name: 'Brigade Cornerstone' }],
      singleProject: false,
      focusUnits: UNITS,
      focusFacts: FULL_FACTS,
    });
    expect(packed.kind).toBe('list');
    if (packed.kind !== 'list') return;
    expect(packed.button).toBe('More');
    expect(packed.sections[0]!.title).toBe('The file');
    const rows = packed.sections[0]!.rows;
    expect(rows.map((r) => splitProjectStamp(r.id).aid)).toContain(WA_NODE_TRUST);
    for (const r of rows) {
      const { aid, projectId } = splitProjectStamp(r.id);
      if (aid === 'visit_book' || aid === WA_COMPARE || aid === WA_MENU_PROJECTS) {
        expect(projectId).toBeUndefined();
      } else {
        expect(projectId).toBe('cornerstone');
      }
    }
  });

  it('a Trust tap opens Trust — and a Trust sub-tap stays inside it', () => {
    const pack = (actionId: string) =>
      packWhatsAppInteractive({
        goal: { kind: 'answer', topic: 'legal', projectId: 'cornerstone' },
        state: state0(),
        catalogNames: [{ projectId: 'cornerstone', name: 'Brigade Cornerstone' }],
        singleProject: false,
        focusUnits: UNITS,
        focusFacts: FULL_FACTS,
        actionId,
      });

    const opened = pack(`${WA_NODE_TRUST}@cornerstone`);
    if (opened.kind !== 'list') throw new Error('expected a list');
    expect(opened.sections[0]!.title).toBe('Trust & legal');
    expect(opened.sections[0]!.rows.map((r) => splitProjectStamp(r.id).aid)).toContain(
      'wa.sub.trust.rera',
    );

    // Answering one sub-topic must not throw the buyer back to the root: the
    // next question is one tap, not three.
    const inside = pack('wa.sub.trust.rera@cornerstone');
    if (inside.kind !== 'list') throw new Error('expected a list');
    expect(inside.sections[0]!.rows.map((r) => splitProjectStamp(r.id).aid)).toContain(
      'wa.sub.trust.khata',
    );

    // ← Back to the file returns to the sections.
    const back = pack(`${WA_BACK_FILE}@cornerstone`);
    if (back.kind !== 'list') throw new Error('expected a list');
    expect(back.sections[0]!.title).toBe('The file');
    expect(back.sections[0]!.rows.map((r) => splitProjectStamp(r.id).aid)).toContain(WA_NODE_PLACE);
  });

  it('a seen money answer drops from the file, the sections do not', () => {
    let s = state0();
    s = markFacetSeen(s, 'cornerstone', 'total');
    const packed = packWhatsAppInteractive({
      goal: { kind: 'answer', topic: 'price', projectId: 'cornerstone' },
      state: s,
      catalogNames: [{ projectId: 'cornerstone', name: 'Brigade Cornerstone' }],
      singleProject: false,
      focusUnits: UNITS,
      focusFacts: FULL_FACTS,
    });
    if (packed.kind !== 'list') throw new Error('expected a list');
    const aids = packed.sections[0]!.rows.map((r) => splitProjectStamp(r.id).aid);
    expect(aids).not.toContain(WA_MONEY_TOTAL);
    expect(aids).toContain(WA_NODE_MONEY);
    expect(aids).toContain(WA_NODE_LATER);
  });
});
