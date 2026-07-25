import { describe, expect, it } from 'vitest';
import {
  answerRequirements,
  deliveredFactKeys,
} from '../src/engine/answer-contract.js';
import type { ProjectDetail } from '../src/engine/types.js';

describe('project-bind integrity — advisory FactKeys', () => {
  it('requires operator_model and visit_logistics from buyer phrasing', () => {
    expect(answerRequirements('who operates it?')).toContain('operator_model');
    expect(answerRequirements('do you arrange pickup for the site visit?')).toContain(
      'visit_logistics',
    );
  });

  it('delivers operator/visit only from catalog atoms — never invents', () => {
    const empty: ProjectDetail = {
      projectId: 'x',
      name: 'X',
      microMarket: 'Y',
    };
    expect(deliveredFactKeys({ tools: [], detail: empty })).not.toContain('operator_model');
    expect(deliveredFactKeys({ tools: [], detail: empty })).not.toContain('visit_logistics');

    const rich: ProjectDetail = {
      ...empty,
      investment: { operatorBrand: 'Lokations Ops', revenueModel: 'managed lease' },
      visitLogistics: { pickupMode: 'from city', parkingOnSite: 'yes' },
    };
    expect(deliveredFactKeys({ tools: [], detail: rich })).toContain('operator_model');
    expect(deliveredFactKeys({ tools: [], detail: rich })).toContain('visit_logistics');
  });
});
