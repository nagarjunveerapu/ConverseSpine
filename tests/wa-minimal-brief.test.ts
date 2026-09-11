import { describe, expect, it } from 'vitest';
import * as discover from '../src/engine/phases/discover.js';
import { commitTo, initState, leaveFocusKeepStack, releaseToDiscover, clearWaBriefConstraints } from '../src/engine/state.js';
import { fallbackReply, waBookFirstGreet, waBriefReceipt } from '../src/engine/compose.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeData, fakeDeps } from './fakes.js';
import { isAdvisorBriefChipPhrase } from '../src/engine/advisor-brief-chips.js';
import { parseBudgetToInr, textAnchorsProjectName } from '../src/engine/facts.js';
import {
  advanceWaBriefState,
  applyWaInteractiveExtract,
  isWaBriefActionId,
  packWhatsAppInteractive,
  syncWaBriefFromGoal,
  waBudgetRows,
  waConsoleRows,
  waSizeRows,
  waAreaRows,
  WA_AREA_ANY,
  WA_AREA_PREFIX,
  WA_BACK_AREA,
  WA_BACK_SIZE,
  WA_BUDGET_ANY,
  WA_MENU_BUDGET,
  WA_MENU_CHOOSE,
  WA_MENU_PROJECTS,
  WA_MENU_SEE,
  WA_MENU_OTHER,
  WA_MENU_TYPES,
  WA_SIZE_ANY,
  WA_TYPE_PLOT,
  WA_TYPE_VILLA,
  WA_HOLD_DROP,
  WA_HOLD_YOURS,
  WA_VISIT_YOURS,
  WA_MONEY_EMI,
  WA_MONEY_TOTAL,
  WA_PROJECT_STAMP,
  WA_COMPARE,
  isWaSeeAction,
  isWaOtherAction,
} from '../src/channel/wa-pack.js';
import type { ThreadState, Extracted } from '../src/engine/types.js';

const BAG = [
  { projectId: 'brigade-eldorado', name: 'Brigade Eldorado' },
  { projectId: 'brigade-orchards', name: 'Brigade Orchards' },
  { projectId: 'northridge-neo', name: 'Northridge Neo' },
  { projectId: 'brigade-meadows', name: 'Brigade Meadows' },
  { projectId: 'brigade-sanctuary', name: 'Brigade Sanctuary' },
  { projectId: 'cornerstone', name: 'Cornerstone Utopia' },
];

const CATALOG = {
  priceMinInr: 52_00_000,
  priceMaxInr: 1_60_00_000,
  projectTypes: ['apartments', 'plots', 'villas'],
};

function ex(over: Partial<Extracted> = {}): Extracted {
  return { constraints: {}, ...over } as Extracted;
}

function state(over: Partial<ThreadState> = {}): ThreadState {
  return { ...initState('c1', 'brigade-group'), turnCount: 3, ...over };
}

describe('greet sheet — the second door', () => {
  it('multi-project greet is the three-door welcome; See everything opens the book', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'greet' },
      state: initState('c1', 'brigade-group'),
      catalogNames: BAG,
      singleProject: false,
      catalog: CATALOG,
    });
    expect(packed.kind).toBe('buttons');
    if (packed.kind === 'buttons') {
      expect(packed.buttons.map((b) => b.id)).toEqual(['wa.menu.choose', 'wa.menu.see', 'wa.menu.know']);
      expect(packed.buttons.map((b) => b.title)).toEqual([
        'Help me find a home',
        'See the projects',
        'I know the name',
      ]);
      expect(packed.buttons.every((b) => b.title.length <= 20)).toBe(true);
    }
    const held = packWhatsAppInteractive({
      goal: { kind: 'greet' },
      state: state({
        hold: {
          placed: true,
          projectId: 'brigade-eldorado',
          projectName: 'Brigade Eldorado',
          unitType: '2 BHK',
        },
      }),
      catalogNames: BAG,
      singleProject: false,
      catalog: CATALOG,
    });
    expect(held.kind).toBe('buttons');
    if (held.kind === 'buttons') {
      expect(held.buttons.map((b) => b.id)).toEqual([
        'wa.pick.brigade-eldorado',
        WA_MENU_SEE,
        WA_HOLD_DROP,
      ]);
      expect(held.buttons.map((b) => b.title)).toEqual(['Your hold', 'Other projects', 'Drop the hold']);
    }
    // The tapped door shows the book list the old greet used to dump.
    const book = packWhatsAppInteractive({
      goal: { kind: 'greet' },
      state: initState('c1', 'brigade-group'),
      catalogNames: BAG,
      singleProject: false,
      catalog: CATALOG,
      bookOpen: true,
    });
    expect(book.kind).toBe('list');
    if (book.kind === 'list') {
      expect(book.sections[0]!.rows[0]!.id).toBe(WA_MENU_CHOOSE);
      expect(book.sections[0]!.rows.length).toBeLessThanOrEqual(10);
      expect(book.sections[0]!.rows.map((r) => r.id)).toContain('wa.pick.brigade-eldorado');
    }
  });

  it('single-project line has no choose row', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'greet' },
      state: initState('c1', 'brigade-group'),
      catalogNames: BAG.slice(0, 1),
      singleProject: true,
      catalog: CATALOG,
    });
    if (packed.kind === 'list') {
      expect(packed.sections[0]!.rows.map((r) => r.id)).not.toContain(WA_MENU_CHOOSE);
    }
  });

  it('greet copy is the quiet welcome for a real book, the single-project line otherwise', () => {
    const many = waBookFirstGreet({ builderName: 'Brigade', catalog: { ...CATALOG, total: 6 } });
    expect(many).toMatch(/^Hi,/);
    expect(many).toMatch(/Thank you for reaching out to \*Brigade\*/);
    expect(many).toMatch(/\n\n/);
    const named = waBookFirstGreet({
      builderName: 'Brigade',
      buyerName: 'Nagarjun',
      catalog: { ...CATALOG, total: 6 },
    });
    expect(named).toMatch(/^Hi Nagarjun,/);
    const holding = waBookFirstGreet({
      builderName: 'Brigade',
      buyerName: 'Nagarjun',
      catalog: { ...CATALOG, total: 6 },
      hold: { projectName: 'Brigade Eldorado', unitType: '2 BHK' },
    });
    expect(holding).toMatch(/You're holding a 2 BHK at \*Brigade Eldorado\*/);
    expect(holding).not.toMatch(/\bbook\b/i);
    const visiting = waBookFirstGreet({
      builderName: 'Brigade',
      buyerName: 'Nagarjun',
      catalog: { ...CATALOG, total: 6 },
      lifecycle: {
        kind: 'visit_planned',
        visit: {
          projectId: 'brigade-eldorado',
          projectName: 'Brigade Eldorado',
          iso: new Date(Date.now() + 86400000).toISOString(),
          label: 'Sat 12 Sep, 10:30',
        },
      },
    });
    expect(visiting).toMatch(/Your visit to \*Brigade Eldorado\* is \*Sat 12 Sep, 10:30\*/);
    expect(visiting).not.toMatch(/Help me find a home/i);
    // No catalog dump on the welcome — corridors and price live behind See the projects.
    expect(many).not.toMatch(/from about/);
    const one = waBookFirstGreet({ builderName: 'Brigade', catalog: { ...CATALOG, total: 1 } });
    expect(one).toMatch(/Tap the project/);
  });
});

describe('size step', () => {
  it('probe bhk packs the size sheet from the live book', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'probe', slot: 'bhk' },
      state: state(),
      catalogNames: BAG,
      singleProject: false,
      catalog: CATALOG,
    });
    expect(packed.kind).toBe('list');
    if (packed.kind === 'list') {
      expect(packed.button).toBe('Choose bedrooms');
      const ids = packed.sections[0]!.rows.map((r) => r.id);
      expect(ids).toContain('wa.bhk.3_bhk');
      expect(ids).toContain(WA_MENU_TYPES);
      expect(ids).not.toContain(WA_TYPE_VILLA);
      expect(ids).not.toContain(WA_TYPE_PLOT);
      expect(ids).not.toContain(WA_SIZE_ANY);
      expect(ids).not.toContain(WA_MENU_PROJECTS);
      expect(packed.sections[0]!.rows.every((r) => r.title.length <= 24)).toBe(true);
    }
  });

  it('More types opens villa / plot / any, with a way back to bedrooms', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'probe', slot: 'bhk' },
      state: state(),
      catalogNames: BAG,
      singleProject: false,
      catalog: CATALOG,
      actionId: WA_MENU_TYPES,
    });
    expect(packed.kind).toBe('list');
    if (packed.kind === 'list') {
      const ids = packed.sections[0]!.rows.map((r) => r.id);
      expect(ids).toContain(WA_TYPE_VILLA);
      expect(ids).toContain(WA_TYPE_PLOT);
      expect(ids).toContain(WA_SIZE_ANY);
      expect(ids.at(-1)).toBe(WA_MENU_CHOOSE);
    }
  });

  it('apartment-only books keep Any size on the first sheet', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'probe', slot: 'bhk' },
      state: state(),
      catalogNames: BAG,
      singleProject: false,
      catalog: { ...CATALOG, projectTypes: ['apartments'] },
    });
    if (packed.kind === 'list') {
      const ids = packed.sections[0]!.rows.map((r) => r.id);
      expect(ids).not.toContain(WA_MENU_TYPES);
      expect(ids).not.toContain(WA_TYPE_VILLA);
      expect(ids).toContain(WA_SIZE_ANY);
    }
  });

  it('plot/villa rows appear only when the book has those types', () => {
    const rows = waSizeRows({ ...CATALOG, projectTypes: ['apartments'] }, 6);
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(WA_TYPE_VILLA);
    expect(ids).not.toContain(WA_TYPE_PLOT);
    expect(ids).toContain(WA_SIZE_ANY);
  });

  it('villa / plot taps set propertyType, never a place', () => {
    const villa = applyWaInteractiveExtract(WA_TYPE_VILLA, ex(), BAG);
    expect(villa.constraints.propertyType).toBe('Villa');
    expect(villa.constraints.location).toBeUndefined();
    const plot = applyWaInteractiveExtract(WA_TYPE_PLOT, ex(), BAG);
    expect(plot.constraints.propertyType).toBe('Plot / land');
  });
});

describe('budget step', () => {
  it('bands are cut from the live spread and ids carry the numbers', () => {
    const rows = waBudgetRows(CATALOG, 6);
    expect(rows).toHaveLength(4);
    expect(rows[3]!.id).toBe(WA_BUDGET_ANY);
    expect(rows.every((r) => r.title.length <= 24)).toBe(true);

    const under = applyWaInteractiveExtract(rows[0]!.id, ex(), BAG);
    expect(under.constraints.budgetMaxInr).toBeGreaterThan(CATALOG.priceMinInr);
    expect(under.constraints.budgetMinInr).toBeUndefined();

    const between = applyWaInteractiveExtract(rows[1]!.id, ex(), BAG);
    expect(between.constraints.budgetMinInr).toBeGreaterThan(0);
    expect(between.constraints.budgetMaxInr).toBeGreaterThan(between.constraints.budgetMinInr!);

    const above = applyWaInteractiveExtract(rows[2]!.id, ex(), BAG);
    expect(above.constraints.budgetMinInr).toBeGreaterThan(0);
    expect(above.constraints.budgetMaxInr).toBeUndefined();
  });

  it('falls back to a fixed ladder when the catalog gave no spread', () => {
    const rows = waBudgetRows(null, 0);
    expect(rows[0]!.title).toBe('Under ₹50L');
    expect(rows[2]!.title).toBe('Above ₹1 Cr');
  });

  it('a single high floor still cuts bands around it, not the ₹50L ladder', () => {
    const rows = waBudgetRows({ priceMinInr: 2_41_00_000, priceMaxInr: 2_41_00_000 }, 1);
    expect(rows[0]!.title).not.toBe('Under ₹50L');
    const under = applyWaInteractiveExtract(rows[0]!.id, ex(), BAG);
    expect(under.constraints.budgetMaxInr).toBeGreaterThan(1_00_00_000);
    expect(under.constraints.budgetMaxInr).toBeLessThanOrEqual(2_41_00_000);
  });

  it('a tight corridor floor keeps the homes in the middle band, not a book-wide crore ladder', () => {
    const rows = waBudgetRows({ priceMinInr: 85_00_000, priceMaxInr: 89_00_000 }, 2);
    expect(rows[1]!.title).not.toMatch(/₹1 Cr – ₹1\.5 Cr/);
    const mid = applyWaInteractiveExtract(rows[1]!.id, ex(), BAG);
    expect(mid.constraints.budgetMinInr).toBeLessThanOrEqual(85_00_000);
    expect(mid.constraints.budgetMaxInr).toBeGreaterThanOrEqual(89_00_000);
  });

  it('probe budget packs the band sheet', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'probe', slot: 'budget' },
      state: state(),
      catalogNames: BAG,
      singleProject: false,
      catalog: CATALOG,
    });
    expect(packed.kind).toBe('list');
    if (packed.kind === 'list') {
      expect(packed.button).toBe('Set budget');
      const last = packed.sections[0]!.rows.at(-1)!;
      expect(last.id).toBe(WA_BACK_SIZE);
      expect(last.title).toBe('← Bedrooms');
      expect(packed.sections[0]!.rows.map((r) => r.id)).not.toContain(WA_MENU_PROJECTS);
    }
  });
});

describe('area step', () => {
  const AREAS = ['Aerospace Park / Devanahalli Corridor', 'Devanahalli', 'Whitefield'];

  it('rows come from the live catalog, plus Any area', () => {
    const rows = waAreaRows(AREAS);
    expect(rows.map((r) => r.id)).toContain(`${WA_AREA_PREFIX}devanahalli`);
    expect(rows.at(-1)!.id).toBe(WA_AREA_ANY);
    expect(rows.at(-1)!.title).toBe('Any area');
    expect(rows.every((r) => r.title.length <= 24)).toBe(true);
  });

  it('a corridor tap sets location to the catalog name, never a guessed city', () => {
    const id = `${WA_AREA_PREFIX}devanahalli`;
    const out = applyWaInteractiveExtract(id, ex(), BAG, AREAS);
    expect(out.constraints.location).toBe('Devanahalli');
    expect(out.speechAct).toBe('answer');
    const any = applyWaInteractiveExtract(WA_AREA_ANY, ex({ constraints: { location: 'Whitefield' } }), BAG, AREAS);
    expect(any.constraints.location).toBeUndefined();
  });

  it('probe location packs the live markets, not Advisor loc ids', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'probe', slot: 'location' },
      state: state(),
      catalogNames: BAG,
      singleProject: false,
      catalog: CATALOG,
      briefAreas: AREAS,
    });
    expect(packed.kind).toBe('list');
    if (packed.kind === 'list') {
      expect(packed.button).toBe('Choose area');
      const ids = packed.sections[0]!.rows.map((r) => r.id);
      expect(ids).toContain(`${WA_AREA_PREFIX}devanahalli`);
      expect(ids).toContain(WA_AREA_ANY);
      expect(ids.at(-1)).toBe(WA_BACK_SIZE);
      expect(ids.some((id) => id.startsWith('wa.brief.loc.'))).toBe(false);
    }
  });

  it('budget way-back returns to area when the book has corridors', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'probe', slot: 'budget' },
      state: state(),
      catalogNames: BAG,
      singleProject: false,
      catalog: CATALOG,
      briefAreas: AREAS,
    });
    if (packed.kind === 'list') {
      const last = packed.sections[0]!.rows.at(-1)!;
      expect(last.id).toBe(WA_BACK_AREA);
      expect(last.title).toBe('← Area');
    }
  });
});

describe('brief step machine', () => {
  it('Help me choose opens at the first missing fact', () => {
    expect(advanceWaBriefState(state(), WA_MENU_CHOOSE, ex()).discover.waBriefStep).toBe('size');
    expect(advanceWaBriefState(state({ discover: { ...state().discover, waBriefStep: 'size' } }), WA_MENU_TYPES, ex()).discover.waBriefStep).toBe('size');
    const sized = state({ constraints: { bhk: '3 BHK' } });
    expect(advanceWaBriefState(sized, WA_MENU_CHOOSE, ex()).discover.waBriefStep).toBe('budget');
    const both = state({ constraints: { bhk: '3 BHK', budgetMaxInr: 1_00_00_000 } });
    expect(advanceWaBriefState(both, WA_MENU_CHOOSE, ex()).discover.waBriefStep).toBeUndefined();
  });

  it('a size answer advances to budget; a budget answer completes', () => {
    const atSize = state({ discover: { ...state().discover, waBriefStep: 'size' } });
    const afterSize = advanceWaBriefState(atSize, 'wa.bhk.3_bhk', ex({ constraints: { bhk: '3 BHK' } }));
    expect(afterSize.discover.waBriefStep).toBe('budget');
    const afterAnySize = advanceWaBriefState(atSize, WA_SIZE_ANY, ex());
    expect(afterAnySize.discover.waBriefStep).toBe('budget');

    const atBudget = state({ discover: { ...state().discover, waBriefStep: 'budget' } });
    expect(
      advanceWaBriefState(atBudget, 'wa.budget.u_10000000', ex({ constraints: { budgetMaxInr: 1_00_00_000 } }))
        .discover.waBriefStep,
    ).toBeUndefined();
    expect(advanceWaBriefState(atBudget, WA_BUDGET_ANY, ex()).discover.waBriefStep).toBeUndefined();
  });

  const AREAS = ['Devanahalli', 'Whitefield', 'Kanakapura Road'];

  it('with live micro-markets, size advances to area, then budget', () => {
    const atSize = state({ discover: { ...state().discover, waBriefStep: 'size' } });
    const afterSize = advanceWaBriefState(
      atSize,
      'wa.bhk.2_bhk',
      ex({ constraints: { bhk: '2 BHK' } }),
      AREAS,
    );
    expect(afterSize.discover.waBriefStep).toBe('area');

    const areaId = `${WA_AREA_PREFIX}devanahalli`;
    const afterArea = advanceWaBriefState(
      afterSize,
      areaId,
      ex({ constraints: { location: 'Devanahalli' } }),
      AREAS,
    );
    expect(afterArea.discover.waBriefStep).toBe('budget');

    const anyArea = advanceWaBriefState(afterSize, WA_AREA_ANY, ex(), AREAS);
    expect(anyArea.discover.waBriefStep).toBe('budget');
    expect(anyArea.constraints.location).toBeUndefined();
    expect(anyArea.discover.asked).toContain('location');
  });

  it('Help me choose with size known opens area when the book has corridors', () => {
    const sized = state({ constraints: { bhk: '3 BHK' } });
    expect(advanceWaBriefState(sized, WA_MENU_CHOOSE, ex(), AREAS).discover.waBriefStep).toBe('area');
  });

  it('going back to bedrooms still asks area if no corridor was picked', () => {
    const atSize = state({
      constraints: { bhk: '2 BHK' },
      discover: { ...state().discover, waBriefStep: 'size', asked: ['location'] },
    });
    const after = advanceWaBriefState(atSize, 'wa.bhk.3_bhk', ex({ constraints: { bhk: '3 BHK' } }), AREAS);
    expect(after.discover.waBriefStep).toBe('area');
  });

  it('typing the whole brief at once clears every step', () => {
    const atSize = state({ discover: { ...state().discover, waBriefStep: 'size' } });
    const typed = advanceWaBriefState(
      atSize,
      undefined,
      ex({ constraints: { bhk: '3 BHK', budgetMaxInr: 90_00_000 } }),
    );
    expect(typed.discover.waBriefStep).toBeUndefined();
  });

  it('a pick or the Projects menu abandons the brief', () => {
    const atBudget = state({ discover: { ...state().discover, waBriefStep: 'budget' } });
    expect(advanceWaBriefState(atBudget, 'wa.pick.brigade-eldorado', ex()).discover.waBriefStep).toBeUndefined();
    expect(advanceWaBriefState(atBudget, WA_MENU_PROJECTS, ex()).discover.waBriefStep).toBeUndefined();
    expect(advanceWaBriefState(state(), WA_MENU_BUDGET, ex()).discover.waBriefStep).toBe('budget');
  });

  it('discover-started briefs sync from the probe goal', () => {
    expect(syncWaBriefFromGoal(state(), { kind: 'probe', slot: 'bhk' }).discover.waBriefStep).toBe('size');
    expect(syncWaBriefFromGoal(state(), { kind: 'probe', slot: 'location' }).discover.waBriefStep).toBe('area');
    expect(syncWaBriefFromGoal(state(), { kind: 'probe', slot: 'budget' }).discover.waBriefStep).toBe('budget');
    const atSize = state({ discover: { ...state().discover, waBriefStep: 'size' } });
    expect(
      syncWaBriefFromGoal(atSize, { kind: 'commit', projectId: 'x', projectName: 'X' }).discover.waBriefStep,
    ).toBeUndefined();
  });
});

describe('discover under skipBrief — never the same dump twice', () => {
  it('a real statement the engine could not route gets one honest probe', () => {
    const goal = discover.decide(state(), ex(), 'something green side, near hills', { skipBrief: true });
    expect(goal).toMatchObject({ kind: 'clarify_intent' });
  });

  it('noise and smalltalk still re-offer the book', () => {
    expect(discover.decide(state(), ex(), 'ok', { skipBrief: true })).toMatchObject({ kind: 'recommend' });
    expect(discover.decide(state(), ex({ smalltalk: true }), 'hi there', { skipBrief: true })).toMatchObject({
      kind: 'recommend',
    });
  });

  it('a typed constraint filters the book instead of clarifying', () => {
    const goal = discover.decide(state(), ex({ constraints: { bhk: '3 BHK' } }), '3 bhk', { skipBrief: true });
    expect(goal).toMatchObject({ kind: 'recommend' });
  });

  it('"not sure where to start" opens the minimal brief, not the dump', () => {
    const goal = discover.decide(state(), ex({ firstHomeHelp: true }), 'where do i start', { skipBrief: true });
    expect(goal).toMatchObject({ kind: 'probe', slot: 'bhk' });
    const sized = state({ constraints: { bhk: '3 BHK' } });
    const goal2 = discover.decide(sized, ex({ firstHomeHelp: true }), 'where do i start', { skipBrief: true });
    expect(goal2).toMatchObject({ kind: 'probe', slot: 'budget' });
  });
});

describe('clarify packs the three doors', () => {
  it('clarify_intent without focus is Choose size / Set budget / Projects', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'clarify_intent' },
      state: state(),
      catalogNames: BAG,
      singleProject: false,
      catalog: CATALOG,
    });
    expect(packed.kind).toBe('buttons');
    if (packed.kind === 'buttons') {
      expect(packed.buttons.map((b) => b.id)).toEqual([WA_MENU_CHOOSE, WA_MENU_BUDGET, WA_MENU_PROJECTS]);
      expect(packed.buttons.every((b) => b.title.length <= 20)).toBe(true);
    }
  });

  it('clarify_intent with the book open lists projects, not the three miss doors', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'clarify_intent' },
      state: state(),
      catalogNames: BAG,
      singleProject: false,
      catalog: CATALOG,
      bookOpen: true,
    });
    expect(packed.kind).toBe('list');
    if (packed.kind === 'list') {
      expect(packed.sections[0]!.rows.map((r) => r.id)).toContain('wa.pick.brigade-eldorado');
    }
  });

  it('a brief cut with an empty bag never dumps wa.pick rows', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'recommend' },
      state: state({ constraints: { bhk: '1 BHK', budgetMaxInr: 40_00_000 } }),
      catalogNames: [],
      singleProject: false,
      catalog: CATALOG,
      briefCut: true,
    });
    expect(packed.kind).toBe('buttons');
    if (packed.kind === 'buttons') {
      expect(packed.buttons.map((b) => b.id)).toEqual([WA_MENU_CHOOSE, WA_MENU_BUDGET, WA_MENU_SEE]);
      expect(packed.buttons.every((b) => b.title.length <= 20)).toBe(true);
    }
  });

  it('one to three matches pack as named reply buttons, not See matches', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'recommend' },
      state: state({ constraints: { propertyType: 'plot', budgetMaxInr: 1_00_00_000 } }),
      catalogNames: [{ projectId: 'brigade-oasis', name: 'Brigade Oasis', description: 'from ₹71 L' }],
      singleProject: false,
      catalog: CATALOG,
      briefCut: true,
    });
    expect(packed.kind).toBe('buttons');
    if (packed.kind === 'buttons') {
      expect(packed.buttons).toEqual([{ id: 'wa.pick.brigade-oasis', title: 'Brigade Oasis' }]);
      expect(packed.buttons[0]!.title.length).toBeLessThanOrEqual(20);
    }
    const three = packWhatsAppInteractive({
      goal: { kind: 'recommend' },
      state: state({ constraints: { bhk: '2 BHK', budgetMaxInr: 1_00_00_000 } }),
      catalogNames: BAG.slice(0, 3),
      singleProject: false,
      catalog: CATALOG,
      briefCut: true,
    });
    expect(three.kind).toBe('buttons');
    if (three.kind === 'buttons') {
      expect(three.buttons).toHaveLength(3);
      expect(three.buttons.every((b) => b.id.startsWith('wa.pick.'))).toBe(true);
    }
  });

  it('a brief cut lists every honest match up to ten', () => {
    const names = Array.from({ length: 12 }, (_, i) => ({ projectId: `p${i}`, name: `Home ${i}` }));
    const packed = packWhatsAppInteractive({
      goal: { kind: 'recommend' },
      state: state({ constraints: { bhk: '2 BHK' } }),
      catalogNames: names,
      singleProject: false,
      catalog: CATALOG,
      briefCut: true,
    });
    expect(packed.kind).toBe('list');
    if (packed.kind === 'list') {
      const picks = packed.sections[0]!.rows.filter((r) => r.id.startsWith('wa.pick.'));
      expect(picks).toHaveLength(10);
    }
  });

  it('unconstrained recommend lists the book and hides silent test projects', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'recommend' },
      state: state(),
      catalogNames: [...BAG, { projectId: 'desk-v2-gold', name: 'Desk V2 Gold' }],
      singleProject: false,
      catalog: CATALOG,
      browseCatalog: true,
    });
    expect(packed.kind).toBe('list');
    if (packed.kind === 'list') {
      const titles = packed.sections[0]!.rows.map((r) => r.title);
      expect(titles.some((t) => /Brigade Eldorado/.test(t))).toBe(true);
      expect(titles.some((t) => /desk v2/i.test(t))).toBe(false);
      expect(packed.button).toBe('See projects');
    }
  });
});

describe('minimal-brief compose copy', () => {
  const baseContext = {
    constraints: {},
    alreadyShownSameSet: false,
    builderName: 'Brigade Group',
    waProjectFirst: true,
    channel: 'whatsapp' as const,
  };

  it('size question is the bedroom sheet, not the Advisor interview', () => {
    const reply = fallbackReply({
      goal: { kind: 'probe', slot: 'bhk' },
      evidence: { tools: [] },
      context: baseContext,
    });
    expect(reply).toMatch(/How many bedrooms are you looking at/);
    expect(reply.toLowerCase()).not.toMatch(/what brings you here|worries|commute|cut the book/);
  });

  it('More types asks for villa / plot / any, not bedrooms again', () => {
    const reply = fallbackReply({
      goal: { kind: 'probe', slot: 'bhk' },
      evidence: { tools: [] },
      context: { ...baseContext, waMoreTypes: true },
    });
    expect(reply).toMatch(/Villa, plot, or any size/);
    expect(reply).not.toMatch(/bedrooms/);
  });

  it('budget question anchors to the live spread', () => {
    const reply = fallbackReply({
      goal: { kind: 'probe', slot: 'budget' },
      evidence: {
        tools: ['catalog'],
        catalog: { ...CATALOG, microMarkets: [], total: 6, sample: [] },
      },
      context: { ...baseContext, constraints: { bhk: '3 BHK' } },
    });
    expect(reply).toMatch(/Got it — \*3 BHK\*/);
    expect(reply).toMatch(/\n\n/);
    expect(reply).toMatch(/For a 3 BHK/);
    expect(reply).toMatch(/What budget feels comfortable/);
    expect(reply).not.toMatch(/ceiling/);
  });

  it('area question names live corridors, not Bangalore gazetteer copy', () => {
    const reply = fallbackReply({
      goal: { kind: 'probe', slot: 'location' },
      evidence: { tools: [] },
      context: { ...baseContext, constraints: { bhk: '2 BHK' } },
    });
    expect(reply).toMatch(/Got it — \*2 BHK\*/);
    expect(reply).toMatch(/Which area are you looking at/);
    expect(reply).not.toMatch(/bangalore gazetteer|what brings you here|worries/i);
    expect(reply).not.toMatch(/\bbook\b/i);
  });

  it('budget after an area acks the corridor', () => {
    const reply = fallbackReply({
      goal: { kind: 'probe', slot: 'budget' },
      evidence: {
        tools: ['catalog'],
        catalog: { ...CATALOG, microMarkets: ['Devanahalli'], total: 6, sample: [] },
      },
      context: { ...baseContext, constraints: { bhk: '2 BHK', location: 'Devanahalli' } },
    });
    expect(reply).toMatch(/^\*Devanahalli\*, then/);
    expect(reply).toMatch(/What budget feels comfortable/);
  });

  it('budget copy quotes the corridor envelope, not a book-wide crore ceiling', () => {
    const reply = fallbackReply({
      goal: { kind: 'probe', slot: 'budget' },
      evidence: {
        tools: ['catalog'],
        catalog: {
          priceMinInr: 85_00_000,
          priceMaxInr: 89_00_000,
          projectTypes: ['apartments'],
          microMarkets: ['Aerospace Park / Devanahalli Corridor'],
          total: 2,
          sample: [],
        },
      },
      context: {
        ...baseContext,
        constraints: { bhk: '3 BHK', location: 'Aerospace Park / Devanahalli Corridor' },
      },
    });
    expect(reply).toMatch(/₹85 L/);
    expect(reply).toMatch(/₹89 L/);
    expect(reply).not.toMatch(/1\.67 Cr|₹1\.67/);
  });

  it('matches lead with the requirement receipt', () => {
    const reply = fallbackReply({
      goal: { kind: 'recommend' },
      evidence: {
        tools: [],
        matches: [
          { projectId: 'p1', name: 'Brigade Eldorado', microMarket: 'Aerospace Park' },
        ] as never[],
      },
      context: { ...baseContext, constraints: { bhk: '3 BHK', budgetMaxInr: 1_00_00_000 } },
    });
    expect(reply).toMatch(/For a 3 BHK under/);
    expect(reply).toMatch(/one home fits/i);
    expect(reply).toMatch(/\n\n/);
    expect(reply).not.toMatch(/Noted:/);
    expect(reply).not.toMatch(/Brigade Eldorado/);
  });

  it('matches name the corridor when the buyer picked one', () => {
    const reply = fallbackReply({
      goal: { kind: 'recommend' },
      evidence: {
        tools: [],
        matches: [
          { projectId: 'p1', name: 'Brigade Orchards', microMarket: 'Devanahalli' },
        ] as never[],
      },
      context: {
        ...baseContext,
        constraints: { bhk: '2 BHK', location: 'Devanahalli', budgetMaxInr: 85_00_000 },
      },
    });
    expect(reply).toMatch(/For a 2 BHK in Devanahalli under/);
    expect(reply).not.toMatch(/Brigade Orchards/);
  });

  it('names how many homes actually fit, not a three-card cap', () => {
    const matches = Array.from({ length: 7 }, (_, i) => ({
      projectId: `p${i}`,
      name: `Home ${i}`,
      microMarket: 'Devanahalli',
    })) as never[];
    const reply = fallbackReply({
      goal: { kind: 'recommend' },
      evidence: { tools: [], matches },
      context: { ...baseContext, constraints: { bhk: '2 BHK', budgetMaxInr: 1_00_00_000 } },
    });
    expect(reply).toMatch(/7 homes fit/);
    expect(reply).not.toMatch(/Home 0/);
  });

  it('an empty cut is an honest no-fit, not a silent relax', () => {
    const reply = fallbackReply({
      goal: { kind: 'recommend' },
      evidence: { tools: [], matches: [] },
      context: { ...baseContext, constraints: { bhk: '3 BHK', budgetMaxInr: 60_00_000 } },
    });
    expect(reply).toMatch(/I don't have a 3 BHK/);
    expect(reply).toMatch(/\n\n/);
    expect(reply).not.toMatch(/\bbook\b/i);
    expect(reply).not.toMatch(/Noted:/);
    expect(reply).not.toMatch(/Here's everything/);
  });

  it('no cut and no matches is a browse, not a no-fit', () => {
    const reply = fallbackReply({
      goal: { kind: 'recommend' },
      evidence: { tools: [], matches: [] },
      context: { ...baseContext, constraints: {} },
    });
    expect(reply).toMatch(/These are the projects/);
    expect(reply).not.toMatch(/I don't have/);
  });

  it('a no_fit cut never offers to open a cheaper project', () => {
    const reply = fallbackReply({
      goal: { kind: 'no_fit' },
      evidence: {
        tools: [],
        constraintGap: {
          bhk: '1 BHK',
          budgetDisplay: '₹65 L',
          alternateProject: 'Brigade Eldorado',
          alternatePriceDisplay: '₹31 L',
        },
      },
      context: { ...baseContext, constraints: { bhk: '1 BHK', budgetMinInr: 45_00_000, budgetMaxInr: 65_00_000 } },
    });
    expect(reply).toMatch(/I don't have a 1 BHK/);
    expect(reply).not.toMatch(/\bbook\b/i);
    expect(reply).not.toMatch(/Noted:/);
    expect(reply).not.toMatch(/Want me to open/);
    expect(reply).not.toMatch(/here they are/);
  });

  it('receipt formats size and band', () => {
    expect(waBriefReceipt({ bhk: '3 BHK', budgetMaxInr: 1_00_00_000 })).toContain('3 BHK');
    expect(waBriefReceipt({ bhk: '3 BHK', budgetMaxInr: 1_00_00_000 })).toContain('under');
    expect(waBriefReceipt({})).toBe('');
  });
});

describe('brief labels never become places', () => {
  it('static rows and dynamic band labels are guarded', () => {
    expect(isAdvisorBriefChipPhrase('Help me choose')).toBe(true);
    expect(isAdvisorBriefChipPhrase('✨ Help me choose')).toBe(true);
    expect(isAdvisorBriefChipPhrase('Help me find a home')).toBe(true);
    expect(isAdvisorBriefChipPhrase('See the projects')).toBe(true);
    expect(isAdvisorBriefChipPhrase('I know the name')).toBe(true);
    expect(isAdvisorBriefChipPhrase('Any size')).toBe(true);
    expect(isAdvisorBriefChipPhrase('More types')).toBe(true);
    expect(isAdvisorBriefChipPhrase('Any budget')).toBe(true);
    expect(isAdvisorBriefChipPhrase('Any area')).toBe(true);
    expect(isAdvisorBriefChipPhrase('Choose area')).toBe(true);
    expect(isAdvisorBriefChipPhrase('Under ₹90L')).toBe(true);
    expect(isAdvisorBriefChipPhrase('₹90L – ₹1.3 Cr')).toBe(true);
    expect(isAdvisorBriefChipPhrase('Above ₹1.3 Cr')).toBe(true);
    expect(isAdvisorBriefChipPhrase('Devanahalli')).toBe(false);
  });
});

describe('tap ids are authoritative — label-derived meaning is scrubbed', () => {
  it('menu and answer taps clear ask topics and isQuestion', () => {
    for (const aid of [WA_MENU_CHOOSE, WA_MENU_BUDGET, WA_MENU_PROJECTS, WA_MENU_SEE, WA_MENU_OTHER, WA_MENU_TYPES, WA_SIZE_ANY, WA_BUDGET_ANY, WA_AREA_ANY, WA_BACK_SIZE]) {
      const out = applyWaInteractiveExtract(
        aid,
        ex({ askTopic: 'overview', askTopics: ['overview'], isQuestion: true }),
        BAG,
      );
      expect(out.askTopic, aid).toBeUndefined();
      expect(out.askTopics, aid).toBeUndefined();
      expect(out.isQuestion, aid).toBe(false);
      if (aid === WA_MENU_PROJECTS || aid === WA_MENU_SEE || aid === WA_MENU_OTHER) {
        expect(out.speechAct, aid).toBe('search');
      }
    }
  });

  it('bhk / type / band taps clear topics too ("3 BHK", "Under ₹85L" read like asks)', () => {
    for (const aid of ['wa.bhk.3_bhk', WA_TYPE_VILLA, 'wa.budget.u_8500000']) {
      const out = applyWaInteractiveExtract(
        aid,
        ex({ askTopic: 'price', askTopics: ['price'], isQuestion: true }),
        BAG,
      );
      expect(out.askTopic, aid).toBeUndefined();
      expect(out.askTopics, aid).toBeUndefined();
    }
  });

  it('isWaBriefActionId covers the brief family, not picks or job chips', () => {
    for (const aid of [
      WA_MENU_CHOOSE, WA_MENU_BUDGET, WA_MENU_PROJECTS, WA_MENU_SEE, WA_MENU_OTHER, WA_MENU_TYPES, WA_SIZE_ANY, WA_BUDGET_ANY,
      WA_AREA_ANY, WA_BACK_SIZE, WA_BACK_AREA, `${WA_AREA_PREFIX}devanahalli`,
      WA_TYPE_VILLA, WA_TYPE_PLOT, WA_HOLD_DROP, WA_HOLD_YOURS, WA_VISIT_YOURS, 'wa.bhk.2_bhk', 'wa.budget.b_5000000_8000000',
    ]) {
      expect(isWaBriefActionId(aid), aid).toBe(true);
    }
    for (const aid of ['wa.pick.brigade-eldorado', 'answer_price', 'visit_book', '', undefined]) {
      expect(isWaBriefActionId(aid), String(aid)).toBe(false);
    }
  });
});

describe('a number tied to a weekday or clock is a time, not a budget', () => {
  it('visit-slot phrasings never parse as budgets', () => {
    expect(parseBudgetToInr('sunday 12')).toBeNull();
    expect(parseBudgetToInr('monday 11am')).toBeNull();
    expect(parseBudgetToInr('sat 10.30')).toBeNull();
    expect(parseBudgetToInr('12 pm works')).toBeNull();
  });

  it('explicit money next to a day still parses; bare probe answers still parse', () => {
    expect(parseBudgetToInr('sunday, 50 lakhs')?.max).toBe(50_00_000);
    expect(parseBudgetToInr('70')?.max).toBe(70_00_000);
  });
});

describe('free text opens a project only when the text anchors its name', () => {
  it('a lone generic token off a vibe does not anchor', () => {
    expect(textAnchorsProjectName('something green side, near hills', 'Coorg Hills Estate')).toBe(false);
    expect(textAnchorsProjectName('somewhere with greens', 'Krishnaja Greens')).toBe(false);
  });

  it('the distinctive name or two tokens anchor', () => {
    expect(textAnchorsProjectName('what about coorg hills', 'Coorg Hills Estate')).toBe(true);
    expect(textAnchorsProjectName('eldorado', 'Brigade Eldorado')).toBe(true);
    expect(textAnchorsProjectName('open coorg hills estate', 'Coorg Hills Estate')).toBe(true);
  });
});

describe('budget bands after area — corridor, not the book', () => {
  it('quotes Devanahalli prices even when Desk search returned the whole book', async () => {
    const data = fakeData();
    const inner = data.search.bind(data);
    let seenLocations: string | undefined;
    data.search = async (b, f) => {
      if (f.locations) seenLocations = f.locations;
      // Live Desk ranks on area; it still returns citywide rows. Force that
      // here so Spine's admit-filter is what scopes the envelope.
      return inner(b, { ...f, locations: undefined, maxResults: 24 });
    };
    const deps = { ...fakeDeps(), data, waProjectFirst: true };
    const turn = (text: string, actionId?: string) =>
      runEngineTurn(
        {
          threadId: 'wa-corridor-bands',
          builderId: 'lokations',
          text,
          buyerPhone: '+919999991199',
          channel: 'whatsapp',
          ...(actionId ? { action_id: actionId } : {}),
        },
        deps,
      );

    await turn('Hi');
    await turn('Help me find a home', 'wa.menu.choose');
    await turn('3 BHK', 'wa.bhk.3_bhk');
    const budget = await turn('Devanahalli', 'wa.area.devanahalli');

    expect(seenLocations).toBe('Devanahalli');
    expect(budget.reply).toMatch(/Devanahalli/);
    // Fake Devanahalli apartment is Cornerstone at ₹52 L — not Whitefield ₹1.05 Cr.
    expect(budget.reply).toMatch(/₹52 L/);
    expect(budget.reply).not.toMatch(/1\.05 Cr|₹1\.05/);
    if (budget.whatsappInteractive?.kind === 'list') {
      const titles = budget.whatsappInteractive.sections[0]!.rows.map((r) => r.title);
      expect(titles.some((t) => /₹1 Cr/.test(t) && /1\.5/.test(t))).toBe(false);
    }
  });
});

describe('P2 See other projects keeps the brief and peeks the last file', () => {
  it('peeks ← last project and does not dump the whole book', () => {
    const s = commitTo(
      {
        ...state({
          constraints: { bhk: '3 BHK', budgetMaxInr: 1_00_00_000 },
          focusStack: ['brigade-eldorado'],
          entities: {
            'brigade-eldorado': {
              projectId: 'brigade-eldorado',
              name: 'Brigade Eldorado',
              roles: ['focused'],
              firstSeenTurn: 1,
              lastTouchedTurn: 1,
            },
          },
        }),
      },
      'brigade-eldorado',
      'Brigade Eldorado',
    );
    const packed = packWhatsAppInteractive({
      goal: { kind: 'recommend' },
      state: { ...s, focus: undefined, phase: 'discover' },
      catalogNames: [
        { projectId: 'brigade-eldorado', name: 'Brigade Eldorado', description: 'from ₹89 L' },
        { projectId: 'brigade-orchards', name: 'Brigade Orchards', description: 'from ₹82 L' },
      ],
      singleProject: false,
      catalog: CATALOG,
      bookOpen: true,
      otherOpen: true,
      briefCut: true,
      peekLast: { projectId: 'brigade-eldorado', name: 'Brigade Eldorado' },
    });
    expect(packed.kind).toBe('list');
    if (packed.kind !== 'list') return;
    const ids = packed.sections[0]!.rows.map((r) => r.id);
    expect(ids[0]).toBe('wa.pick.brigade-eldorado');
    expect(packed.sections[0]!.rows[0]!.title).toMatch(/^← /);
    expect(ids).toContain('wa.pick.brigade-orchards');
  });
});

describe('P3 returning greet follows Desk life', () => {
  it('visit planned is not the three explore doors', () => {
    const iso = new Date(Date.now() + 3 * 86400000).toISOString();
    const packed = packWhatsAppInteractive({
      goal: { kind: 'greet' },
      state: state({
        buyerLifecycle: {
          kind: 'visit_planned',
          visit: {
            projectId: 'brigade-eldorado',
            projectName: 'Brigade Eldorado',
            iso,
            label: 'Fri 18 Sep, 10:30',
          },
        },
        visitBookedCache: [
          { projectId: 'brigade-eldorado', projectName: 'Brigade Eldorado', iso, label: 'Fri 18 Sep, 10:30' },
        ],
      }),
      catalogNames: BAG,
      singleProject: false,
      catalog: CATALOG,
      nowMs: Date.now(),
    });
    expect(packed.kind).toBe('buttons');
    if (packed.kind !== 'buttons') return;
    expect(packed.buttons.map((b) => b.id)).toContain('wa.visit.yours');
    expect(packed.buttons.map((b) => b.title)).not.toContain('Help me find a home');
  });
});

describe('P4 standing acts follow life', () => {
  it('a planned visit replaces Book a visit', () => {
    const { rows } = waConsoleRows({
      facts: { projectId: 'p', possession: 'Dec 2027' },
      units: [],
      life: 'visit_planned',
      visitDay: 'Fri 18',
    });
    const yours = rows.find((r) => r.id === 'wa.visit.yours');
    expect(yours?.title).toMatch(/Your visit/);
    expect(rows.slice(-3).map((r) => r.id)).toEqual(['wa.visit.yours', WA_COMPARE, WA_MENU_OTHER]);
    expect(rows.map((r) => r.id)).not.toContain('visit_book');
  });

  it('after Total cost the next taps are EMI, visit, back — not Compare', () => {
    const s = commitTo(
      { ...state({ constraints: { bhk: '2 BHK' } }) },
      'brigade-eldorado',
      'Brigade Eldorado',
    );
    const packed = packWhatsAppInteractive({
      goal: { kind: 'answer', topic: 'price', projectId: 'brigade-eldorado' },
      state: s,
      catalogNames: BAG,
      singleProject: false,
      catalog: CATALOG,
      actionId: `${WA_MONEY_TOTAL}${WA_PROJECT_STAMP}brigade-eldorado`,
      focusUnits: [{ unitType: '2 BHK', priceDisplay: '₹89 L' }],
    });
    expect(packed.kind).toBe('buttons');
    if (packed.kind !== 'buttons') return;
    expect(packed.buttons.map((b) => b.id)).toEqual([WA_MONEY_EMI, 'visit_book', 'wa.back.file']);
    expect(packed.buttons.map((b) => b.id)).not.toContain(WA_MENU_OTHER);
  });
});

describe('P2 See vs Other on the old Projects id', () => {
  it('wa.menu.projects with a brief is Other; without is See', () => {
    expect(isWaOtherAction(WA_MENU_PROJECTS, { constraints: { bhk: '3 BHK' } })).toBe(true);
    expect(isWaSeeAction(WA_MENU_PROJECTS, { constraints: { bhk: '3 BHK' } })).toBe(false);
    expect(isWaSeeAction(WA_MENU_PROJECTS, { constraints: {} })).toBe(true);
    expect(isWaOtherAction(WA_MENU_PROJECTS, { constraints: {} })).toBe(false);
  });

  it('leaving the file keeps size/budget and the stack; See wipes both', () => {
    const focused = commitTo(
      { ...state({ constraints: { bhk: '3 BHK', budgetMaxInr: 1_00_00_000 } }) },
      'brigade-eldorado',
      'Brigade Eldorado',
    );
    const other = leaveFocusKeepStack(focused);
    expect(other.focus).toBeUndefined();
    expect(other.phase).toBe('discover');
    expect(other.constraints.bhk).toBe('3 BHK');
    expect(other.focusStack?.[0]).toBe('brigade-eldorado');
    const see = clearWaBriefConstraints(releaseToDiscover(focused));
    expect(see.focusStack ?? []).toEqual([]);
    expect(see.constraints.bhk).toBeUndefined();
    expect(see.constraints.budgetMaxInr).toBeUndefined();
  });
});

describe('P4 standing taps mean recall / the hold, not a new book', () => {
  it('Your visit is visit_recall; Your hold is the file', () => {
    const visit = applyWaInteractiveExtract(WA_VISIT_YOURS, ex({ askTopic: 'overview' }), BAG);
    expect(visit.speechAct).toBe('visit_recall');
    expect(visit.recall).toBe(true);
    const hold = applyWaInteractiveExtract(
      `${WA_HOLD_YOURS}${WA_PROJECT_STAMP}brigade-eldorado`,
      ex(),
      BAG,
    );
    expect(hold.speechAct).toBe('answer');
    expect(hold.askTopic).toBe('overview');
    expect(hold.namedProjects?.[0]?.projectId).toBe('brigade-eldorado');
  });
});
