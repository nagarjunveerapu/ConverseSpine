import { describe, expect, it } from 'vitest';
import {
  answerRequirements,
  deliveredFactKeys,
  enforceAnswerContract,
  withAnswerRequirements,
} from '../src/engine/answer-contract.js';
import { fallbackReply, buildComposeRequest } from '../src/engine/compose.js';
import {
  advisoryFactLines,
  gateMarketIntel,
  mapInvestmentFromProject,
  MARKET_INTEL_MIN_CONFIDENCE,
} from '../src/engine/market-intel.js';
import type { NdMarketIntel } from '../src/crm/nayadesk-client.js';
import type { ProjectDetail } from '../src/engine/types.js';

const approvedIntel: NdMarketIntel = {
  micro_market_id: 'north-bangalore',
  city: 'Bangalore',
  display_name: 'North Bangalore',
  appreciation: { three_yr_pct: 18, five_yr_pct: 32, corridor_maturity: 'growth' },
  rent_bands: [{ unit_type: '2 BHK', rent_min_inr: 28_000, rent_max_inr: 38_000 }],
  drivers: [{ event: 'Airport corridor', date: '2024' }],
  provenance: { source: '99acres', as_of: '2026-Q2', confidence: 0.85 },
};

describe('CRM data activation — market intel gating', () => {
  it('gates out low-confidence intel', () => {
    expect(
      gateMarketIntel({
        ...approvedIntel,
        provenance: { ...approvedIntel.provenance, confidence: MARKET_INTEL_MIN_CONFIDENCE - 0.1 },
      }),
    ).toBeUndefined();
  });

  it('formats approved intel with provenance label', () => {
    const mi = gateMarketIntel(approvedIntel);
    expect(mi?.appreciation3yrPct).toBe(18);
    expect(mi?.rentBands[0]?.rentMinInr).toBe(28_000);
    expect(mi?.provenanceLabel).toMatch(/99acres/);
  });

  it('maps project investment fields', () => {
    const inv = mapInvestmentFromProject({
      expected_roi: '8–10% p.a. (illustrative)',
      operator_brand: 'Lokations Ops',
      revenue_model: 'managed lease',
      guaranteed_payment: '',
      maintenance_model: 'estate fee',
      target_buyer_profiles: '["investor"]',
      category_tags: '[]',
    });
    expect(inv?.expectedRoi).toMatch(/8/);
    expect(inv?.operatorBrand).toBe('Lokations Ops');
  });
});

describe('CRM data activation — answer contract', () => {
  it('still declines rental yield when detail has no intel/ROI (C1)', () => {
    expect(answerRequirements('what is the rental yield?')).toContain('rental_yield');
    const out = enforceAnswerContract(
      withAnswerRequirements(
        { kind: 'answer', topic: 'overview', projectId: 'eldorado' },
        'what is the rental yield?',
      ),
      {
        tools: ['projectDetail'],
        detail: { projectId: 'eldorado', name: 'Brigade Eldorado', microMarket: 'North Bangalore' },
      },
    );
    expect(out.failure).toMatchObject({ kind: 'no_data', subject: 'rental_yield' });
  });

  it('delivers rental_yield from gated rent bands', () => {
    const detail: ProjectDetail = {
      projectId: 'eldorado',
      name: 'Brigade Eldorado',
      microMarket: 'North Bangalore',
      marketIntel: gateMarketIntel(approvedIntel),
    };
    expect(deliveredFactKeys({ tools: ['projectDetail'], detail })).toContain('rental_yield');
    expect(deliveredFactKeys({ tools: ['projectDetail'], detail })).toContain('appreciation');
    const out = enforceAnswerContract(
      withAnswerRequirements(
        { kind: 'answer', topic: 'overview', projectId: 'eldorado' },
        'what is the rental yield?',
      ),
      { tools: ['projectDetail'], detail },
    );
    expect(out.failure).toBeUndefined();
    expect(out.deliveredFacts).toContain('rental_yield');
  });

  it('delivers rental_yield from project expected_roi alone', () => {
    const detail: ProjectDetail = {
      projectId: 'ayana',
      name: 'Ayana',
      microMarket: 'Sakleshpur',
      investment: { expectedRoi: 'illustrative estate yield band on file' },
    };
    const out = enforceAnswerContract(
      withAnswerRequirements(
        { kind: 'answer', topic: 'overview', projectId: 'ayana' },
        'what ROI can I expect?',
      ),
      { tools: ['projectDetail'], detail },
    );
    expect(out.failure).toBeUndefined();
  });

  it('compose speaks rent bands with provenance and never invents when declining', () => {
    const detail: ProjectDetail = {
      projectId: 'eldorado',
      name: 'Brigade Eldorado',
      microMarket: 'North Bangalore',
      marketIntel: gateMarketIntel(approvedIntel),
    };
    const lines = advisoryFactLines(detail, ['rental_yield'], 'what is the rental yield?');
    expect(lines.join(' ')).toMatch(/28|38|₹/);
    expect(lines.join(' ')).toMatch(/99acres/);

    const req = buildComposeRequest(
      withAnswerRequirements(
        { kind: 'answer', topic: 'overview', projectId: 'eldorado' },
        'what is the rental yield?',
      ),
      { tools: ['projectDetail'], detail, deliveredFacts: ['rental_yield'] },
      { constraints: {}, alreadyShownSameSet: false, builderName: 'Brigade', buyerText: 'what is the rental yield?' },
    );
    const reply = fallbackReply(req);
    expect(reply).toMatch(/99acres|rent/i);
    expect(reply).not.toMatch(/happy to walk through yields on a call/i);
  });
});
