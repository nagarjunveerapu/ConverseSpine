import { describe, expect, it } from 'vitest';
import {
  applyWaInteractiveExtract,
  packWhatsAppInteractive,
  packedToInteractive,
  parseWaBhk,
  parseWaPickId,
  resolveWaProjectFirst,
  waListPickKeepsCommit,
  WA_MENU_PROJECTS,
  WA_MONEY_MENU,
} from '../src/channel/wa-pack.js';
import { fallbackReply } from '../src/engine/compose.js';
import { isAdvisorBriefChipPhrase } from '../src/engine/advisor-brief-chips.js';
import { initState } from '../src/engine/state.js';
import { commitTo } from '../src/engine/state.js';

const CATALOG = [
  { projectId: 'brigade-eldorado', name: 'Brigade Eldorado' },
  { projectId: 'brigade-orchards', name: 'Brigade Orchards' },
  { projectId: 'cornerstone', name: 'Cornerstone Utopia' },
];

describe('resolveWaProjectFirst', () => {
  it('dig unset defaults on; prod unset defaults off', () => {
    expect(resolveWaProjectFirst(undefined, false)).toBe(true);
    expect(resolveWaProjectFirst(undefined, true)).toBe(false);
    expect(resolveWaProjectFirst('on', true)).toBe(true);
    expect(resolveWaProjectFirst('off', false)).toBe(false);
  });
});

describe('packWhatsAppInteractive', () => {
  it('greet packs the three-door welcome; the opened book keeps the pick rows', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'greet' },
      state: initState('c', 'brigade-group'),
      catalogNames: CATALOG,
      singleProject: false,
    });
    expect(packed.kind).toBe('buttons');
    if (packed.kind === 'buttons') {
      expect(packed.buttons.map((b) => b.id)).toEqual(['wa.menu.choose', 'wa.menu.see', 'wa.menu.know']);
    }
    const book = packWhatsAppInteractive({
      goal: { kind: 'greet' },
      state: initState('c', 'brigade-group'),
      catalogNames: CATALOG,
      singleProject: false,
      bookOpen: true,
    });
    expect(book.kind).toBe('list');
    if (book.kind === 'list') {
      expect(book.button).toBe('See projects');
      expect(book.sections[0]!.rows.map((r) => r.id)).toContain('wa.pick.brigade-eldorado');
    }
  });

  it('a focused pick with a cold record keeps the standing doors — never a Price button', () => {
    const s = commitTo(initState('c', 'brigade-group'), 'brigade-eldorado', 'Brigade Eldorado');
    const packed = packWhatsAppInteractive({
      goal: { kind: 'commit', projectId: 'brigade-eldorado', projectName: 'Brigade Eldorado' },
      state: s,
      catalogNames: CATALOG,
      singleProject: false,
    });
    // One console even when the record is cold: the honest minimum is the two
    // standing doors — not the old Price/Visit/Projects buttons whose bare
    // Price row the founder flagged.
    expect(packed.kind).toBe('list');
    if (packed.kind === 'list') {
      expect(packed.button).toBe('More');
      const ids = packed.sections[0]!.rows.map((r) => r.id);
      expect(ids).toEqual(['visit_book', 'compare_projects', WA_MENU_PROJECTS]);
      expect(ids).not.toContain(WA_MONEY_MENU);
    }
  });

  it('focused price answer with BHK moves on — total cost and EMI, never the ladder again', () => {
    let s = commitTo(initState('c', 'brigade-group'), 'brigade-eldorado', 'Brigade Eldorado');
    s = { ...s, constraints: { ...s.constraints, bhk: '3 BHK' } };
    const packed = packWhatsAppInteractive({
      goal: { kind: 'answer', topic: 'price', projectId: 'brigade-eldorado' },
      state: s,
      catalogNames: CATALOG,
      singleProject: false,
      focusUnits: [
        { unitType: '2 BHK', priceDisplay: '₹45 L', sizeDisplay: '740-1043 sqft' },
        { unitType: '3 BHK', priceDisplay: '₹68 L', sizeDisplay: '1300 sqft' },
      ],
    });
    expect(packed.kind).toBe('list');
    if (packed.kind === 'list') {
      const rows = packed.sections[0]!.rows;
      const ids = rows.map((r) => r.id);
      expect(ids.some((id) => id.startsWith('wa.money.bhk.'))).toBe(false);
      const total = rows.find((r) => r.id.startsWith('wa.money.total'));
      expect(total?.title).toBe('Total cost — 3 BHK');
      // EMI moved inside Money — the root keeps only the hottest money row.
      expect(ids.some((id) => id.startsWith('wa.node.money'))).toBe(true);
      expect(ids).toContain('visit_book');
      expect(ids[ids.length - 1]).toBe(WA_MENU_PROJECTS);
    }
  });

  it('visit ask packs real dates cut from the builder hours, plus a way back', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'propose_visit', projectId: 'brigade-eldorado' },
      state: commitTo(initState('c', 'brigade-group'), 'brigade-eldorado', 'Brigade Eldorado'),
      catalogNames: CATALOG,
      singleProject: false,
      siteVisitHours: 'Mon–Sat, 9am–7pm',
      openDays: new Set([1, 2, 3, 4, 5, 6]),
      nowMs: Date.UTC(2026, 7, 13, 6, 0, 0), // Thu 13 Aug 2026
    });
    // Hardcoded Saturday/Sunday buttons contradicted copy quoting Mon–Sat, and
    // made weekday visits look impossible. Days come from the hours string now.
    expect(packed.kind).toBe('list');
    if (packed.kind === 'list') {
      const rows = packed.sections[0]!.rows;
      expect(rows.some((r) => r.id === 'wa.day.sunday')).toBe(false);
      expect(rows.filter((r) => r.id.startsWith('wa.day.')).length).toBeGreaterThan(2);
      expect(rows[rows.length - 1]!.id).toBe(WA_MENU_PROJECTS);
    }
  });
});

describe('packedToInteractive + greet copy', () => {
  it('maps the opened book list to Graph-shaped dto', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'greet' },
      state: initState('c', 'brigade-group'),
      catalogNames: CATALOG,
      singleProject: false,
      bookOpen: true,
    });
    const dto = packedToInteractive(packed);
    expect(dto?.type).toBe('list');
    if (dto?.type === 'list') expect(dto.sections[0]!.rows.length).toBeGreaterThan(0);
  });

  it('project-first greet introduces the builder book, not the Advisor brief', () => {
    const reply = fallbackReply({
      goal: { kind: 'greet' },
      evidence: {
        tools: ['catalog'],
        catalog: {
          priceMinInr: 45_00_000,
          priceMaxInr: 2_00_00_000,
          projectTypes: ['apartments'],
          microMarkets: ['Devanahalli', 'Aerospace Park', 'Yelahanka'],
          total: 3,
          sample: [],
        },
      },
      context: {
        constraints: {},
        alreadyShownSameSet: false,
        builderName: 'Brigade Group',
        waProjectFirst: true,
        channel: 'whatsapp',
      },
    });
    expect(reply).toMatch(/Welcome to \*Brigade Group\*/);
    expect(reply).toMatch(/What are you looking for\?/);
    expect(reply.toLowerCase()).not.toMatch(/what brings you here/);
    expect(reply.toLowerCase()).not.toMatch(/area and budget/);
    expect(reply.toLowerCase()).not.toMatch(/drown you in filters/);
  });
});

describe('applyWaInteractiveExtract', () => {
  it('parses pick and bhk', () => {
    expect(parseWaPickId('wa.pick.brigade-eldorado')).toBe('brigade-eldorado');
    expect(parseWaBhk('wa.bhk.3_bhk')).toBe('3 BHK');
    const picked = applyWaInteractiveExtract(
      'wa.pick.brigade-eldorado',
      { constraints: {} },
      CATALOG,
    );
    expect(picked.namedProjects?.[0]?.projectId).toBe('brigade-eldorado');
    const sized = applyWaInteractiveExtract('wa.bhk.3_bhk', { constraints: {} }, CATALOG);
    expect(sized.constraints.bhk).toBe('3 BHK');
  });

  it('maps visit_book and answer_price chips', () => {
    const visit = applyWaInteractiveExtract('visit_book', { constraints: {} }, CATALOG);
    expect(visit.speechAct).toBe('visit_book');
    expect(visit.transition).toBe('want_visit');
    const price = applyWaInteractiveExtract('answer_price', { constraints: {} }, CATALOG);
    expect(price.askTopic).toBe('price');
    expect(price.speechAct).toBe('answer');
  });

  it('list pick keeps commit (no overview dump); typed tell-me-about still follows up', () => {
    expect(
      waListPickKeepsCommit(
        'wa.pick.brigade-eldorado',
        { kind: 'commit', followUp: 'overview' },
        { constraints: {} },
      ),
    ).toBe(true);
    expect(
      waListPickKeepsCommit(
        'wa.pick.brigade-eldorado',
        { kind: 'commit', followUp: 'price' },
        { askTopic: 'price' },
      ),
    ).toBe(false);
    expect(
      waListPickKeepsCommit(undefined, { kind: 'commit', followUp: 'overview' }, {}),
    ).toBe(false);
  });
});

describe('project-first commit copy', () => {
  it('list pick is a thin confirm, not the overview card', () => {
    const reply = fallbackReply({
      goal: { kind: 'commit', projectId: 'brigade-eldorado', projectName: 'Brigade Eldorado' },
      evidence: { tools: [] },
      context: {
        constraints: {},
        alreadyShownSameSet: false,
        builderName: 'Brigade Group',
        waProjectFirst: true,
        channel: 'whatsapp',
      },
    });
    expect(reply).toMatch(/Brigade Eldorado/);
    expect(reply).toMatch(/Price, a visit/i);
    expect(reply).not.toMatch(/Want pricing details|unit configurations|legal & RERA/i);
    expect(reply).not.toMatch(/1 BHK, 2 BHK/);
    expect(reply).not.toMatch(/Great choice/);
  });
});

describe('leftover Advisor chip labels', () => {
  it('never treat Trusting the builder / Not a priority as places', () => {
    expect(isAdvisorBriefChipPhrase('Trusting the builder')).toBe(true);
    expect(isAdvisorBriefChipPhrase('Not a priority')).toBe(true);
    expect(isAdvisorBriefChipPhrase('Daily traffic')).toBe(true);
    expect(isAdvisorBriefChipPhrase('Whitefield / ITPL')).toBe(true);
  });
});

describe('money menu — WhatsApp delivery contract', () => {
  // Brigade Eldorado really holds "2 BHK" and "2 BHK Comfort", "3 BHK" and
  // "3 BHK Classic" and "3 BHK Premium". The id used to be the BHK count
  // alone, so five rows collapsed onto two ids, Meta refused the list, and the
  // buyer got NOTHING — not the chrome and not the price. Three replies were
  // lost on the live line before this was found.
  const UNITS = [
    { unitType: '1 BHK', priceDisplay: '₹31 L', sizeDisplay: '650 sqft' },
    { unitType: '2 BHK', priceDisplay: '₹45 L', sizeDisplay: '740-1043 sqft' },
    { unitType: '2 BHK Comfort', priceDisplay: '₹52 L', sizeDisplay: '1050-1150 sqft' },
    { unitType: '3 BHK', priceDisplay: '₹68 L', sizeDisplay: '1300 sqft' },
    { unitType: '3 BHK Classic', priceDisplay: '₹75 L', sizeDisplay: '1450 sqft' },
    { unitType: '3 BHK Premium', priceDisplay: '₹92 L', sizeDisplay: '1600 sqft' },
  ];

  function moneyMenu() {
    const state = commitTo(initState('c', 'brigade-group'), 'brigade-eldorado', 'Brigade Eldorado');
    return packWhatsAppInteractive({
      goal: { kind: 'answer', topic: 'price' } as never,
      state,
      catalogNames: CATALOG,
      singleProject: false,
      focusUnits: UNITS,
    });
  }

  it('gives every config row a unique id, so WhatsApp accepts the list', () => {
    const packed = moneyMenu();
    expect(packed.kind).toBe('list');
    if (packed.kind !== 'list') return;
    const ids = packed.sections.flatMap((s) => s.rows.map((r) => r.id));
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a variant row still resolves to its BHK when tapped', () => {
    // The ladder rides the size-open pick list now — that's where variants live.
    const state = commitTo(initState('c', 'brigade-group'), 'brigade-eldorado', 'Brigade Eldorado');
    const packed = packWhatsAppInteractive({
      goal: { kind: 'commit', projectId: 'brigade-eldorado', projectName: 'Brigade Eldorado' },
      state,
      catalogNames: CATALOG,
      singleProject: false,
      focusUnits: UNITS,
    });
    if (packed.kind !== 'list') throw new Error('expected a list');
    const comfort = packed.sections
      .flatMap((s) => s.rows)
      .find((r) => r.title === '2 BHK Comfort');
    expect(comfort).toBeDefined();
    const ex = applyWaInteractiveExtract(comfort!.id, { constraints: {} } as never, CATALOG);
    // Canonical everywhere in the engine — a bare '2' printed as "Noted: *2*".
    expect(ex.constraints?.bhk).toBe('2 BHK');
    expect(ex.askTopic).toBe('price');
  });

  /**
   * 13 Aug, the real line: the founder tapped "2 BHK" inside Brigade Eldorado
   * and got a book-wide search — "Noted: 2 BHK. Here's what lines up: Brigade
   * Cornerstone…; Brigade Eldorado…; Brigade Orchards…". The tap had arrived;
   * the focus behind it had not. A tap that needs state to mean the right
   * thing will one day mean the wrong one.
   */
  describe('a money tap carries its own project', () => {
    function sizeList() {
      const state = commitTo(initState('c', 'brigade-group'), 'brigade-eldorado', 'Brigade Eldorado');
      return packWhatsAppInteractive({
        goal: { kind: 'commit', projectId: 'brigade-eldorado', projectName: 'Brigade Eldorado' },
        state,
        catalogNames: CATALOG,
        singleProject: false,
        focusUnits: UNITS,
      });
    }

    it('stamps the project on every size row of the pick list', () => {
      const packed = sizeList();
      if (packed.kind !== 'list') throw new Error('expected a list');
      const sizes = packed.sections
        .flatMap((s) => s.rows)
        .filter((r) => r.id.startsWith('wa.money.bhk.'));
      expect(sizes.length).toBeGreaterThan(1);
      for (const r of sizes) expect(r.id.endsWith('@brigade-eldorado')).toBe(true);
    });

    it('names the project even when state has lost focus', () => {
      const packed = sizeList();
      if (packed.kind !== 'list') throw new Error('expected a list');
      const twoBhk = packed.sections.flatMap((s) => s.rows).find((r) => r.title === '2 BHK');
      expect(twoBhk).toBeDefined();

      // Decoded against an EMPTY extraction — no focus, no history: the state
      // the failing turn actually ran with.
      const ex = applyWaInteractiveExtract(twoBhk!.id, { constraints: {} } as never, CATALOG);

      expect(ex.namedProjects?.[0]?.projectId).toBe('brigade-eldorado');
      expect(ex.pickName).toBe('Brigade Eldorado');
      expect(ex.constraints?.bhk).toBe('2 BHK');
      expect(ex.askTopic).toBe('price');
    });

    it('still decodes an unstamped id from an older message', () => {
      const ex = applyWaInteractiveExtract('wa.money.bhk.2', { constraints: {} } as never, CATALOG);
      expect(ex.constraints?.bhk).toBe('2 BHK');
      expect(ex.askTopic).toBe('price');
    });

    it('keeps stamped ids unique and inside Meta id limits', () => {
      const packed = sizeList();
      if (packed.kind !== 'list') throw new Error('expected a list');
      const ids = packed.sections.flatMap((s) => s.rows.map((r) => r.id));
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id.length).toBeLessThanOrEqual(200);
    });
  });

  it('honours the row/title limits Meta enforces', () => {
    const packed = moneyMenu();
    if (packed.kind !== 'list') throw new Error('expected a list');
    const rows = packed.sections.flatMap((s) => s.rows);
    expect(rows.length).toBeLessThanOrEqual(10);
    expect(packed.button.length).toBeLessThanOrEqual(20);
    for (const r of rows) {
      expect(r.title.trim()).not.toBe('');
      expect(r.title.length).toBeLessThanOrEqual(24);
      expect((r.description ?? '').length).toBeLessThanOrEqual(72);
    }
    for (const s of packed.sections) expect(s.title.length).toBeLessThanOrEqual(24);
  });
});
