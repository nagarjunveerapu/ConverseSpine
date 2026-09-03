import { describe, expect, it } from 'vitest';
import {
  applyWaInteractiveExtract,
  isWaBriefActionId,
  packWhatsAppInteractive,
  splitProjectStamp,
  waCanonicalUtterance,
  waConsoleRows,
  WA_MENU_NODE,
  WA_COMPARE,
  WA_MENU_PROJECTS,
  WA_MONEY_MENU,
  WA_NODE_LATER,
  WA_NODE_LIFE,
  WA_NODE_PLACE,
  WA_NODE_TIME,
  WA_NODE_TRUST,
  WA_PROJECT_STAMP,
  type WaNodeFacts,
} from '../src/channel/wa-pack.js';
import { commitTo, initState } from '../src/engine/state.js';
import { runEngineTurn } from '../src/engine/turn.js';
import type { Extracted } from '../src/engine/types.js';
import { fakeDeps } from './fakes.js';

/**
 * The buyer console's node layer — Book → Project → NODE → Detail. Live-run
 * L06/L07: a tap's meaning must be its id, and a menu must never offer a node
 * the project's record cannot answer. "The gap doesn't disappear — it moves
 * off the buyer's screen."
 */

const CATALOG = [
  { projectId: 'brigade-eldorado', name: 'Brigade Eldorado' },
  { projectId: 'brigade-orchards', name: 'Brigade Orchards' },
];

const FULL_FACTS: WaNodeFacts = {
  projectId: 'brigade-eldorado',
  reraNumber: 'PRM/KA/RERA/1251/446/PR/181219/002236',
  khata: 'A-Khata',
  possession: 'Jun 2028',
  amenities: ['clubhouse', 'pool', 'gym'],
  location: { connectivitySummary: '15 min from the airport' },
  investment: { expectedRoi: '8-12% from year 3' },
  mediaKinds: ['brochure', 'floor_plan'],
};

const emptyExtract = (): Extracted => ({ constraints: {} }) as unknown as Extracted;

describe('waConsoleRows — the honest console menu (node layer)', () => {
  it('draws every section the record can answer, acts last', () => {
    const { rows, infoCount } = waConsoleRows({ facts: FULL_FACTS });
    expect(rows.map((r) => r.id)).toEqual([
      WA_NODE_TRUST,
      WA_NODE_PLACE,
      WA_NODE_LIFE,
      WA_NODE_TIME,
      WA_NODE_LATER,
      'visit_book',
      WA_COMPARE,
      WA_MENU_PROJECTS,
    ]);
    // Unseen answers, not rows: brochure + trust/place/life/time + returns.
    expect(infoCount).toBe(6);
  });

  it('a section with nothing behind it is not drawn — no row, no badge', () => {
    const { rows } = waConsoleRows({
      facts: {
        projectId: 'p1',
        possession: 'Dec 2027',
        // no rera/khata/ec, no amenities, no location, no investment, no media
      },
    });
    expect(rows.map((r) => r.id)).toEqual([WA_NODE_TIME, 'visit_book', WA_COMPARE, WA_MENU_PROJECTS]);
  });

  it('Returns rides only when REAL yield fields are on the record', () => {
    const ids = (facts: WaNodeFacts) => waConsoleRows({ facts }).rows.map((r) => r.id);
    expect(ids({ projectId: 'p1', possession: 'Dec 2027', khata: 'A-Khata' })).not.toContain(WA_NODE_LATER);
    // The real ProjectMarketIntel/ProjectInvestment fields draw the row…
    expect(ids({ projectId: 'p2', marketIntel: { appreciation3yrPct: 12 } })).toContain(WA_NODE_LATER);
    expect(ids({ projectId: 'p3', investment: { expectedRoi: '4% net' } })).toContain(WA_NODE_LATER);
    // …an empty or displayName-only intel object does not: the screen reads
    // the same fields, and it would render nothing (the drawn-row-onto-nothing bug).
    expect(ids({ projectId: 'p4', marketIntel: {}, investment: {} })).not.toContain(WA_NODE_LATER);
  });

  it('no record: the standing acts stand, nothing is invented', () => {
    const { rows, infoCount } = waConsoleRows({});
    expect(rows.map((r) => r.id)).toEqual(['visit_book', WA_COMPARE, WA_MENU_PROJECTS]);
    expect(infoCount).toBe(0);
  });
});

describe('node taps — the id is the meaning', () => {
  it('canonical utterances speak the closed sets, stamped or bare', () => {
    expect(waCanonicalUtterance(`${WA_NODE_TIME}${WA_PROJECT_STAMP}brigade-eldorado`)).toBe(
      'when is possession',
    );
    expect(waCanonicalUtterance(WA_NODE_TRUST)).toBe('legal and approval status');
    expect(waCanonicalUtterance(WA_NODE_PLACE)).toBe('location and connectivity');
    expect(waCanonicalUtterance(`${WA_MENU_NODE}${WA_PROJECT_STAMP}p1`)).toBe(
      'tell me more about this project',
    );
    // The day path is untouched by stamp-splitting.
    expect(waCanonicalUtterance('wa.day.saturday')).toBe('saturday');
  });

  it('a stamped node tap re-focuses its project and names its topic', () => {
    const out = applyWaInteractiveExtract(
      `${WA_NODE_TRUST}${WA_PROJECT_STAMP}brigade-orchards`,
      emptyExtract(),
      CATALOG,
    );
    expect(out.askTopic).toBe('legal');
    expect(out.speechAct).toBe('answer');
    expect(out.namedProjects).toEqual([{ projectId: 'brigade-orchards', name: 'Brigade Orchards' }]);
  });

  it('time and later ride overview, where FAQ/FactKey own the fact', () => {
    for (const aid of [WA_NODE_TIME, WA_NODE_LATER, WA_MENU_NODE]) {
      const out = applyWaInteractiveExtract(aid, emptyExtract(), CATALOG);
      expect(out.askTopic).toBe('overview');
    }
  });

  it('node ids are brief ids — label topics must not merge over them', () => {
    expect(isWaBriefActionId(`${WA_NODE_TRUST}${WA_PROJECT_STAMP}p1`)).toBe(true);
    expect(isWaBriefActionId(WA_MENU_NODE)).toBe(true);
  });
});

describe('packWhatsAppInteractive — node menu chrome', () => {
  const focused = () =>
    commitTo(initState('c', 'brigade-group'), 'brigade-eldorado', 'Brigade Eldorado');

  it('overview on a focused project packs the node list, stamped', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'answer', topic: 'overview', projectId: 'brigade-eldorado' },
      state: focused(),
      catalogNames: CATALOG,
      singleProject: false,
      focusFacts: FULL_FACTS,
    });
    expect(packed.kind).toBe('list');
    if (packed.kind === 'list') {
      const rows = packed.sections[0]!.rows;
      expect(rows.length).toBeLessThanOrEqual(10);
      // The file leads with its sections; Trust is the first one this record backs.
      expect(splitProjectStamp(rows[0]!.id).aid).toBe(WA_NODE_TRUST);
      expect(rows.map((r) => splitProjectStamp(r.id).aid)).toContain(WA_NODE_TRUST);
      const trust = rows.find((r) => splitProjectStamp(r.id).aid === WA_NODE_TRUST)!;
      expect(splitProjectStamp(trust.id).projectId).toBe('brigade-eldorado');
      // The way back is always on the sheet.
      expect(rows.map((r) => r.id)).toContain(WA_MENU_PROJECTS);
    }
  });

  it('a focused answer always gets the console list — never a bare Price button', () => {
    const withFacts = packWhatsAppInteractive({
      goal: { kind: 'answer', topic: 'legal', projectId: 'brigade-eldorado' },
      state: focused(),
      catalogNames: CATALOG,
      singleProject: false,
      focusFacts: FULL_FACTS,
    });
    expect(withFacts.kind).toBe('list');
    if (withFacts.kind === 'list') {
      expect(withFacts.button).toBe('More');
      const aids = withFacts.sections[0]!.rows.map((r) => splitProjectStamp(r.id).aid);
      expect(aids).toContain(WA_NODE_TRUST);
      // The founder's flagged row: no WA_MONEY_MENU "Price" door on focused turns.
      expect(aids).not.toContain(WA_MONEY_MENU);
    }

    // A cold record cannot fill the file — the standing doors still stand,
    // and nothing is invented to dress the menu up.
    const withoutFacts = packWhatsAppInteractive({
      goal: { kind: 'answer', topic: 'legal', projectId: 'brigade-eldorado' },
      state: focused(),
      catalogNames: CATALOG,
      singleProject: false,
    });
    expect(withoutFacts.kind).toBe('list');
    if (withoutFacts.kind === 'list') {
      expect(withoutFacts.sections[0]!.rows.map((r) => r.id)).toEqual([
        'visit_book',
        WA_COMPARE,
        WA_MENU_PROJECTS,
      ]);
    }
  });

  it('a pick with no size leads with the price-free ladder inside 10 rows', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'commit', projectId: 'brigade-eldorado', projectName: 'Brigade Eldorado' },
      state: focused(),
      catalogNames: CATALOG,
      singleProject: false,
      focusUnits: [
        { unitType: '1 BHK', priceDisplay: '₹31L–₹50L' },
        { unitType: '2 BHK', priceDisplay: '₹57.5L–₹1.05Cr' },
        { unitType: '2 BHK Comfort', priceDisplay: '₹95L–₹1.1Cr' },
        { unitType: '3 BHK', priceDisplay: '₹89L–₹1.66Cr' },
        { unitType: '3 BHK Classic', priceDisplay: '₹1.3–1.55Cr' },
        { unitType: '3 BHK Premium', priceDisplay: '₹1.55–1.85Cr' },
        { unitType: '4 BHK Penthouse', priceDisplay: '₹2.8–3.5Cr' },
      ],
    });
    expect(packed.kind).toBe('list');
    if (packed.kind === 'list') {
      const rows = packed.sections[0]!.rows;
      expect(rows.length).toBeLessThanOrEqual(10);
      const aids = rows.map((r) => splitProjectStamp(r.id).aid);
      // Variant configs keep unique ids even at the same BHK count.
      expect(aids).toContain('wa.money.bhk.2');
      expect(aids).toContain('wa.money.bhk.2.comfort');
      // No console row ever prints a ₹ figure — the tapped answer does.
      for (const r of rows) expect(r.description ?? '').not.toContain('₹');
      expect(rows.slice(-3).map((r) => r.id)).toEqual(['visit_book', WA_COMPARE, WA_MENU_PROJECTS]);
    }
  });
});

describe('engine: a node tap answers with the project record (WA project-first)', () => {
  function harness(threadId: string) {
    const deps = { ...fakeDeps(), waProjectFirst: true };
    const turn = (text: string, actionId?: string) =>
      runEngineTurn(
        {
          threadId,
          builderId: 'lokations',
          text,
          buyerPhone: '+919999991171',
          channel: 'whatsapp',
          ...(actionId ? { action_id: actionId } : {}),
        },
        deps,
      );
    return { deps, turn };
  }

  it('Possession tap answers possession on the stamped project', async () => {
    const { turn } = harness('wa-node-time');
    const opened = await turn('tell me about Brigade Eldorado');
    const pid = opened.state.focus?.projectId;
    expect(pid).toBeTruthy();

    const out = await turn('Possession', `${WA_NODE_TIME}${WA_PROJECT_STAMP}${pid}`);

    expect(out.debug.goal.kind).toBe('answer');
    // The fake book files possession for every lokations project.
    expect(out.reply.toLowerCase()).toMatch(/possession|20\d\d/);
    // The label "Possession" must not have been read as a new search.
    expect(out.state.focus?.projectId).toBe(pid);
  });

  it('Trust tap speaks RERA from the record, not the label', async () => {
    const { turn } = harness('wa-node-trust');
    const opened = await turn('tell me about Brigade Eldorado');
    const pid = opened.state.focus?.projectId;

    const out = await turn('Trust & legal', `${WA_NODE_TRUST}${WA_PROJECT_STAMP}${pid}`);

    expect(out.debug.goal.kind).toBe('answer');
    expect(out.reply).toMatch(/RERA|PRM\/KA/i);
  });
});

describe('engine: a bare yes lands on the armed offer (WA project-first)', () => {
  it('yes after an offer_pricing closer answers the offered topic', async () => {
    const deps = { ...fakeDeps(), waProjectFirst: true };
    const threadId = 'wa-yes-antecedent';
    let s = commitTo(initState(threadId, 'lokations'), 'eldorado', 'Brigade Eldorado');
    s = {
      ...s,
      rti: {
        pendingPrompt: {
          kind: 'offer_pricing',
          project_id: 'eldorado',
          project_name: 'Brigade Eldorado',
          topic: 'price',
          asked_at_turn: s.turnCount,
        },
      },
    };
    await deps.store.save(s);

    const out = await runEngineTurn(
      {
        threadId,
        builderId: 'lokations',
        text: 'yes',
        buyerPhone: '+919999991172',
        channel: 'whatsapp',
      },
      deps,
    );

    // The open question was read: the turn is the offered price answer, not a
    // greet, a re-orient, or the recovery machine's filter probe.
    expect(out.debug.goal.kind).toBe('answer');
    expect(out.debug.goal).toMatchObject({ topic: 'price' });
    expect(out.state.focus?.projectId).toBe('eldorado');
  });

  it('no after the same offer declines it — never the filter-adjust probe', async () => {
    const deps = { ...fakeDeps(), waProjectFirst: true };
    const threadId = 'wa-no-antecedent';
    let s = commitTo(initState(threadId, 'lokations'), 'eldorado', 'Brigade Eldorado');
    s = {
      ...s,
      rti: {
        pendingPrompt: {
          kind: 'offer_pricing',
          project_id: 'eldorado',
          project_name: 'Brigade Eldorado',
          topic: 'price',
          asked_at_turn: s.turnCount,
        },
      },
    };
    await deps.store.save(s);

    const out = await runEngineTurn(
      {
        threadId,
        builderId: 'lokations',
        text: 'no thanks',
        buyerPhone: '+919999991173',
        channel: 'whatsapp',
      },
      deps,
    );

    // Declining an offer is not leaving the project, and it is never the
    // Advisor recovery probe ("adjust your filters…").
    expect(out.state.focus?.projectId).toBe('eldorado');
    expect(out.reply.toLowerCase()).not.toMatch(/adjust|filters|area, budget/);
    expect(out.debug.goal.kind).not.toBe('no_fit');
  });
});
