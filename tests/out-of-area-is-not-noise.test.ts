import { describe, expect, it } from 'vitest';
import { runEngineTurn } from '../src/engine/turn.js';
import { fakeDeps } from './fakes.js';

/**
 * A city we do not serve is not dialogue noise.
 *
 * Reported live, 17 Aug 2026: `2 BHK apartment in Mumbai under 1.5 Cr` on
 * brigade-group came back "Noted: *2 BHK · under ₹1.5 Cr*. Here's what lines
 * up: *Brigade Cornerstone* in Devanahalli…" — three Bengaluru projects, and
 * the word Mumbai never said. `show me 3 BHK in Pune` and `2 BHK in Andheri`
 * did the same.
 *
 * The provisional-locality purge decided the place was noise from
 * `recognized_locations`, which answers SERVICEABILITY, not existence. Measured
 * against Desk dev the same day:
 *
 *     Mumbai    → matches 0, recognized []
 *     Pune      → matches 0, recognized []
 *     "next"    → matches 0, recognized []          ← genuine noise
 *     Bengaluru → matches 3, recognized ['Bengaluru']
 *
 * Every out-of-area city looks exactly like the word "next" through that field.
 * Existence is `deskKnowsAsPlace`, which the phantom-drop already used.
 *
 * No offline test could reach this: `tests/fakes.ts` never returned
 * `recognizedLocations`, so the branch was skipped on every run. The fixture
 * now models the contract, which is what makes these assertions worth anything.
 */

/** Real payloads from Desk dev /api/engine/geo/resolve, 17 Aug 2026. */
const REAL_GEO: Record<string, { lat: number; lng: number; source: string; radiusKm: number }> = {
  mumbai: { lat: 18.9582347, lng: 72.8319514, source: 'geocoder', radiusKm: 38 },
  pune: { lat: 18.5204, lng: 73.8567, source: 'geocoder', radiusKm: 18.3 },
  // Google returns a ~300 m POINT for a bare "Andheri" — the same shape the
  // noise word "next" gets. Kept here so the day Desk surfaces Google's
  // `types` this fixture is what proves the fix.
  andheri: { lat: 19.113645, lng: 72.8697339, source: 'geocoder', radiusKm: 0.2 },
  next: { lat: 13.0353732, lng: 80.2453744, source: 'geocoder', radiusKm: 0.2 },
};

function deps() {
  const d = fakeDeps();
  const inner = d.data.resolveGeo.bind(d.data);
  d.data.resolveGeo = async (text: string) => {
    const key = text.trim().toLowerCase();
    for (const [k, v] of Object.entries(REAL_GEO)) if (key.includes(k)) return v as never;
    return inner(text);
  };
  return d;
}

const ask = (convId: string, text: string) =>
  runEngineTurn({ convId, builderId: 'lokations', text, buyerPhone: '+919999900123' }, deps());

describe('a city we do not serve is not dialogue noise', () => {
  it('names Mumbai back instead of listing Bengaluru as if it fit', async () => {
    const r = await ask('ooa-mumbai', '2 BHK apartment in Mumbai under 1.5 Cr');

    expect(r.debug.goal.kind).toBe('no_fit');
    expect(r.reply).toMatch(/mumbai/i);
    // The shipped defect: a Devanahalli list under a Mumbai question.
    expect(r.reply).not.toMatch(/here's what lines up|here's what we do have/i);
    expect(r.reply).not.toMatch(/Ayana|Krishnaja|Clarks|Eldorado/);
  });

  it('says which cities we do serve, so the decline is actionable', async () => {
    const r = await ask('ooa-mumbai-serve', '2 BHK apartment in Mumbai under 1.5 Cr');
    expect(r.reply).toMatch(/Bengaluru/);
  });

  it('holds for Pune — the case the old comment claimed already survived', async () => {
    const r = await ask('ooa-pune', '3 BHK in Pune under 2 Cr');
    expect(r.debug.goal.kind).toBe('no_fit');
    expect(r.reply).toMatch(/pune/i);
    expect(r.reply).not.toMatch(/Ayana|Krishnaja|Clarks|Eldorado/);
  });

  it('still purges genuine noise — "next" is not a town', async () => {
    // The whole point of the purge, and it has to keep working: a 300 m point
    // Google found for a filler word must not be echoed back as a place.
    const r = await ask('ooa-noise', 'can i move in next month');
    expect(r.reply).not.toMatch(/\bin \*?next\*?\b/i);
    expect(r.debug.goal.kind).not.toBe('no_fit');
  });

  it('a served area is unaffected — no geo call needed to answer Bengaluru', async () => {
    const r = await ask('ooa-served', '2 BHK in North Bangalore under 1 Cr');
    expect(r.debug.goal.kind).toBe('recommend');
    expect(r.reply).toMatch(/Eldorado|Clarks/);
  });
});
