import { describe, expect, it } from 'vitest';
import { applyExtracted, initState } from '../src/engine/state.js';
import { detectPropertyTypes, extractFactsSync } from '../src/engine/facts.js';
import { catalogSellsPropertyType } from '../src/engine/catalog-type.js';
import { fallbackReply } from '../src/engine/compose.js';
import { packWhatsAppInteractive, WA_MENU_CHOOSE, WA_MENU_SEE } from '../src/channel/wa-pack.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';
import type { EngineDeps } from '../src/engine/ports.js';

function apartmentBookDeps(): EngineDeps {
  const base = fakeDeps();
  return {
    ...base,
    waProjectFirst: true,
    data: {
      ...base.data,
      async search(builderId, filters) {
        const r = await base.data.search(builderId, filters);
        const types = (filters.projectTypes ?? '').toLowerCase();
        if (types.includes('plantation') || types.includes('estate')) {
          return { ...r, matches: [] };
        }
        return {
          ...r,
          matches: r.matches.filter((m) => /apartment/i.test(m.project_type ?? '')),
        };
      },
      async catalog() {
        const c = await base.data.catalog('x');
        return { ...c, projectTypes: ['apartment'] };
      },
    },
  };
}

describe('unsupported product — structure, not phrase lists', () => {
  it('one product mode: never concatenates apartment,plantation', () => {
    expect(detectPropertyTypes('plantation chahiye, apartment nahi')).toBe('plantation');
    expect(detectPropertyTypes('apartment nahi')).toBeUndefined();
    expect(detectPropertyTypes('farmland near Kanakapura')).toBe('plantation');
  });

  it('a new declared type replaces the old one (no longer-string lock)', () => {
    const s = applyExtracted(initState('t', 'brigade-group'), {
      constraints: { propertyType: 'plantation' },
    } as never);
    const next = applyExtracted(s, { constraints: { propertyType: 'apartment' } } as never);
    expect(next.constraints.propertyType).toBe('apartment');
  });

  it('bare leftover text does not replace a filled location', () => {
    const s = initState('t', 'brigade-group');
    s.constraints.location = 'Coorg';
    expect(extractFactsSync('Samajh gaya', s).constraints.location).toBeUndefined();
    expect(extractFactsSync('legal / title', s).constraints.location).toBeUndefined();
  });

  it('cold bare Whitefield still extracts (location slot empty)', () => {
    const s = initState('t', 'brigade-group');
    expect(extractFactsSync('Whitefield', s).constraints.location).toMatch(/whitefield/i);
  });

  it('catalog-wide type miss is a product handoff, not an apartment pitch', () => {
    expect(catalogSellsPropertyType(['apartment'], 'plantation')).toBe(false);
    const reply = fallbackReply({
      goal: { kind: 'no_fit' },
      evidence: {
        tools: ['search'],
        catalog: { priceMinInr: 31_00_000, priceMaxInr: 1_60_00_000, projectTypes: ['apartment'], microMarkets: [], total: 6, sample: [] },
        unsupportedProduct: { requestedType: 'plantation' },
      },
      context: {
        constraints: { propertyType: 'plantation', location: 'Coorg' },
        alreadyShownSameSet: false,
        builderName: 'Brigade Group',
        waProjectFirst: true,
        channel: 'whatsapp',
        buyerText: 'plantation in Coorg',
      },
    });
    expect(reply).toMatch(/don't sell plantation or farmland/i);
    expect(reply).toMatch(/team/i);
    expect(reply).not.toMatch(/this book is apartments/i);
    expect(reply).not.toMatch(/in Coorg/i);
    expect(reply).not.toMatch(/change bedrooms/i);
    expect(reply).not.toMatch(/See the projects/i);
  });

  it('legal on a latched miss names title, not apartments', () => {
    const reply = fallbackReply({
      goal: { kind: 'no_fit' },
      evidence: {
        tools: [],
        unsupportedProduct: { requestedType: 'plantation', followUp: true, askedTopic: 'legal' },
        catalog: { priceMinInr: 0, priceMaxInr: 0, projectTypes: ['apartment'], microMarkets: [], total: 6, sample: [] },
      },
      context: {
        constraints: { propertyType: 'plantation', location: 'Coorg' },
        alreadyShownSameSet: false,
        builderName: 'Brigade Group',
        waProjectFirst: true,
        channel: 'whatsapp',
        buyerText: 'legal / title',
      },
    });
    expect(reply).toMatch(/title or papers/i);
    expect(reply).not.toMatch(/apartments/i);
    expect(reply).not.toMatch(/2 BHK/i);
  });

  it('empty-cut packer is Ask the team only — not See the projects', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'no_fit' },
      state: {
        ...initState('t', 'brigade-group'),
        constraints: { propertyType: 'plantation', location: 'Coorg' },
      },
      catalogNames: [],
      singleProject: false,
      catalog: { projectTypes: ['apartment'] },
      briefCut: true,
    });
    expect(packed.kind).toBe('buttons');
    if (packed.kind === 'buttons') {
      expect(packed.buttons.map((b) => b.id)).toEqual(['talk_to_human']);
      expect(packed.buttons.map((b) => b.id)).not.toContain(WA_MENU_CHOOSE);
      expect(packed.buttons.map((b) => b.id)).not.toContain(WA_MENU_SEE);
    }
  });

  it('latches: legal after a catalog-wide plantation miss does not invent a place or 2 BHK', async () => {
    const deps = apartmentBookDeps();
    const turn = (text: string) =>
      runEngineTurn({ threadId: 'uns-1', builderId: 'brigade-group', text, buyerPhone: '+919999000001' }, deps);
    const first = await turn('plantation in Coorg');
    expect(first.debug.goal.kind).toBe('no_fit');
    expect(first.reply).toMatch(/don't sell plantation or farmland/i);
    expect(first.reply).not.toMatch(/change bedrooms/i);
    expect(first.reply).not.toMatch(/this book is apartments/i);
    expect(first.state.discover.unsupportedProduct?.requestedType).toBe('plantation');

    const ack = await turn('Samajh gaya');
    expect(ack.state.constraints.location).toMatch(/coorg/i);
    expect(ack.reply).not.toMatch(/Samajh/i);
    expect(ack.reply).not.toMatch(/apartments/i);
    expect(ack.debug.goal.kind).toBe('no_fit');

    const legal = await turn('legal / title');
    expect(legal.debug.goal.kind).toBe('no_fit');
    expect(legal.reply).toMatch(/title or papers/i);
    expect(legal.reply).not.toMatch(/2 BHK/i);
    expect(legal.reply).not.toMatch(/Samajh/i);
    expect(legal.reply).not.toMatch(/apartments/i);

    const visit = await turn('site visit');
    expect(visit.reply).toMatch(/can't book/i);
    expect(visit.reply).not.toMatch(/apartments/i);
  });

  it('first plantation ask never searches the apartment book or probes bedrooms', async () => {
    const deps = apartmentBookDeps();
    let searches = 0;
    const inner = deps.data.search.bind(deps.data);
    deps.data.search = async (builderId, filters) => {
      searches += 1;
      return inner(builderId, filters);
    };
    const first = await runEngineTurn(
      { threadId: 'uns-search', builderId: 'brigade-group', text: 'plantation in Coorg', buyerPhone: '+919999000002' },
      deps,
    );
    expect(searches).toBe(0);
    expect(first.debug.goal.kind).toBe('no_fit');
    expect(first.reply).toMatch(/don't sell plantation or farmland/i);
    expect(first.reply).not.toMatch(/change bedrooms|See the projects|this book is apartments/i);
    expect(first.whatsappInteractive?.kind).toBe('buttons');
    if (first.whatsappInteractive?.kind === 'buttons') {
      expect(first.whatsappInteractive.buttons.map((b) => b.id)).toEqual(['talk_to_human']);
    }
  });

  it('Ask the team is a real handoff, not another no_fit', async () => {
    const deps = apartmentBookDeps();
    const turn = (text: string, action_id?: string) =>
      runEngineTurn(
        { threadId: 'uns-team', builderId: 'brigade-group', text, buyerPhone: '+919999000003', action_id },
        deps,
      );
    await turn('plantation in Coorg');
    const team = await turn('Ask the team', 'talk_to_human');
    expect(team.debug.goal.kind).toBe('handoff');
    expect(team.reply).toMatch(/connect you|take it from here/i);
    expect(team.reply).not.toMatch(/don't sell|change bedrooms|See the projects/i);
    expect(team.whatsappInteractive).toBeUndefined();
  });

  it('saying they meant a home clears the latch and can search', async () => {
    const deps = apartmentBookDeps();
    const turn = (text: string) =>
      runEngineTurn(
        { threadId: 'uns-escape', builderId: 'brigade-group', text, buyerPhone: '+919999000004' },
        deps,
      );
    await turn('plantation in Coorg');
    const home = await turn('I meant an apartment under 1 crore');
    expect(home.state.discover.unsupportedProduct).toBeUndefined();
    expect(home.debug.goal.kind).not.toBe('handoff');
    expect(home.reply).not.toMatch(/don't sell plantation/i);
  });
});
