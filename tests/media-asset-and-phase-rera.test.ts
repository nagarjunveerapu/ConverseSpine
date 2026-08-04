import { describe, expect, it } from 'vitest';
import {
  mediaKindMissingFromInventory,
  normalizeMediaAssetKind,
  uniqueMediaKinds,
} from '../src/engine/media-asset.js';
import { detectMediaAssetKind, detectTopics } from '../src/engine/facts.js';
import { mapPhasesFromJourneys } from '../src/engine/adapters/nayadesk.js';
import { fallbackReply, buildComposeRequest } from '../src/engine/compose.js';
import {
  advisoryFactLines,
  gateMarketIntel,
} from '../src/engine/market-intel.js';
import {
  answerRequirements,
  deliveredFactKeys,
  enforceAnswerContract,
  withAnswerRequirements,
} from '../src/engine/answer-contract.js';
import type { NdMarketIntel } from '../src/crm/nayadesk-client.js';
import type { ProjectDetail } from '../src/engine/types.js';

describe('media asset kind normalization', () => {
  it('maps buyer aliases to Desk AssetKind', () => {
    expect(normalizeMediaAssetKind('photo')).toBe('site_image');
    expect(normalizeMediaAssetKind('photos')).toBe('site_image');
    expect(normalizeMediaAssetKind('cost sheet')).toBe('price_sheet');
    expect(normalizeMediaAssetKind('cost_sheet')).toBe('price_sheet');
    expect(normalizeMediaAssetKind('floor_plan')).toBe('floor_plan');
    expect(normalizeMediaAssetKind('brochure')).toBe('brochure');
  });

  it('detects price/payment/master plan share phrasing (CAT-07/08/09)', () => {
    expect(detectMediaAssetKind('send the price sheet')).toBe('price_sheet');
    expect(detectMediaAssetKind('send the payment plan PDF')).toBe('payment_plan');
    expect(detectMediaAssetKind('send the master plan')).toBe('master_plan');
    // Spoken FAQ ask must NOT become a PDF share kind.
    expect(detectMediaAssetKind('what is the payment plan?')).toBeUndefined();
    expect(detectTopics('send the payment plan PDF')).toContain('media');
    expect(detectTopics('send the price sheet')).toContain('media');
  });

  it('detects plural unit photos/images as site_image (CAT-11)', () => {
    expect(detectMediaAssetKind('send 2BHK unit photos')).toBe('site_image');
    expect(detectMediaAssetKind('show me the images')).toBe('site_image');
    expect(detectMediaAssetKind('send a photo of the site')).toBe('site_image');
  });

  it('gates when inventory is known and kind is absent', () => {
    expect(mediaKindMissingFromInventory('floor_plan', ['brochure', 'site_image'])).toBe(true);
    expect(mediaKindMissingFromInventory('site_image', ['brochure', 'site_image'])).toBe(false);
    expect(mediaKindMissingFromInventory('photo', ['site_image'])).toBe(false);
    expect(mediaKindMissingFromInventory('brochure', undefined)).toBe(false);
  });

  it('collects unique kinds from context media rows', () => {
    expect(
      uniqueMediaKinds([
        { asset_kind: 'brochure' },
        { asset_kind: 'brochure' },
        { asset_kind: 'floor_plan' },
        { asset_kind: '' },
      ]),
    ).toEqual(['brochure', 'floor_plan']);
  });
});

describe('phase RERA mapping', () => {
  it('maps phase_journeys rera_number onto ProjectDetail.phases', () => {
    const mapped = mapPhasesFromJourneys([
      {
        phase_id: 'p1',
        phase_label: 'Phase 1',
        stage: 'booking',
        rera_number: 'PRM/KA/RERA/1251/310/PR/171015/000262',
      },
      {
        phase_id: 'p2',
        phase_label: 'Phase 2',
        stage: 'eoi',
        rera_number: '',
      },
    ]);
    expect(mapped.phases).toHaveLength(2);
    expect(mapped.reraNumber).toMatch(/PRM\/KA/);
    expect(mapped.phases?.[0]?.reraNumber).toMatch(/PRM\/KA/);
  });

  it('compose lists per-phase RERA when multiple phases carry numbers', () => {
    const detail: ProjectDetail = {
      projectId: 'eldorado',
      name: 'Brigade Eldorado',
      microMarket: 'North Bangalore',
      phases: [
        { phaseId: 'p1', phaseLabel: 'Phase 1', stage: 'booking', reraNumber: 'RERA-A' },
        { phaseId: 'p2', phaseLabel: 'Phase 2', stage: 'booking', reraNumber: 'RERA-B' },
      ],
    };
    const req = buildComposeRequest(
      { kind: 'answer', topic: 'legal', projectId: 'eldorado' },
      { tools: ['detail'], detail },
      {
        constraints: {},
        alreadyShownSameSet: false,
        builderName: 'Brigade',
        buyerText: 'ACTUAL RERA status of Eldorado',
        focusProjectName: 'Brigade Eldorado',
      },
    );
    const reply = fallbackReply(req);
    expect(reply).toMatch(/Brigade Eldorado/);
    expect(reply).toMatch(/RERA-A/);
    expect(reply).toMatch(/RERA-B/);
    expect(reply).not.toMatch(/Sanctuary/i);
  });
});

describe('growth drivers activation', () => {
  const intel: NdMarketIntel = {
    micro_market_id: 'north-bangalore',
    city: 'Bangalore',
    display_name: 'North Bangalore',
    appreciation: { three_yr_pct: 18, five_yr_pct: 32, corridor_maturity: 'growth' },
    rent_bands: [],
    drivers: [
      { event: 'Airport corridor', date: '2024' },
      { event: 'Peripheral Ring Road', date: '2026' },
    ],
    provenance: { source: '99acres', as_of: '2026-Q2', confidence: 0.85 },
  };

  it('requires and delivers growth_drivers from gated intel', () => {
    expect(answerRequirements("what's driving growth in this area?")).toContain('growth_drivers');
    const detail: ProjectDetail = {
      projectId: 'eldorado',
      name: 'Brigade Eldorado',
      microMarket: 'North Bangalore',
      marketIntel: gateMarketIntel(intel),
    };
    expect(deliveredFactKeys({ tools: ['detail'], detail })).toContain('growth_drivers');
    const out = enforceAnswerContract(
      withAnswerRequirements(
        { kind: 'answer', topic: 'overview', projectId: 'eldorado' },
        "what's driving growth in this area?",
      ),
      { tools: ['detail'], detail },
    );
    expect(out.failure).toBeUndefined();
    const lines = advisoryFactLines(detail, ['growth_drivers'], "what's driving growth?");
    expect(lines.join(' ')).toMatch(/Airport corridor/);
    expect(lines.join(' ')).toMatch(/99acres/);
  });

  it('declines growth_drivers when intel has no drivers', () => {
    const detail: ProjectDetail = {
      projectId: 'eldorado',
      name: 'Brigade Eldorado',
      microMarket: 'North Bangalore',
    };
    const out = enforceAnswerContract(
      withAnswerRequirements(
        { kind: 'answer', topic: 'overview', projectId: 'eldorado' },
        "what's driving growth in this area?",
      ),
      { tools: ['detail'], detail },
    );
    expect(out.failure).toMatchObject({ kind: 'no_data', subject: 'growth_drivers' });
  });
});
