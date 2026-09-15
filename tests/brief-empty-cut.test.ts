import { describe, expect, it } from 'vitest';
import { applyWaInteractiveExtract, packWhatsAppInteractive, waBudgetRows, WA_BUDGET_ANY, WA_MENU_BUDGET, WA_MENU_CHOOSE, WA_MENU_SEE } from '../src/channel/wa-pack.js';
import { isOpenBudgetPhrase, parseBudgetToInr } from '../src/engine/facts.js';
import { budgetIsKnown, firstMissingSlot, isBriefReady } from '../src/engine/phases/discover.js';
import { searchWithAuthorityRelaxation } from '../src/engine/search-outcome.js';
import { applyExtracted, initState } from '../src/engine/state.js';
import { runEngineTurn } from '../src/engine/turn.js';
import type { Extracted, Match, SearchFilters } from '../src/engine/types.js';
import { fakeDeps } from './fakes.js';

const BAG = [{ projectId: 'brigade-eternia', name: 'Brigade Eternia' }];

function ex(partial: Partial<Extracted> = {}): Extracted {
  return { constraints: {}, ...partial };
}

describe('typed any budget and above-floor', () => {
  it('parses Above ₹1 Cr as a floor, not a 1 Cr ceiling', () => {
    const parsed = parseBudgetToInr('Above ₹1 Cr');
    expect(parsed).toEqual({ min: 1_00_00_000 });
    expect(parsed?.max).toBeUndefined();
  });

  it('treats any budget as an open slot, not a missing one', () => {
    expect(isOpenBudgetPhrase('3 BHK in Yelahanka, Any budget')).toBe(true);
    expect(isOpenBudgetPhrase('under 1 cr')).toBe(false);
    expect(budgetIsKnown({ budgetOpen: true })).toBe(true);
    expect(
      isBriefReady({ location: 'Yelahanka', bhk: '3 BHK', budgetOpen: true }),
    ).toBe(true);
    expect(
      isBriefReady({ location: 'Yelahanka', bhk: '3 BHK', budgetMinInr: 1_00_00_000 }),
    ).toBe(true);
  });

  it('an Above tap replaces a title-parsed ceiling', () => {
    const rows = waBudgetRows(null, 0);
    const aboveId = rows[2]!.id;
    expect(rows[2]!.title).toBe('Above ₹1 Cr');
    const extracted = applyWaInteractiveExtract(
      aboveId,
      ex({ constraints: { budgetMaxInr: 1_00_00_000 } }),
      BAG,
    );
    expect(extracted.constraints.budgetMinInr).toBe(1_00_00_000);
    expect(extracted.constraints.budgetMaxInr).toBeUndefined();
  });

  it('Any budget tap stamps budgetOpen and clears amounts', () => {
    const extracted = applyWaInteractiveExtract(
      WA_BUDGET_ANY,
      ex({ constraints: { budgetMaxInr: 50_00_000 } }),
      BAG,
    );
    expect(extracted.constraints.budgetOpen).toBe(true);
    expect(extracted.constraints.budgetMaxInr).toBeUndefined();
  });

  it('persists budgetOpen through applyExtracted', () => {
    const next = applyExtracted(
      initState('c1', 'lokations'),
      {
        constraints: { bhk: '3 BHK', location: 'Yelahanka', budgetOpen: true },
      },
      undefined,
      { locationValidated: true },
    );
    expect(next.constraints.budgetOpen).toBe(true);
    expect(firstMissingSlot(next)).toBeUndefined();
  });
});

describe('empty-cut chrome', () => {
  it('Change size, not Change bedrooms, when there is no named closest', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'no_fit' },
      state: initState('c', 'lokations'),
      catalogNames: [],
      singleProject: false,
      briefCut: true,
    });
    expect(packed.kind).toBe('buttons');
    if (packed.kind !== 'buttons') return;
    expect(packed.buttons.map((b) => b.title)).toEqual(['Change size', 'Change budget', 'See the projects']);
    expect(packed.buttons.map((b) => b.id)).toEqual([WA_MENU_CHOOSE, WA_MENU_BUDGET, WA_MENU_SEE]);
  });

  it('named closest is the first door', () => {
    const packed = packWhatsAppInteractive({
      goal: { kind: 'no_fit' },
      state: { ...initState('c', 'lokations'), constraints: { bhk: '3 BHK', budgetMinInr: 1_00_00_000 } },
      catalogNames: [],
      singleProject: false,
      briefCut: true,
      closest: { projectId: 'brigade-eternia', name: 'Brigade Eternia' },
    });
    expect(packed.kind).toBe('buttons');
    if (packed.kind !== 'buttons') return;
    expect(packed.buttons[0]).toEqual({ id: 'wa.pick.brigade-eternia', title: 'Brigade Eternia' });
  });
});

describe('floor-satisfying nearest is not a budget miss', () => {
  it('blames area when the locality hit already clears the floor', async () => {
    const eternia: Match = {
      projectId: 'brigade-eternia',
      name: 'Brigade Eternia',
      microMarket: 'Yelahanka',
      startingPriceInr: 2_47_00_000,
      startingPriceDisplay: '₹2.47 Cr',
      matchReasons: [],
    };
    const result = await searchWithAuthorityRelaxation({
      constraints: { bhk: '3 BHK', location: 'Yelahanka', budgetMinInr: 1_00_00_000 },
      rejectedProjectIds: [],
      filters: {
        bhks: '3 BHK',
        locations: 'Yelahanka',
        budgetMinInr: 1_00_00_000,
      },
      search: async (filters: SearchFilters) => {
        if (filters.locations && filters.budgetMinInr === undefined) {
          return { matches: [eternia] };
        }
        return { matches: [] };
      },
    });
    expect(result).toMatchObject({
      ok: false,
      failure: { kind: 'no_match', subject: 'area', nearest: { name: 'Brigade Eternia' } },
    });
  });
});

describe('transcript: complete brief is not a budget probe', () => {
  it('3 BHK in Yelahanka, Any budget does not ask what budget feels comfortable', async () => {
    const deps = { ...fakeDeps(), waProjectFirst: true };
    const turn = (text: string, action_id?: string) =>
      runEngineTurn(
        {
          threadId: 'brief-any-budget',
          builderId: 'lokations',
          text,
          buyerPhone: '+919999990014',
          channel: 'whatsapp',
          ...(action_id ? { action_id } : {}),
        },
        deps,
      );
    await turn('Hi');
    await turn('Help me find a home', 'wa.menu.choose');
    const after = await turn('3 BHK in Yelahanka, Any budget');
    expect(after.reply).not.toMatch(/what budget feels comfortable/i);
    expect(after.state.constraints.budgetOpen).toBe(true);
    expect(after.state.constraints.bhk).toMatch(/3/);
  });
});
