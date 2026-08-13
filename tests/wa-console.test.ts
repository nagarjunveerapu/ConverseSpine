import { describe, expect, it } from 'vitest';
import { waConsoleNodeReply } from '../src/channel/wa-console.js';
import type { ProjectDetail } from '../src/engine/types.js';

const DETAIL: ProjectDetail = {
  projectId: 'brigade-eldorado',
  name: 'Brigade Eldorado',
  microMarket: 'Aerospace Park',
  reraNumber: 'PRM/KA/RERA/1251/446/PR/002236',
  khata: 'A-Khata (BBMP)',
  possession: 'Phase-wise; Dioro & Beryl: June 2028',
  phases: [
    { phaseId: 'p1', phaseLabel: 'Gallium', stage: 'ready', possession: 'Ready' },
    { phaseId: 'p2', phaseLabel: 'Dioro', stage: 'under construction', possession: 'June 2028' },
  ],
  amenities: ['Clubhouse', 'Pool', 'Gym'],
  location: {
    connectivitySummary: '10 min from Aerospace Park SEZ.',
    schools: [{ name: 'Oxford School', driveMinutes: 12 }],
  },
};

describe('the console speaks the tap, nothing else', () => {
  it('trust screen carries the legal facts and no configurations', () => {
    const reply = waConsoleNodeReply('wa.node.trust@brigade-eldorado', { kind: 'answer', topic: 'legal' }, DETAIL);
    expect(reply).toContain('PRM/KA/RERA');
    expect(reply).toContain('A-Khata');
    // The over-answer dump: config sheets never ride a trust tap.
    expect(reply).not.toMatch(/BHK|sqft|₹/);
    // Stale requirement leak: no "I don't have loan eligibility" preamble.
    expect(reply).not.toMatch(/don't have/i);
  });

  it('possession screen renders from the same record the menu gate read', () => {
    const reply = waConsoleNodeReply('wa.node.time@brigade-eldorado', { kind: 'answer', topic: 'overview' }, DETAIL);
    expect(reply).toContain('June 2028');
    expect(reply).toContain('Gallium');
  });

  it('location screen speaks the POIs it has', () => {
    const reply = waConsoleNodeReply('wa.node.place@brigade-eldorado', { kind: 'answer', topic: 'location' }, DETAIL);
    expect(reply).toContain('Aerospace Park');
    expect(reply).toContain('Oxford School');
  });

  it('a screen with no backing data yields nothing, so the engine reply stands', () => {
    const sparse: ProjectDetail = { projectId: 'x', name: 'X', microMarket: '' };
    expect(waConsoleNodeReply('wa.node.trust@x', { kind: 'answer', topic: 'legal' }, sparse)).toBeUndefined();
    expect(waConsoleNodeReply('wa.node.later@x', { kind: 'answer', topic: 'overview' }, sparse)).toBeUndefined();
  });

  it('a stamp for another project never speaks this record', () => {
    expect(
      waConsoleNodeReply('wa.node.trust@brigade-orchards', { kind: 'answer', topic: 'legal' }, DETAIL),
    ).toBeUndefined();
  });

  it('free text and non-node taps stay with the engine', () => {
    expect(waConsoleNodeReply(undefined, { kind: 'answer', topic: 'legal' }, DETAIL)).toBeUndefined();
    expect(waConsoleNodeReply('visit_book', { kind: 'answer', topic: 'legal' }, DETAIL)).toBeUndefined();
  });
});

// ---- Known facts are consumed, never re-asked (founder walk, 14 Aug) ----
import { packWhatsAppInteractive } from '../src/channel/wa-pack.js';
import { commitTo, initState } from '../src/engine/state.js';

const UNITS = [
  { unitType: '1 BHK', priceDisplay: '₹41L—₹50L', sizeDisplay: '782-799 sqft' },
  { unitType: '2 BHK', priceDisplay: '₹45L—₹77L', sizeDisplay: '720-1259 sqft' },
  { unitType: '3 BHK', priceDisplay: '₹85L—₹110L', sizeDisplay: '1389-1905 sqft' },
];

function focusedState(bhk?: string) {
  let s = commitTo(initState('c', 'brigade-group'), 'cornerstone', 'Brigade Cornerstone');
  if (bhk) s = { ...s, constraints: { ...s.constraints, bhk } };
  return s;
}

describe('chips consume what the buyer already said', () => {
  it('price answer with a known size never re-offers the size ladder', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'answer', topic: 'price', projectId: 'cornerstone' },
      state: focusedState('2 BHK'),
      catalogNames: [],
      singleProject: false,
      focusUnits: UNITS,
      focusFacts: { projectId: 'cornerstone', reraNumber: 'PRM/KA/X', possession: 'Dec 2027' },
    });
    expect(packed.kind).toBe('list');
    if (packed.kind === 'list') {
      const ids = packed.sections[0]!.rows.map((r) => r.id);
      expect(ids.some((id) => id.startsWith('wa.money.bhk.'))).toBe(false);
      expect(ids.some((id) => id.startsWith('wa.money.emi'))).toBe(true);
      expect(ids.some((id) => id.startsWith('wa.node.trust'))).toBe(true);
      expect(ids).toContain('visit_book');
    }
  });

  it('price answer without a size keeps the ladder', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'answer', topic: 'price', projectId: 'cornerstone' },
      state: focusedState(),
      catalogNames: [],
      singleProject: false,
      focusUnits: UNITS,
    });
    expect(packed.kind).toBe('list');
    if (packed.kind === 'list') {
      expect(packed.sections[0]!.rows.some((r) => r.id.startsWith('wa.money.bhk.'))).toBe(true);
    }
  });

  it('project pick with a known size shows next steps, not a size ladder', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'commit', projectId: 'cornerstone', projectName: 'Brigade Cornerstone' },
      state: focusedState('2 BHK'),
      catalogNames: [],
      singleProject: false,
      focusUnits: UNITS,
      focusFacts: { projectId: 'cornerstone', reraNumber: 'PRM/KA/X', possession: 'Dec 2027' },
    });
    expect(packed.kind).toBe('list');
    if (packed.kind === 'list') {
      const ids = packed.sections[0]!.rows.map((r) => r.id);
      expect(ids.some((id) => id.startsWith('wa.money.bhk.'))).toBe(false);
      expect(ids[0]).toMatch(/^wa\.money\.total/);
      expect(packed.sections[0]!.rows[0]!.title).toContain('2 BHK');
      expect(ids.some((id) => id.startsWith('wa.node.'))).toBe(true);
      expect(ids).toContain('visit_book');
    }
  });
});

describe('the project card is the mock card', () => {
  const CARD_DETAIL: ProjectDetail = {
    ...DETAIL,
    startingPriceDisplay: '₹31 L',
    summary: '50-acre integrated township by Brigade Group in Aerospace Park. 12 towers.',
    configurations: [
      { unitType: '1 BHK', priceDisplay: '₹31L+', priceMinInr: 31_00_000, sizeDisplay: '521-600 sqft' },
      { unitType: '2 BHK', priceDisplay: '₹57L+', priceMinInr: 57_00_000, sizeDisplay: '740-1150 sqft' },
      { unitType: '3 BHK', priceDisplay: '₹89L+', priceMinInr: 89_00_000, sizeDisplay: '1200-2800 sqft' },
    ],
  };

  it('one labelled line per backed node, ending on the console question', async () => {
    const { waConsoleCardReply } = await import('../src/channel/wa-console.js');
    const card = waConsoleCardReply(CARD_DETAIL)!;
    expect(card).toMatch(/^\*Brigade Eldorado\*/);
    expect(card).toContain('*Fit* — 3 sizes: 1 BHK · 2 BHK · 3 BHK');
    expect(card).toContain('*Unit* — 3 options, 521–2,800 sqft');
    expect(card).toContain('*Money* — from ₹31 L');
    expect(card).toContain('*Trust* — RERA registered · A-Khata (BBMP)');
    expect(card).toContain('*Time* — Phase-wise; Dioro & Beryl: June 2028');
    expect(card.trim().endsWith('What do you want to check?')).toBe(true);
  });

  it('lines the record cannot back are absent, never apologised for', async () => {
    const { waConsoleCardReply } = await import('../src/channel/wa-console.js');
    const sparse: ProjectDetail = {
      projectId: 'x', name: 'X Towers', microMarket: 'Devanahalli',
      startingPriceDisplay: '₹45 L', reraNumber: 'PRM/KA/1',
    };
    const card = waConsoleCardReply(sparse)!;
    expect(card).toContain('*Money*');
    expect(card).toContain('*Trust*');
    expect(card).not.toContain('*Fit*');
    expect(card).not.toContain('*Time*');
    expect(card).not.toMatch(/don't have|not on file/i);
  });

  it('a record backing fewer than two lines yields no card', async () => {
    const { waConsoleCardReply } = await import('../src/channel/wa-console.js');
    expect(waConsoleCardReply({ projectId: 'x', name: 'X', microMarket: '' })).toBeUndefined();
  });
});
