/**
 * Nearby-offer — singleton exact fit soft-widens; wantsMore empty lists nearby.
 */
import { describe, expect, it } from 'vitest';
import { findNearbyTypeOffer } from '../src/engine/nearby-offer.js';
import { runEngineTurn } from '../src/engine/turn.js';
import { buildAdvisorNba } from '../src/advisor/nba.js';
import { fakeDeps } from './fakes.js';
import type { Match } from '../src/engine/types.js';

describe('findNearbyTypeOffer', () => {
  it('returns same-type projects outside the asked market', async () => {
    const catalog: Match[] = [
      {
        projectId: 'ayana',
        name: 'Ayana',
        microMarket: 'Sakleshpur',
        startingPriceInr: 2_495_000,
        startingPriceDisplay: '₹24.95 L',
        matchReasons: [],
        projectType: 'managed_plantation_estate',
      },
      {
        projectId: 'krishnaja',
        name: 'Krishnaja Greens',
        microMarket: 'Virajpet',
        startingPriceInr: 3_900_000,
        startingPriceDisplay: '₹39 L',
        matchReasons: [],
        projectType: 'managed_plantation_estate',
      },
      {
        projectId: 'coorg-estate',
        name: 'Coorg Hills Estate',
        microMarket: 'Coorg',
        startingPriceInr: 4_800_000,
        startingPriceDisplay: '₹48 L',
        matchReasons: [],
        projectType: 'managed_plantation_estate',
      },
    ];
    const offer = await findNearbyTypeOffer({
      asked: 'Sakleshpur',
      builderId: 'lokations',
      filters: { projectTypes: 'managed_plantation_estate', locations: 'Sakleshpur' },
      constraints: { location: 'Sakleshpur', propertyType: 'plantation' },
      excludeIds: new Set(['ayana']),
      search: async () => ({ matches: catalog }),
    });
    expect(offer?.nearbyAreas).toEqual(expect.arrayContaining(['Virajpet', 'Coorg']));
    expect(offer?.previewNames).toEqual(
      expect.arrayContaining(['Krishnaja Greens', 'Coorg Hills Estate']),
    );
    expect(offer?.previewMatches.every((m) => m.projectId !== 'ayana')).toBe(true);
  });
});

describe('nearby offer engine turns', () => {
  it('singleton Sakleshpur plantation soft-offers nearby in reply + chip', async () => {
    const deps = fakeDeps();
    const convId = 'nearby-soft';
    await runEngineTurn(
      { convId, builderId: 'lokations', text: 'hi', buyerPhone: '+919900002001', channel: 'advisor_web' },
      deps,
    );
    const r = await runEngineTurn(
      {
        convId,
        builderId: 'lokations',
        text: 'plantation in sakleshpur under 50 lakhs',
        buyerPhone: '+919900002001',
        channel: 'advisor_web',
      },
      deps,
    );
    expect(r.state.shortlistIds).toEqual(['ayana']);
    expect(r.debug?.nearby_offer?.label).toMatch(/nearby/i);
    expect(r.reply).toMatch(/only .+ in \*Sakleshpur\*/i);
    expect(r.reply).toMatch(/Virajpet|Coorg/i);
    expect(r.reply).toMatch(/want those too/i);
    expect(r.state.rti?.pendingPrompt?.kind).toBe('location_broaden');

    const nba = buildAdvisorNba(r.state, r.debug!);
    expect(nba.chips.some((c) => /nearby/i.test(c))).toBe(true);
  });

  it('show me other projects too widens to Krishnaja / Coorg Hills', async () => {
    const deps = fakeDeps();
    const convId = 'nearby-wants-more';
    const say = (text: string) =>
      runEngineTurn(
        { convId, builderId: 'lokations', text, buyerPhone: '+919900002002', channel: 'advisor_web' },
        deps,
      );
    await say('hi');
    await say('plantation in sakleshpur under 50 lakhs');
    await say('tell me about ayana');
    const r = await say('show me other projects too');
    expect(r.state.phase).toBe('discover');
    // A4 advisor_web: board owns catalog names; reply stays thin.
    expect(r.reply).toMatch(/on your board|nearby options are on your board/i);
    expect(r.reply).toMatch(/nearby|only got \*Ayana\*/i);
    const ids = r.state.shortlistIds ?? [];
    expect(ids.includes('krishnaja') || ids.includes('coorg-estate')).toBe(true);
    expect(ids.includes('ayana')).toBe(false);
  });

  it('yes after nearby CTA widens location and lists nearby estates', async () => {
    const deps = fakeDeps();
    const convId = 'nearby-yes';
    const say = (text: string) =>
      runEngineTurn(
        { convId, builderId: 'lokations', text, buyerPhone: '+919900002003', channel: 'advisor_web' },
        deps,
      );
    await say('hi');
    await say('plantation in sakleshpur under 50 lakhs');
    const mid = await deps.store.load(convId);
    expect(mid?.rti?.pendingPrompt?.kind).toBe('location_broaden');
    const r = await say('yes, show me those nearby estates');
    // A4 advisor_web: names live on the board / shortlist, not in chat dump.
    expect(r.reply).toMatch(/on your board|matches are on your board/i);
    const ids = r.state.shortlistIds ?? [];
    expect(ids.some((id) => id === 'krishnaja' || id === 'coorg-estate')).toBe(true);
  });
});
