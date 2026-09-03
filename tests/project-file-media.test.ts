import { describe, expect, it } from 'vitest';
import { nayadeskData } from '../src/engine/adapters/nayadesk.js';
import type { NayaDeskClient } from '../src/crm/nayadesk-client.js';

/**
 * The project file must not depend on whether Desk's conversation happens to be
 * focused on this project. Media reached the engine ONLY through
 * threadContext, which is focus-scoped — so a buyer who picked a project
 * off the board was never offered its brochure, and Eldorado's 16 public
 * documents (floor plan for their own 2 BHK included) went unmentioned for the
 * whole conversation. The library is conversation-free; both paths read it.
 */

const LIBRARY = [
  { asset_id: 'a1', asset_kind: 'brochure', title: 'Eldorado — Brochure', disclosure_tier: 'public' },
  { asset_id: 'a2', asset_kind: 'payment_plan', title: 'Payment Plan', disclosure_tier: 'public' },
  {
    asset_id: 'a3',
    asset_kind: 'floor_plan',
    title: '2 BHK Floor Plan',
    unit_type_filter: '2 BHK',
    disclosure_tier: 'public',
  },
  // The builder's own paperwork — never named in a buyer's menu.
  { asset_id: 'a4', asset_kind: 'legal_agreement', title: 'Internal', disclosure_tier: 'admin_only' },
  // Withdrawn assets are not inventory either.
  { asset_id: 'a5', asset_kind: 'site_image', title: 'Old', disclosure_tier: 'public', is_active: 0 },
];

const PROJECT = {
  project_id: 'eldorado',
  builder_id: 'brigade',
  name: 'Brigade Eldorado',
  micro_market: 'Aerospace Park',
  summary: 'Township',
  rera_number: 'PRM/KA/RERA/1251/309',
  khata_type: 'A-Khata',
  ec_status: 'Available on request',
  possession_date: '2028-06',
  entry_price_band: '₹31 L onwards',
};

function client(opts: { context: boolean }): NayaDeskClient {
  return {
    threadContext: async () =>
      opts.context
        ? {
            project: PROJECT,
            units: [{ unit_type: '2 BHK', price_display: '₹57 L', price_min_paise: 5_70_00_000 }],
            // Desk sends media on the bundle only when it is focused here.
            media: LIBRARY.slice(0, 3),
            phase_journeys: [],
            builder: { name: 'Brigade', bot_name: 'b', bot_persona: 'p' },
          }
        : Promise.reject(new Error('focus is elsewhere')),
    getProject: async () => PROJECT,
    getLocationIntelligence: async () => null,
    listProjectMedia: async () => LIBRARY,
    marketIntel: async () => ({ intel: null }),
  } as unknown as NayaDeskClient;
}

async function detailFor(context: boolean) {
  const res = await nayadeskData(client({ context })).projectDetail('brigade', 'nd-1', 'eldorado');
  expect(res.ok).toBe(true);
  return res.ok ? res.value : undefined;
}

describe('the project file carries its documents either way', () => {
  it('offers the library when Desk has no conversation focus on this project', async () => {
    const d = (await detailFor(false))!;
    expect(d.mediaKinds).toContain('brochure');
    expect(d.mediaKinds).toContain('payment_plan');
    expect(d.mediaAssets?.map((a) => a.assetId)).toEqual(['a1', 'a2', 'a3']);
  });

  it('the same kinds arrive with the focused bundle — no variance to explain', async () => {
    const cold = (await detailFor(false))!;
    const warm = (await detailFor(true))!;
    expect([...(warm.mediaKinds ?? [])].sort()).toEqual([...(cold.mediaKinds ?? [])].sort());
  });

  it('names the floor plan bound to one configuration', async () => {
    const d = (await detailFor(false))!;
    const plan = d.mediaAssets?.find((a) => a.kind === 'floor_plan');
    expect(plan?.unitTypeFilter).toBe('2 BHK');
    expect(plan?.title).toBe('2 BHK Floor Plan');
  });

  it('never names admin-only paperwork or a withdrawn asset', async () => {
    const d = (await detailFor(false))!;
    const ids = d.mediaAssets?.map((a) => a.assetId) ?? [];
    expect(ids).not.toContain('a4');
    expect(ids).not.toContain('a5');
    expect(d.mediaKinds).not.toContain('legal_agreement');
  });

  it('a library outage costs the documents, never the file', async () => {
    const crm = {
      ...client({ context: false }),
      listProjectMedia: async () => {
        throw new Error('down');
      },
    } as unknown as NayaDeskClient;
    const res = await nayadeskData(crm).projectDetail('brigade', 'nd-1', 'eldorado');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.mediaKinds).toBeUndefined();
      expect(res.value.reraNumber).toBe('PRM/KA/RERA/1251/309');
      expect(res.value.khata).toBe('A-Khata');
    }
  });
});
