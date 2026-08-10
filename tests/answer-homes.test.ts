import { describe, expect, it } from 'vitest';
import {
  nextProbeChipLabels,
  rankNextProbe,
  templateIdForHomes,
} from '../src/engine/answer-homes.js';
import { resolveFreeTextToChipPaths } from '../src/engine/speech-act/resolve.js';

describe('answer-homes', () => {
  it('template id sorts homes', () => {
    expect(templateIdForHomes(['place', 'connectivity'])).toBe('connectivity+place.v1');
  });

  it('ranks visit then pricing after place+connectivity', () => {
    const { primary, chips } = rankNextProbe(['place', 'connectivity']);
    expect(primary).toBe('visit');
    expect(chips.slice(0, 2)).toEqual(['visit', 'pricing']);
  });

  it('location probe labels resolve via speech-act', () => {
    const labels = nextProbeChipLabels('location');
    expect(labels[0]).toBe('Plan a visit day');
    expect(labels).toContain('Pricing');
    for (const label of labels) {
      const r = resolveFreeTextToChipPaths(label);
      expect(r.primary, label).toBeTruthy();
    }
  });
});
