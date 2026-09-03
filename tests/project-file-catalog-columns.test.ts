import { describe, expect, it } from 'vitest';
import { nayadeskData } from '../src/engine/adapters/nayadesk.js';
import { mapVisitLogisticsFromProject } from '../src/engine/market-intel.js';
import type { NayaDeskClient } from '../src/crm/nayadesk-client.js';

/**
 * THE column-type defect. Desk stores `parking_on_site`, `food_offered` and
 * `accommodation_offered` as INTEGER 0/1 flags; this side typed them as prose
 * and called `.trim()` on them. The TypeError threw inside catalogExtras, both
 * branches of projectDetail caught it and returned a data failure, and the
 * buyer lost the ENTIRE project file — RERA, khata, EC, possession, location,
 * every document — on every turn of every conversation. All 105 dev projects
 * carry these columns as integers, so the file had never once arrived whole.
 *
 * The console could then only draw money rows off `listUnits`, which is exactly
 * what the founder kept seeing on the phone: Total cost, EMI, and the two doors.
 */

const PROJECT = {
  project_id: 'orchards',
  builder_id: 'brigade',
  name: 'Brigade Orchards',
  micro_market: 'Devanahalli',
  summary: 'Township',
  rera_number: 'PRM/KA/RERA/1251/411',
  khata_type: 'A-Khata',
  ec_status: 'Clean — EC available',
  possession_date: 'Phase-wise; current phase June 2027',
  entry_price_band: '₹41 L onwards',
  // Straight off Desk: numbers where the engine expected sentences.
  parking_on_site: 1,
  food_offered: 0,
  accommodation_offered: 0,
  pickup_mode: 'complimentary',
  pickup_radius_km: 50,
} as const;

function client(withContext: boolean): NayaDeskClient {
  return {
    threadContext: async () =>
      withContext
        ? {
            project: PROJECT,
            units: [{ unit_type: '3 BHK', price_display: '₹82 L' }],
            media: [],
            phase_journeys: [],
            builder: { name: 'Brigade', bot_name: 'b', bot_persona: 'p' },
          }
        : Promise.reject(new Error('focus is elsewhere')),
    getProject: async () => PROJECT,
    getLocationIntelligence: async () => null,
    listProjectMedia: async () => [
      { asset_id: 'm1', asset_kind: 'brochure', title: 'Brochure', disclosure_tier: 'public' },
    ],
    marketIntel: async () => ({ intel: null }),
  } as unknown as NayaDeskClient;
}

describe('a mis-typed catalog column never costs the project file', () => {
  it('the catalog branch still carries RERA, khata, EC and the brochure', async () => {
    const res = await nayadeskData(client(false)).projectDetail('brigade', 'nd-1', 'orchards');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.reraNumber).toBe('PRM/KA/RERA/1251/411');
    expect(res.value.khata).toBe('A-Khata');
    expect(res.value.ecStatus).toBe('Clean — EC available');
    expect(res.value.mediaKinds).toContain('brochure');
  });

  it('the focused branch survives the same columns', async () => {
    const res = await nayadeskData(client(true)).projectDetail('brigade', 'nd-1', 'orchards');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.reraNumber).toBe('PRM/KA/RERA/1251/411');
    expect(res.value.configurations?.[0]?.unitType).toBe('3 BHK');
  });

  it('a 1 is the builder’s promise; a 0 is the column default and says nothing', () => {
    const v = mapVisitLogisticsFromProject(PROJECT);
    expect(v?.parkingOnSite).toBe('available');
    // Never "food: 0", and never a No we cannot stand behind.
    expect(v?.foodOffered).toBeUndefined();
    expect(v?.accommodationOffered).toBeUndefined();
    expect(v?.pickupMode).toBe('complimentary');
    expect(v?.pickupRadiusKm).toBe(50);
  });

  it('a genuinely unmappable column costs its own row, not the record', async () => {
    const crm = {
      ...client(false),
      getProject: async () => ({ ...PROJECT, spec_json: '{"amenities":' }),
    } as unknown as NayaDeskClient;
    const res = await nayadeskData(crm).projectDetail('brigade', 'nd-1', 'orchards');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.reraNumber).toBe('PRM/KA/RERA/1251/411');
  });
});
