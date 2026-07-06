import { describe, expect, it } from 'vitest';
import { mapProjectDetailDto } from '../src/advisor/map-project-detail.js';

describe('mapProjectDetailDto', () => {
  it('maps engine detail to advisor API shape', () => {
    const dto = mapProjectDetailDto({
      projectId: 'earth-aroma',
      name: 'Earth Aroma',
      microMarket: 'Devanahalli',
      reraNumber: 'PRM/KA/RERA/1250/303/PR/030822/005130',
      khata: 'A-Khata',
      configurations: [{ unitType: '3 BHK', priceDisplay: '₹58L', priceMinInr: 5800000 }],
    });
    expect(dto.project_id).toBe('earth-aroma');
    expect(dto.rera_number).toContain('RERA');
    expect(dto.khata).toBe('A-Khata');
    expect(dto.configurations?.[0]?.unit_type).toBe('3 BHK');
  });
});
