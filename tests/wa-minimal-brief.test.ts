import { describe, expect, it } from 'vitest';
import * as discover from '../src/engine/phases/discover.js';
import { initState } from '../src/engine/state.js';
import { fallbackReply, waBookFirstGreet, waBriefReceipt } from '../src/engine/compose.js';
import { isAdvisorBriefChipPhrase } from '../src/engine/advisor-brief-chips.js';
import { parseBudgetToInr, textAnchorsProjectName } from '../src/engine/facts.js';
import {
  advanceWaBriefState,
  applyWaInteractiveExtract,
  isWaBriefActionId,
  packWhatsAppInteractive,
  syncWaBriefFromGoal,
  waBudgetRows,
  waSizeRows,
  WA_BUDGET_ANY,
  WA_MENU_BUDGET,
  WA_MENU_CHOOSE,
  WA_MENU_PROJECTS,
  WA_SIZE_ANY,
  WA_TYPE_PLOT,
  WA_TYPE_VILLA,
} from '../src/channel/wa-pack.js';
import type { ConversationState, Extracted } from '../src/engine/types.js';

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

function state(over: Partial<ConversationState> = {}): ConversationState {
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
    expect(many).toMatch(/What are you looking for\?/);
    // No catalog dump on the welcome — corridors and price live behind See everything.
    expect(many).not.toMatch(/from about/);
    const one = waBookFirstGreet({ builderName: 'Brigade', catalog: { ...CATALOG, total: 1 } });
    expect(one).toMatch(/Pick a project/);
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
      expect(packed.button).toBe('Choose size');
      const ids = packed.sections[0]!.rows.map((r) => r.id);
      expect(ids).toContain('wa.bhk.3_bhk');
      expect(ids).toContain(WA_TYPE_VILLA);
      expect(ids).toContain(WA_TYPE_PLOT);
      expect(ids).toContain(WA_SIZE_ANY);
      expect(packed.sections[0]!.rows.every((r) => r.title.length <= 24)).toBe(true);
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

  it('probe budget packs the band sheet', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'probe', slot: 'budget' },
      state: state(),
      catalogNames: BAG,
      singleProject: false,
      catalog: CATALOG,
    });
    expect(packed.kind).toBe('list');
    if (packed.kind === 'list') expect(packed.button).toBe('Set budget');
  });
});

describe('brief step machine', () => {
  it('Help me choose opens at the first missing fact', () => {
    expect(advanceWaBriefState(state(), WA_MENU_CHOOSE, ex()).discover.waBriefStep).toBe('size');
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
});

describe('minimal-brief compose copy', () => {
  const baseContext = {
    constraints: {},
    alreadyShownSameSet: false,
    builderName: 'Brigade Group',
    waProjectFirst: true,
    channel: 'whatsapp' as const,
  };

  it('size question is two-taps framing, not the Advisor interview', () => {
    const reply = fallbackReply({
      goal: { kind: 'probe', slot: 'bhk' },
      evidence: { tools: [] },
      context: baseContext,
    });
    expect(reply).toMatch(/Two quick taps/);
    expect(reply.toLowerCase()).not.toMatch(/what brings you here|worries|commute/);
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
    expect(reply).toMatch(/ceiling/);
    expect(reply).toMatch(/Homes here run/);
    expect(reply).toMatch(/Got it — 3 BHK/);
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
    expect(reply).toMatch(/^Noted: \*3 BHK · under/);
    expect(reply).toMatch(/Brigade Eldorado/);
  });

  it('an empty cut is an honest no-fit, not a silent relax', () => {
    const reply = fallbackReply({
      goal: { kind: 'recommend' },
      evidence: { tools: [], matches: [] },
      context: { ...baseContext, constraints: { bhk: '3 BHK', budgetMaxInr: 60_00_000 } },
    });
    expect(reply).toMatch(/Nothing in the book fits/);
    expect(reply).toMatch(/Noted: \*3 BHK/);
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
    expect(isAdvisorBriefChipPhrase('Any size')).toBe(true);
    expect(isAdvisorBriefChipPhrase('Any budget')).toBe(true);
    expect(isAdvisorBriefChipPhrase('Under ₹90L')).toBe(true);
    expect(isAdvisorBriefChipPhrase('₹90L – ₹1.3 Cr')).toBe(true);
    expect(isAdvisorBriefChipPhrase('Above ₹1.3 Cr')).toBe(true);
    expect(isAdvisorBriefChipPhrase('Devanahalli')).toBe(false);
  });
});

describe('tap ids are authoritative — label-derived meaning is scrubbed', () => {
  it('menu and answer taps clear ask topics and isQuestion', () => {
    for (const aid of [WA_MENU_CHOOSE, WA_MENU_BUDGET, WA_MENU_PROJECTS, WA_SIZE_ANY, WA_BUDGET_ANY]) {
      const out = applyWaInteractiveExtract(
        aid,
        ex({ askTopic: 'overview', askTopics: ['overview'], isQuestion: true }),
        BAG,
      );
      expect(out.askTopic, aid).toBeUndefined();
      expect(out.askTopics, aid).toBeUndefined();
      expect(out.isQuestion, aid).toBe(false);
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
      WA_MENU_CHOOSE, WA_MENU_BUDGET, WA_MENU_PROJECTS, WA_SIZE_ANY, WA_BUDGET_ANY,
      WA_TYPE_VILLA, WA_TYPE_PLOT, 'wa.bhk.2_bhk', 'wa.budget.b_5000000_8000000',
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
