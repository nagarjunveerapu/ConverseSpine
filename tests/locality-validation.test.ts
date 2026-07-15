import { describe, expect, it } from 'vitest';
import { extractLocation } from '../src/engine/facts.js';

/**
 * AB-3 — dialogue cannot invent a place. Greedy "near …" / "in …" captures grabbed
 * a stopword ("near THE airport" → "the", "ONLY plotted" → "only", "schools near
 * THIS PROJECT" → "this project"), which then surfaced to the buyer as the honest
 * no_fit "No exact match for the." A locality must contain a real place word.
 */
describe('AB-3 — locality noise is not a place', () => {
  it('does not capture a bare stopword from "near the airport"', () => {
    expect(extractLocation('anything near the airport?')).toBeUndefined();
    expect(extractLocation('plotted under 50 lakhs near the airport')).toBeUndefined();
  });

  it('does not capture "only" / "this project" / "here"', () => {
    expect(extractLocation('only plotted projects')).toBeUndefined();
    expect(extractLocation('schools near this project?')).toBeUndefined();
    expect(extractLocation('what is available here?')).toBeUndefined();
  });

  it('still captures a real locality after a rejected noise word', () => {
    // "the airport" is noise, but a named area later in the string is a real place.
    expect(extractLocation('near the airport in Devanahalli')).toBe('Devanahalli');
  });

  it('still captures ordinary localities (no regression)', () => {
    expect(extractLocation('apartments in Whitefield')).toBe('Whitefield');
    expect(extractLocation('looking in Sakleshpur')).toBe('Sakleshpur');
    expect(extractLocation('projects in North Bangalore')).toBe('North Bangalore');
  });

  // Spelling/alias resolution (Mysore→Mysuru) is Desk's job — the geo registry
  // (areasSemantic / resolveGeo) owns served-area truth, not a hardcoded map here.
  // The engine extracts the buyer's word as-is and lets Desk resolve it.
  it('extracts the buyer word verbatim — no hardcoded place mapping', () => {
    expect(extractLocation('plots in Mysore')).toBe('Mysore');
  });
});
